const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOptions, validateBody } = require('../src/validate');
const { bodyErrorHandler } = require('../src/httpErrors');

const ok = (options) => assert.equal(validateOptions(options), null, `expected ${JSON.stringify(options)} to be accepted`);
const rejects = (options, pattern) => assert.match(
  validateOptions(options) || '',
  pattern,
  `expected ${JSON.stringify(options)} to be rejected`
);

test('absent or empty options are accepted', () => {
  ok(undefined);
  ok(null);
  ok({});
});

test('options must be an object', () => {
  rejects([], /"options" must be an object/);
  rejects('A4', /"options" must be an object/);
});

test('format accepts the four paper sizes, case-insensitively', () => {
  for (const format of ['A4', 'a4', 'A5', 'letter', 'LEGAL']) ok({ format });
  rejects({ format: 'A3' }, /options\.format/);
  rejects({ format: 'Tabloid' }, /options\.format/);
  rejects({ format: 4 }, /options\.format/);
  // Would resolve to an inherited property under a bare object lookup.
  rejects({ format: 'constructor' }, /options\.format/);
});

test('orientation and waitUntil accept only their known values', () => {
  ok({ orientation: 'portrait' });
  ok({ orientation: 'landscape' });
  rejects({ orientation: 'sideways' }, /options\.orientation/);

  ok({ waitUntil: 'load' });
  ok({ waitUntil: 'networkidle' });
  rejects({ waitUntil: 'whenever' }, /options\.waitUntil/);
});

test('margin accepts the units the renderer actually parses', () => {
  ok({ margin: '10mm' });
  ok({ margin: '1cm' });
  ok({ margin: '0.5in' });
  ok({ margin: '10' });
  ok({ margin: 0 });
  // px is not parsed by parseMarginToMm — accepting it would silently mean mm.
  rejects({ margin: '10px' }, /options\.margin/);
  rejects({ margin: 'wide' }, /options\.margin/);
});

test('dpi and scale are bounded', () => {
  ok({ dpi: 96 });
  ok({ dpi: 600 });
  rejects({ dpi: 0 }, /options\.dpi/);
  rejects({ dpi: 1200 }, /options\.dpi/);
  rejects({ dpi: 'high' }, /options\.dpi/);

  ok({ scale: null });
  ok({ scale: 0.1 });
  ok({ scale: 2 });
  rejects({ scale: 0 }, /options\.scale/);
  rejects({ scale: 5 }, /options\.scale/);
});

test('filename may not carry a path', () => {
  ok({ filename: 'report.pdf' });
  ok({ filename: null });
  rejects({ filename: '../../etc/passwd' }, /options\.filename/);
  rejects({ filename: 'nested/report.pdf' }, /options\.filename/);
  rejects({ filename: 'back\\slash.pdf' }, /options\.filename/);
  rejects({ filename: 42 }, /options\.filename/);
});

// --- body parser error handler -------------------------------------------

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('an oversized body is reported as JSON, naming the limit', () => {
  const res = fakeRes();
  bodyErrorHandler({ bodyLimit: '15mb' })(
    Object.assign(new Error('too big'), { type: 'entity.too.large', status: 413 }),
    { requestId: 'req-1' },
    res,
    () => assert.fail('next must not be called for a real error')
  );

  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { error: 'Request body exceeds the 15mb limit', request_id: 'req-1' });
});

test('a malformed body is reported as JSON, without echoing the parser message', () => {
  const res = fakeRes();
  bodyErrorHandler({ bodyLimit: '15mb' })(
    Object.assign(new Error('Unexpected token o in JSON at position 1'), { type: 'entity.parse.failed', status: 400 }),
    { requestId: 'req-2' },
    res,
    () => assert.fail('next must not be called for a real error')
  );

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Malformed JSON body', request_id: 'req-2' });
});

test('the handler passes non-errors along untouched', () => {
  let called = false;
  bodyErrorHandler({ bodyLimit: '15mb' })(null, {}, fakeRes(), () => { called = true; });
  assert.equal(called, true);
});

test('png and single must be booleans', () => {
  ok({ png: true, single: false });
  rejects({ png: 'false' }, /options\.png/);
  rejects({ png: 1 }, /options\.png/);
  rejects({ single: 'true' }, /options\.single/);
});

test('filename rejects quotes, control characters and long names', () => {
  ok({ filename: 'รายงาน.pdf' });
  ok({ filename: 'my report (final).pdf' });
  rejects({ filename: 'a"b.pdf' }, /options\.filename/);
  rejects({ filename: 'a\r\nSet-Cookie: x' }, /options\.filename/);
  rejects({ filename: 'a\0b' }, /options\.filename/);
  rejects({ filename: 'x'.repeat(201) }, /options\.filename/);
  rejects({ filename: 'a/b.pdf' }, /options\.filename/);
});

test('a margin that leaves no printable area is rejected for the chosen paper', () => {
  ok({ margin: '10mm' });
  ok({ margin: 0 });
  rejects({ margin: '200mm' }, /printable area/);
  rejects({ margin: 150, format: 'A5' }, /printable area/);
  ok({ margin: '60mm', format: 'A4' });
});

test('save must be a boolean and outPath a non-empty string', () => {
  assert.equal(validateBody({}), null);
  assert.equal(validateBody({ save: true, outPath: 'a/b.pdf' }), null);
  assert.match(validateBody({ save: 'false' }), /"save"/);
  assert.match(validateBody({ save: 1 }), /"save"/);
  assert.match(validateBody({ outPath: { a: 1 } }), /"outPath"/);
  assert.match(validateBody({ outPath: 5 }), /"outPath"/);
  assert.match(validateBody({ outPath: '' }), /"outPath"/);
  assert.match(validateBody({ outPath: 'a\0b' }), /"outPath"/);
});
