const Module = require('node:module');

// Loads src/render.js against a fake Playwright. Unlike the stub inside
// renderTimeout.test.js, the fake browser can be disconnected and records every
// launch, so tests can drive crash recovery and shutdown.
function loadRender({ env = {}, page = {}, newContext, launchError } = {}) {
  const state = { launches: 0, contexts: [], browsers: [] };

  const makeContext = () => {
    const context = {
      closed: false,
      close: async () => { context.closed = true; },
      routes: [],
      route: async (pattern, handler) => { context.routes.push({ pattern, handler }); },
      newPage: async () => ({
        setContent: async () => {},
        evaluate: async () => ({ width: 800, height: 600 }),
        setViewportSize: async () => {},
        screenshot: async () => Buffer.from('png'),
        pdf: async () => Buffer.from('pdf'),
        ...page
      })
    };
    state.contexts.push(context);
    return context;
  };

  const stub = {
    chromium: {
      launch: async () => {
        state.launches += 1;
        await new Promise(r => setImmediate(r));
        if (launchError) throw launchError;
        const handlers = {};
        const browser = {
          connected: true,
          isConnected: () => browser.connected,
          on: (event, fn) => { handlers[event] = fn; },
          disconnect: () => { browser.connected = false; handlers.disconnected?.(); },
          close: async () => { browser.connected = false; },
          newContext: async (...args) => (newContext ? newContext(browser, makeContext, ...args) : makeContext())
        };
        state.browsers.push(browser);
        return browser;
      }
    }
  };

  const previous = { LOG_LEVEL: process.env.LOG_LEVEL };
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  Object.assign(process.env, env);
  process.env.LOG_LEVEL = 'silent';
  for (const mod of ['../src/config', '../src/logger', '../src/limits', '../src/egress', '../src/render']) {
    delete require.cache[require.resolve(mod)];
  }
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'playwright') return stub;
    return originalLoad.apply(this, arguments);
  };
  let render;
  try {
    render = require('../src/render');
  } finally {
    Module._load = originalLoad;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  return { render, state };
}

module.exports = { loadRender };
