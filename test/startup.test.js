const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// server.js exits before it touches the browser when auth is not configured, so
// these run without Chromium.
function runServer(env) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { PATH: process.env.PATH, NODE_ENV: 'production', LOG_LEVEL: 'info', OUTPUT_DIR: os.tmpdir(), PORT: '0', ...env },
    encoding: 'utf8',
    timeout: 15_000
  });
}

test('startup refuses to run with no key source', () => {
  const r = runServer({ API_KEYS_FILE: path.join(os.tmpdir(), 'viewsarn-definitely-missing.txt') });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /No API key configured/);
});

test('startup explains a keys path that is a directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-keys-dir-'));
  const r = runServer({ API_KEYS_FILE: dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /is a directory/);
});

test('a browser that cannot launch is a clean fatal exit, not an unhandled rejection', () => {
  const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'fixtures', 'failingPlaywright.js'), path.join(__dirname, '..', 'server.js')], {
    env: { PATH: process.env.PATH, NODE_ENV: 'production', LOG_LEVEL: 'info', OUTPUT_DIR: os.tmpdir(), PORT: '0', API_KEY: 'k' },
    encoding: 'utf8',
    timeout: 15_000
  });
  assert.equal(r.status, 1);
  const out = r.stdout + r.stderr;
  assert.match(out, /Startup failed/);
  assert.doesNotMatch(out, /unhandled/i);
});
