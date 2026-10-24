// Real Chromium. Skipped unless RUN_BROWSER_TESTS=1; run it in the image:
//   docker run --rm -e RUN_BROWSER_TESTS=1 -v "$PWD/test:/app/test:ro" <image> node --test test/browser/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const enabled = process.env.RUN_BROWSER_TESTS === '1';
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 (needs Chromium)' };

function freshRender(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  for (const mod of ['../../src/config', '../../src/logger', '../../src/egress', '../../src/render']) {
    delete require.cache[require.resolve(mod)];
  }
  try { return require('../../src/render'); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// A server that only counts what reaches it.
async function countingServer() {
  const hits = [];
  const server = http.createServer((req, res) => { hits.push(req.url); res.end('SECRET'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, hits, close: () => new Promise(resolve => server.close(resolve)) };
}

const page = (port) => `
  <h1>report</h1>
  <img src="http://127.0.0.1:${port}/img.png">
  <img src="http://localhost:${port}/img2.png">
  <script>fetch('http://127.0.0.1:${port}/secret.txt')</script>`;

test('rendered HTML cannot reach loopback; the same page can when EGRESS_ALLOW names it', opts, async () => {
  const server = await countingServer();
  const blocking = freshRender({ LOG_LEVEL: 'silent' });
  const allowing = freshRender({ LOG_LEVEL: 'silent', EGRESS_ALLOW: '127.0.0.0/8,localhost' });
  try {
    await blocking.renderHtmlToBuffer(page(server.port), { png: true });
    assert.deepEqual(server.hits, [], 'the server received nothing');

    await allowing.renderHtmlToBuffer(page(server.port), { png: true });
    assert.ok(server.hits.length > 0, 'control: the probe does reach the server when allowed, so the test can fail');
  } finally {
    await blocking.closeBrowser();
    await allowing.closeBrowser();
    await server.close();
  }
});

test('an allowed host cannot redirect the browser to a blocked one', opts, async () => {
  // 127.0.0.2 stands in for the metadata address: same loopback range, so it is
  // blocked unless named, and Linux answers on it without any setup.
  const target = http.createServer((req, res) => { target.hits.push(req.url); res.end('SECRET'); });
  target.hits = [];
  await new Promise(resolve => target.listen(0, '127.0.0.2', resolve));
  const bouncer = http.createServer((req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.2:${target.address().port}/secret` }).end();
  });
  await new Promise(resolve => bouncer.listen(0, '127.0.0.1', resolve));
  const html = `<iframe src="http://127.0.0.1:${bouncer.address().port}/go"></iframe>
    <img src="http://127.0.0.1:${bouncer.address().port}/img">`;

  const blocking = freshRender({ LOG_LEVEL: 'silent', EGRESS_ALLOW: '127.0.0.1' });
  const allowing = freshRender({ LOG_LEVEL: 'silent', EGRESS_ALLOW: '127.0.0.1,127.0.0.2' });
  try {
    await blocking.renderHtmlToBuffer(html, { png: true });
    assert.deepEqual(target.hits, [], 'the redirect target received nothing');

    await allowing.renderHtmlToBuffer(html, { png: true });
    assert.ok(target.hits.length > 0, 'control: the redirect is followed when its target is allowed');
  } finally {
    await blocking.closeBrowser();
    await allowing.closeBrowser();
    await new Promise(resolve => bouncer.close(resolve));
    await new Promise(resolve => target.close(resolve));
  }
});

test('rendered HTML cannot open a WebSocket to loopback unless EGRESS_ALLOW names it', opts, async () => {
  const server = http.createServer();
  const upgrades = [];
  server.on('upgrade', (req, socket) => { upgrades.push(req.url); socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const html = `<script>new WebSocket('ws://127.0.0.1:${server.address().port}/live')</script><h1>ws</h1>`;

  const blocking = freshRender({ LOG_LEVEL: 'silent' });
  const allowing = freshRender({ LOG_LEVEL: 'silent', EGRESS_ALLOW: '127.0.0.1' });
  try {
    await blocking.renderHtmlToBuffer(html, { png: true });
    assert.deepEqual(upgrades, [], 'no handshake reached the server');

    await allowing.renderHtmlToBuffer(html, { png: true });
    assert.ok(upgrades.length > 0, 'control: the handshake arrives when allowed');
  } finally {
    await blocking.closeBrowser();
    await allowing.closeBrowser();
    await new Promise(resolve => server.close(resolve));
  }
});

test('a dead host and the metadata address do not stall the render', opts, async () => {
  const render = freshRender({ LOG_LEVEL: 'silent', RENDER_TIMEOUT_MS: '30000' });
  try {
    const started = Date.now();
    const out = await render.renderHtmlToBuffer(
      '<img src="http://no-such-host.invalid/x.png"><img src="http://169.254.169.254/x.png"><h1>ok</h1>',
      { png: true }
    );
    assert.ok(out.buffer.length > 100);
    assert.ok(Date.now() - started < 15000, 'finished long before the deadline');
  } finally { await render.closeBrowser(); }
});

test('data: images and inline content still render', opts, async () => {
  const render = freshRender({ LOG_LEVEL: 'silent' });
  try {
    const dot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const out = await render.renderHtmlToBuffer(`<img src="${dot}"><p>รายงาน</p>`, {});
    assert.equal(out.buffer.subarray(0, 4).toString(), '%PDF');
  } finally { await render.closeBrowser(); }
});
