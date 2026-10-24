const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRender } = require('./stubBrowser');

const render = (r, opts = {}, extra) => r.renderHtmlToBuffer('<p>x</p>', opts, extra);

test('a browser that died is relaunched on the next render', async () => {
  const { render: r, state } = loadRender();
  await render(r);
  assert.equal(state.launches, 1);
  assert.equal(r.browserReady(), true);

  state.browsers[0].disconnect();
  assert.equal(r.browserReady(), false);

  await render(r);
  assert.equal(state.launches, 2);
  assert.equal(r.browserReady(), true);
});

test('concurrent first calls launch one browser', async () => {
  const { render: r, state } = loadRender();
  await Promise.all([r.initBrowser(), r.initBrowser(), r.initBrowser()]);
  assert.equal(state.launches, 1);
});

test('after closeBrowser, renders get a 503 instead of relaunching', async () => {
  const { render: r, state } = loadRender();
  await render(r);
  await r.closeBrowser();
  await assert.rejects(() => render(r), (err) => err.status === 503);
  assert.equal(state.launches, 1);
});

test('a launch failure is a 503, not a 500, and the next call retries', async () => {
  const { render: r, state } = loadRender({ launchError: new Error('Executable doesn\'t exist') });
  await assert.rejects(() => render(r), (err) => err.status === 503);
  await assert.rejects(() => render(r), (err) => err.status === 503);
  assert.equal(state.launches, 2, 'a failed launch is not cached');
});

test('a client that disconnects mid-render frees the slot and closes the context', async () => {
  const { render: r, state } = loadRender({
    env: { RENDER_CONCURRENCY: '1', RENDER_TIMEOUT_MS: '5000' },
    page: { setContent: () => new Promise(() => {}) }
  });
  const controller = new AbortController();
  const pending = render(r, {}, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 20));
  controller.abort();
  await assert.rejects(() => pending, (err) => err.status === 499);
  assert.deepEqual(r.inFlight(), { active: 0, waiting: 0 });
  assert.equal(state.contexts[0].closed, true);
});

test('a context.close() that never returns does not pin the slot forever', async () => {
  const { render: r } = loadRender({
    env: { RENDER_CONCURRENCY: '1' },
    newContext: async () => ({
      route: async () => {},
      routeWebSocket: async () => {},
      close: () => new Promise(() => {}),
      newPage: async () => ({
        setContent: async () => {},
        evaluate: async () => ({ width: 800, height: 600 }),
        pdf: async () => Buffer.from('pdf')
      })
    })
  });
  const started = Date.now();
  await render(r);
  assert.ok(Date.now() - started < 8000, 'close is bounded by CONTEXT_CLOSE_TIMEOUT_MS');
  assert.deepEqual(r.inFlight(), { active: 0, waiting: 0 });
});

test('a PNG over MAX_PNG_PIXELS is refused with 413 before any viewport change', async () => {
  let viewportCalls = 0;
  const { render: r } = loadRender({
    env: { MAX_PNG_PIXELS: '1000000' },
    page: {
      evaluate: async () => ({ width: 800, height: 20000 }),
      setViewportSize: async () => { viewportCalls += 1; }
    }
  });
  await assert.rejects(
    () => render(r, { png: true, single: true, dpi: 300 }),
    (err) => err.status === 413
  );
  assert.equal(viewportCalls, 0);
  assert.deepEqual(r.inFlight(), { active: 0, waiting: 0 });
});

test('a PDF over MAX_PDF_PAGES is refused with 413', async () => {
  const { render: r } = loadRender({
    env: { MAX_PDF_PAGES: '3' },
    page: { evaluate: async () => ({ width: 800, height: 100000 }) }
  });
  await assert.rejects(() => render(r, {}), (err) => err.status === 413);
});

test('a normal render passes the size limits', async () => {
  const { render: r } = loadRender();
  const out = await render(r, { png: true, single: true });
  assert.equal(out.buffer.toString(), 'png');
});

test('a queued request that waits past RENDER_QUEUE_WAIT_MS gets 503 and leaves the queue', async () => {
  const { render: r } = loadRender({
    env: { RENDER_CONCURRENCY: '1', RENDER_QUEUE_WAIT_MS: '60', RENDER_TIMEOUT_MS: '5000' },
    page: { setContent: () => new Promise(() => {}) }
  });
  const first = render(r).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 20));
  await assert.rejects(() => render(r), (err) => err.status === 503 && /slot/.test(err.message));
  assert.equal(r.inFlight().waiting, 0);
  assert.equal(r.inFlight().active, 1);
  void first;
});

test('page.pdf gets the same millimetres the scale maths used, for a numeric margin', async () => {
  let pdfArgs;
  const { render: r } = loadRender({ page: { pdf: async (args) => { pdfArgs = args; return Buffer.from('pdf'); } } });
  await render(r, { margin: 10 });
  assert.deepEqual(pdfArgs.margin, { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' });
  await render(r, { margin: '1cm' });
  assert.equal(pdfArgs.margin.top, '10mm');
  await render(r, {});
  assert.equal(pdfArgs.margin.top, '10mm');
  await render(r, { margin: 0 });
  assert.equal(pdfArgs.margin.top, '0mm', 'a margin of 0 is no margin, not the default');
});

test('Chromium-shaped failures surface as 500 and always release the slot', async () => {
  const closedBrowser = loadRender({ newContext: async () => { throw new Error('Target page, context or browser has been closed'); } });
  await assert.rejects(() => render(closedBrowser.render), (err) => !err.status || err.status === 500);
  assert.deepEqual(closedBrowser.render.inFlight(), { active: 0, waiting: 0 });

  const pdfFails = loadRender({ page: { pdf: async () => { throw new Error('Protocol error (Page.printToPDF): Target closed'); } } });
  await assert.rejects(() => render(pdfFails.render), /Target closed/);
  assert.deepEqual(pdfFails.render.inFlight(), { active: 0, waiting: 0 });
  assert.equal(pdfFails.state.contexts[0].closed, true, 'the context is closed even though the render failed');
});
