const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { saveBuffer, _resetSizeCache } = require('../src/save');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-save-'));
const save = (root, over = {}) => saveBuffer({ root, label: 'aaa', outPath: null, defaultName: 'out.pdf', buffer: Buffer.from('x'), ...over });
const status = (code) => (err) => err.status === code;

test('writes under <root>/<label>/ and returns a relative path', async () => {
  const root = tmp();
  const r = await save(root, { outPath: 'sub/dir/a.pdf' });
  assert.equal(r.path, path.join('aaa', 'sub', 'dir', 'a.pdf'));
  assert.equal(r.filename, 'a.pdf');
  assert.equal(fs.readFileSync(path.join(root, r.path), 'utf8'), 'x');
});

test('traversal and absolute paths cannot leave the caller directory', async () => {
  const root = tmp();
  for (const outPath of ['../b.pdf', '../../../../tmp/evil.pdf', 'a/../../b.pdf', '..', 'a/../..']) {
    await assert.rejects(() => save(root, { outPath }), status(400), outPath);
  }
  // A leading slash is tolerated as before: it lands inside the directory.
  const r = await save(root, { outPath: '/etc/x.pdf' });
  assert.equal(r.path, path.join('aaa', 'etc', 'x.pdf'));
  assert.equal(fs.existsSync('/etc/x.pdf'), false);
});

test('a symlink inside the directory cannot be used to write outside it, nor to create directories there', async () => {
  const root = tmp();
  const outside = tmp();
  fs.mkdirSync(path.join(root, 'aaa'));
  fs.symlinkSync(outside, path.join(root, 'aaa', 'link'));
  await assert.rejects(() => save(root, { outPath: 'link/new/a.pdf' }), status(400));
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing was created outside');
});

test('two labels saving the same outPath write different files', async () => {
  const root = tmp();
  const a = await save(root, { label: 'aaa', outPath: 'same.pdf', buffer: Buffer.from('A') });
  const b = await save(root, { label: 'bbb', outPath: 'same.pdf', buffer: Buffer.from('B') });
  assert.notEqual(a.path, b.path);
  assert.equal(fs.readFileSync(path.join(root, a.path), 'utf8'), 'A');
  assert.equal(fs.readFileSync(path.join(root, b.path), 'utf8'), 'B');
});

test('a repeated filename or outPath overwrites inside the same directory', async () => {
  const root = tmp();
  await save(root, { defaultName: 'invoice.pdf', buffer: Buffer.from('one') });
  const again = await save(root, { defaultName: 'invoice.pdf', buffer: Buffer.from('two') });
  assert.equal(fs.readFileSync(path.join(root, again.path), 'utf8'), 'two');
  await save(root, { outPath: 'x.pdf', buffer: Buffer.from('1') });
  await save(root, { outPath: 'x.pdf', buffer: Buffer.from('2') });
  assert.equal(fs.readFileSync(path.join(root, 'aaa', 'x.pdf'), 'utf8'), '2');
});

test('the quota returns 507 and counts what was already saved', async () => {
  _resetSizeCache();
  const root = tmp();
  await save(root, { outPath: 'a.pdf', buffer: Buffer.alloc(60), maxBytes: 100 });
  await assert.rejects(() => save(root, { outPath: 'b.pdf', buffer: Buffer.alloc(60), maxBytes: 100 }), status(507));
  await save(root, { label: 'bbb', outPath: 'b.pdf', buffer: Buffer.alloc(60), maxBytes: 100 });   // other key unaffected
});

test('maxBytes 0 means no quota', async () => {
  _resetSizeCache();
  const root = tmp();
  await save(root, { buffer: Buffer.alloc(5000), maxBytes: 0 });
});
