const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, post } = require('./httpHelpers');

const html = { html: '<h1>hi</h1>' };

test('auth: 401 without a key, 200 with Bearer and with X-API-Key', async () => {
  const s = await boot();
  try {
    const none = await fetch(`${s.url}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(html) });
    assert.equal(none.status, 401);
    assert.match(none.headers.get('www-authenticate'), /Bearer/);
    assert.equal((await none.json()).error, 'Unauthorized');

    assert.equal((await post(s.url, html)).status, 200);
    const viaHeader = await post(s.url, html, { Authorization: '', 'X-API-Key': 'k1' });
    assert.equal(viaHeader.status, 200);
  } finally { await s.close(); }
});

test('rate limit: 429 with Retry-After and limit headers', async () => {
  const s = await boot({ rateLimitAfter: 1 });
  try {
    const ok = await post(s.url, html);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('x-ratelimit-limit'), '120');
    const limited = await post(s.url, html);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '30');
    assert.equal((await limited.json()).retry_after_seconds, 30);
  } finally { await s.close(); }
});

test('render errors map to 503, 504, and a generic 500', async () => {
  const fail = (status, message) => ({ render: { renderHtmlToBuffer: async () => { throw Object.assign(new Error(message), { status }); } } });

  let s = await boot(fail(503, 'queue full'));
  try {
    const r = await post(s.url, html);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('retry-after'), '5');
    assert.equal((await r.json()).error, 'queue full');
  } finally { await s.close(); }

  s = await boot(fail(504, 'too slow'));
  try { assert.equal((await post(s.url, html)).status, 504); } finally { await s.close(); }

  s = await boot({ render: { renderHtmlToBuffer: async () => { throw new Error('secret internal detail'); } } });
  try {
    const r = await post(s.url, html);
    const text = await r.text();
    assert.equal(r.status, 500);
    assert.match(text, /Internal render error/);
    assert.doesNotMatch(text, /secret internal detail/);
  } finally { await s.close(); }
});

test('body errors are JSON with a request_id', async () => {
  const s = await boot();
  try {
    const missing = await post(s.url, {});
    assert.equal(missing.status, 400);
    assert.ok((await missing.json()).request_id);

    const malformed = await post(s.url, '{bad');
    assert.equal(malformed.status, 400);
    assert.match(malformed.headers.get('content-type'), /json/);

    const big = await post(s.url, { html: 'x'.repeat(200_000) });
    assert.equal(big.status, 413);
    assert.match(big.headers.get('content-type'), /json/);
    assert.ok((await big.json()).request_id);
  } finally { await s.close(); }
});

test('invalid options return 400', async () => {
  const s = await boot();
  try {
    const r = await post(s.url, { ...html, options: { format: 'Z9' } });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /format/);
  } finally { await s.close(); }
});

test('success response carries the pdf and the request id', async () => {
  const s = await boot();
  try {
    const r = await post(s.url, { ...html, options: { filename: 'a.pdf' } }, { 'X-Request-Id': 'trace-1' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="a.pdf"');
    assert.equal(r.headers.get('x-request-id'), 'trace-1');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString(), '%PDF-stub');
  } finally { await s.close(); }
});

test('save: true writes under OUTPUT_DIR and returns metadata', async () => {
  const s = await boot();
  try {
    const r = await post(s.url, { ...html, save: true, outPath: 'sub/out.pdf' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.filename, 'out.pdf');
    assert.equal(body.size, 9);
    assert.equal(body.path, path.join(s.outputDir, 'sub', 'out.pdf'));
    assert.equal(fs.readFileSync(body.path, 'utf8'), '%PDF-stub');
  } finally { await s.close(); }
});

test('/health is open; /metrics reports counters', async () => {
  const s = await boot();
  try {
    const health = await fetch(`${s.url}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.ok, true);
    assert.equal('pid' in healthBody, false, '/health must not expose the process id');

    await post(s.url, html);
    const metrics = await (await fetch(`${s.url}/metrics`, { headers: { Authorization: 'Bearer k1' } })).text();
    assert.match(metrics, /viewsarn_renders_total 1/);
  } finally { await s.close(); }
});

test('/metrics needs a key when auth is configured, and is open when it is not', async () => {
  let s = await boot();
  try { assert.equal((await fetch(`${s.url}/metrics`)).status, 401); } finally { await s.close(); }

  s = await boot({ auth: { authConfigured: () => false } });
  try { assert.equal((await fetch(`${s.url}/metrics`)).status, 200); } finally { await s.close(); }
});

test('/metrics is 404 when disabled', async () => {
  const s = await boot({ config: { METRICS_ENABLED: false } });
  try { assert.equal((await fetch(`${s.url}/metrics`, { headers: { Authorization: 'Bearer k1' } })).status, 404); } finally { await s.close(); }
});

test('wrong keys past AUTH_FAIL_MAX get 429, and a correct key from the same IP still works', async () => {
  const { loadFreshModules } = require('./helpers');
  const limiter = loadFreshModules({ RATE_LIMIT_MAX: '1000' }, ['../src/rateLimit']);
  const s = await boot({ limiter, config: { AUTH_FAIL_MAX: 3 } });
  try {
    const wrong = () => post(s.url, html, { Authorization: 'Bearer nope' });
    assert.deepEqual([(await wrong()).status, (await wrong()).status, (await wrong()).status], [401, 401, 401]);
    const blocked = await wrong();
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    assert.equal((await post(s.url, html)).status, 200, 'a valid key is never throttled by failed attempts');
  } finally { await s.close(); }
});

// Known defects from the 2026-10-24 audit. Each asserts the desired behavior and is
// marked todo until the fixing plan lands.
test('F-01: the API key never reaches the logs', async () => {
  const s = await boot();
  try {
    await post(s.url, html);
    assert.doesNotMatch(JSON.stringify(s.logs), /k1/);
    assert.ok(s.logs.some(l => l.auth === 'abc123def456'), 'the key label is logged instead');
  } finally { await s.close(); }
});

test('F-08: a Thai filename is served', { todo: 'F-08 plan 04' }, async () => {
  const s = await boot();
  try {
    const r = await post(s.url, { ...html, options: { filename: 'รายงาน.pdf' } });
    assert.equal(r.status, 200);
  } finally { await s.close(); }
});

test('F-10: a non-string outPath is a 400', { todo: 'F-10 plan 04' }, async () => {
  const s = await boot();
  try {
    const r = await post(s.url, { ...html, save: true, outPath: { a: 1 } });
    assert.equal(r.status, 400);
  } finally { await s.close(); }
});

test('F-14: an unknown route is a JSON 404', { todo: 'F-14 plan 04' }, async () => {
  const s = await boot();
  try {
    const r = await fetch(`${s.url}/nope`, { headers: { Authorization: 'Bearer k1' } });
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /json/);
  } finally { await s.close(); }
});
