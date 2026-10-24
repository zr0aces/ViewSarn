const test = require('node:test');
const assert = require('node:assert/strict');
const { contentDisposition } = require('../src/contentDisposition');

const decode = (header) => decodeURIComponent(header.split("UTF-8''")[1]);

test('plain ASCII keeps both parameters', () => {
  assert.equal(contentDisposition('report.pdf'), `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
});

test('Thai names get an ASCII fallback and a decodable UTF-8 name', () => {
  const header = contentDisposition('รายงาน.pdf');
  assert.match(header, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.equal(decode(header), 'รายงาน.pdf');
  assert.doesNotThrow(() => { const h = new Headers(); h.set('Content-Disposition', header); });
});

test('spaces and the RFC 5987 reserved characters are encoded', () => {
  const header = contentDisposition("my file (1)'*.pdf");
  assert.ok(!/['()*]/.test(header.split("UTF-8''")[1]), header);
  assert.equal(decode(header), "my file (1)'*.pdf");
});

test('a quote or backslash cannot end the quoted fallback early', () => {
  const header = contentDisposition('a"b\\c.pdf');
  assert.match(header, /^attachment; filename="a_b_c\.pdf"; /);
});
