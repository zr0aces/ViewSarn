const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// These tests drive renderHtmlToBuffer without a browser: Chromium is stubbed so
// the deadline, the slot release, and the context cleanup can be checked exactly.
// The stub records every context it hands out and whether each was closed.
function loadRenderWithStubbedBrowser({ env, newContextDelayMs = 0, hangForever = false }) {
  const contexts = [];

  const stubPlaywright = {
    chromium: {
      launch: async () => ({
        close: async () => {},
        newContext: async () => {
          if (newContextDelayMs) await new Promise(r => setTimeout(r, newContextDelayMs));
          const context = {
            closed: false,
            close: async () => { context.closed = true; },
            newPage: async () => ({
              setContent: async () => { if (hangForever) await new Promise(() => {}); },
              evaluate: async () => ({ width: 800, height: 600 }),
              setViewportSize: async () => {},
              screenshot: async () => Buffer.from('png'),
              pdf: async () => Buffer.from('pdf')
            })
          };
          contexts.push(context);
          return context;
        }
      })
    }
  };

  const previous = { ...env, LOG_LEVEL: process.env.LOG_LEVEL };
  Object.assign(process.env, env);
  process.env.LOG_LEVEL = 'silent';

  for (const mod of ['../src/config', '../src/logger', '../src/render']) {
    delete require.cache[require.resolve(mod)];
  }

  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'playwright') return stubPlaywright;
    return originalLoad.apply(this, arguments);
  };

  let render;
  try {
    render = require('../src/render');
  } finally {
    Module._load = originalLoad;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return { render, contexts };
}

test('a render that blows its deadline returns 504 and frees its slot', async () => {
  const { render } = loadRenderWithStubbedBrowser({
    env: { RENDER_TIMEOUT_MS: '50', RENDER_CONCURRENCY: '1' },
    hangForever: true
  });

  await assert.rejects(
    () => render.renderHtmlToBuffer('<h1>hang</h1>', {}),
    (err) => err.status === 504
  );

  assert.deepEqual(render._inFlight(), { active: 0, waiting: 0 }, 'the slot must go back to the pool');
});

test('a context created after the deadline fired is still closed', async () => {
  // The deadline can fire while newContext is still in flight. The context then
  // arrives with nobody waiting for it, and unless the render notices it has
  // been abandoned, that context and its pages leak for the life of the process.
  const { render, contexts } = loadRenderWithStubbedBrowser({
    env: { RENDER_TIMEOUT_MS: '20', RENDER_CONCURRENCY: '1' },
    newContextDelayMs: 60
  });

  await assert.rejects(
    () => render.renderHtmlToBuffer('<h1>slow context</h1>', {}),
    (err) => err.status === 504
  );

  // Give the abandoned work time to finish creating its context.
  await new Promise(r => setTimeout(r, 120));

  assert.equal(contexts.length, 1, 'the stub should have handed out exactly one context');
  assert.equal(contexts[0].closed, true, 'the abandoned context must be closed, not leaked');
});

test('a successful render closes its context and frees its slot', async () => {
  const { render, contexts } = loadRenderWithStubbedBrowser({
    env: { RENDER_TIMEOUT_MS: '5000', RENDER_CONCURRENCY: '2' }
  });

  const result = await render.renderHtmlToBuffer('<h1>ok</h1>', {});

  assert.equal(result.buffer.toString(), 'pdf');
  assert.equal(contexts[0].closed, true, 'the context must be closed on the happy path too');
  assert.deepEqual(render._inFlight(), { active: 0, waiting: 0 });
});
