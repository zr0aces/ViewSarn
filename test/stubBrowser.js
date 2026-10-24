const Module = require('node:module');
const { loadFreshModules } = require('./helpers');

// Loads src/render.js against a fake Playwright. The fake browser can be
// disconnected and records every launch and context, so tests can drive crash
// recovery, shutdown, deadlines and cleanup.
function loadRender({ env = {}, page = {}, newContext, launchError } = {}) {
  const state = { launches: 0, contexts: [], browsers: [] };

  const makeContext = () => {
    const context = {
      closed: false,
      close: async () => { context.closed = true; },
      routes: [],
      route: async (pattern, handler) => { context.routes.push({ pattern, handler }); },
      routeWebSocket: async (pattern, handler) => { context.wsRoutes.push({ pattern, handler }); },
      wsRoutes: [],
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

  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'playwright') return stub;
    return originalLoad.apply(this, arguments);
  };
  let render;
  try {
    // limits and egress are listed only so their cache is cleared too.
    render = loadFreshModules(env, ['../src/limits', '../src/egress', '../src/render']).at(-1);
  } finally {
    Module._load = originalLoad;
  }
  return { render, state };
}

module.exports = { loadRender };
