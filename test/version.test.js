const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

const files = ['VERSION', 'package.json', 'package-lock.json', 'README.md', 'documents/deployment.md'];
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn wrappers '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of [...files, ...['release.js', 'sync-version.js', 'version-control.mjs', 'version-targets.mjs'].map((name) => `scripts/${name}`)]) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(dir, name));
  }
  return dir;
}
function run(dir, name, ...args) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts', name), ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
}
function bytes(dir) { return files.map((name) => fs.readFileSync(path.join(dir, name))); }

test('actual CommonJS check and help are read-only from an unrelated CWD', (t) => {
  const dir = fixture(t), before = bytes(dir);
  assert.equal(run(dir, 'sync-version.js', '--check').status, 0);
  const help = run(dir, 'release.js', '--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /node scripts\/release\.js --tag/);
  assert.match(help.stdout, /Each release invocation prepares a NEW version/);
  assert.deepEqual(bytes(dir), before);
});

test('CommonJS wrappers reject missing operand and force without mutation', (t) => {
  const dir = fixture(t), before = bytes(dir);
  for (const args of [['--version'], ['--version='], ['--force'], ['--build']]) assert.notEqual(run(dir, 'release.js', ...args).status, 0);
  assert.deepEqual(bytes(dir), before);
});

test('each of six deployment anchors must match before any write', (t) => {
  const dir = fixture(t), file = path.join(dir, 'documents/deployment.md');
  const original = fs.readFileSync(file, 'utf8');
  for (const anchor of ['Pull the latest image:', 'Pull a specific version:', 'Specific version (', 'Year.month tag (', 'Year tag (', '(e.g., `v']) {
    assert.ok(original.includes(anchor));
    fs.writeFileSync(file, original.replace(anchor, 'REWORDED'));
    const before = bytes(dir);
    for (const name of ['sync-version.js', 'release.js']) {
      const result = run(dir, name);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /anchor-missing/);
      assert.deepEqual(bytes(dir), before);
    }
    assert.notEqual(run(dir, 'sync-version.js', '--check').status, 0);
    assert.deepEqual(bytes(dir), before);
  }
});

test('README insertion and deployment latest literal share check/sync rules', (t) => {
  const dir = fixture(t), readme = path.join(dir, 'README.md'), deployment = path.join(dir, 'documents/deployment.md');
  fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/\*\*Version:\*\* `[^`]+` \(CalVer\)\n/, ''));
  fs.writeFileSync(deployment, fs.readFileSync(deployment, 'utf8').replace('viewsarn:latest', 'viewsarn:old'));
  const before = bytes(dir);
  assert.notEqual(run(dir, 'sync-version.js', '--check').status, 0);
  assert.deepEqual(bytes(dir), before);
  const result = run(dir, 'sync-version.js');
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(readme, 'utf8'), /\*\*The Elite HTML-to-PDF\/PNG Conversion Engine\*\*\n\n\*\*Version:\*\*/);
  assert.match(fs.readFileSync(deployment, 'utf8'), /viewsarn:latest/);
  const synced = bytes(dir);
  assert.equal(run(dir, 'sync-version.js', '--check').status, 0);
  assert.equal(run(dir, 'sync-version.js').status, 0);
  assert.deepEqual(bytes(dir), synced);
});
