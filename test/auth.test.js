const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { loadFreshModules } = require('./helpers');

const loadFreshAuthModule = (env) => loadFreshModules(env, ['../src/auth']);

function makeRequest(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    get(name) {
      return normalized[name.toLowerCase()];
    }
  };
}

test('validateAuth accepts the configured bearer token', () => {
  const auth = loadFreshAuthModule({
    API_KEY: 'sample-key',
    API_KEYS_FILE: path.join(__dirname, 'missing-apikeys.txt'),
    API_KEYS_RELOAD_MS: '1000'
  });

  const result = auth.validateAuth(makeRequest({ authorization: 'Bearer ' + 'sample-key' }));

  assert.equal(result.valid, true);
  assert.equal(result.authRequired, true);
  assert.match(result.principal.id, /^k:[0-9a-f]{64}$/);
  assert.equal(result.principal.label, result.principal.id.slice(2, 14));
  assert.ok(!JSON.stringify(result).includes('sample-key'), 'the raw key must not be returned');
});

test('validateAuth rejects an invalid bearer token when API key auth is enabled', () => {
  const auth = loadFreshAuthModule({
    API_KEY: 'sample-key',
    API_KEYS_FILE: path.join(__dirname, 'missing-apikeys.txt'),
    API_KEYS_RELOAD_MS: '1000'
  });

  const result = auth.validateAuth(makeRequest({ authorization: 'Bearer ' + 'invalid-key' }));

  assert.equal(result.valid, false);
  assert.equal(result.authRequired, true);
  assert.equal(result.principal, null);
});

test('validateAuth accepts a key from the keys file and rejects one that is not in it', () => {
  const keysFile = path.join(__dirname, 'fixtures-apikeys.txt');
  fs.writeFileSync(keysFile, '# a comment\nfile-key-one\n\nfile-key-two\n', 'utf8');

  try {
    const auth = loadFreshAuthModule({
      API_KEY: 'env-key-that-must-be-ignored',
      API_KEYS_FILE: keysFile,
      API_KEYS_RELOAD_MS: '1000'
    });

    assert.equal(auth.isAuthFileInUse(), true, 'the keys file must take precedence over API_KEY');
    assert.equal(auth.validateAuth(makeRequest({ authorization: 'Bearer file-key-one' })).valid, true);
    assert.equal(auth.validateAuth(makeRequest({ 'x-api-key': 'file-key-two' })).valid, true, 'x-api-key must work too');
    assert.equal(auth.validateAuth(makeRequest({ authorization: 'Bearer nope' })).valid, false);
    assert.equal(
      auth.validateAuth(makeRequest({ authorization: 'Bearer env-key-that-must-be-ignored' })).valid,
      false,
      'API_KEY must not be honoured while a non-empty keys file is in use'
    );
    assert.equal(auth.validateAuth(makeRequest({ authorization: 'Bearer # a comment' })).valid, false);
  } finally {
    fs.rmSync(keysFile, { force: true });
  }
});

// ---- fail-closed behavior (audit F-04) ----

const os = require('node:os');
const tmpKeys = (content) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-keys-')), 'apikeys.txt');
  if (content !== null) fs.writeFileSync(file, content, 'utf8');
  return file;
};
const bearer = (key) => makeRequest({ authorization: `Bearer ${key}` });

test('nothing configured: requests are refused, not served open', () => {
  const auth = loadFreshAuthModule({ API_KEYS_FILE: tmpKeys(null), API_KEY: '' });
  assert.equal(auth.authConfigured(), false);
  const result = auth.validateAuth(bearer('anything'));
  assert.equal(result.valid, false);
  assert.equal(result.authRequired, true);
});

test('AUTH_DISABLED=true with nothing configured: open, and no principal', () => {
  const auth = loadFreshAuthModule({ API_KEYS_FILE: tmpKeys(null), API_KEY: '', AUTH_DISABLED: 'true' });
  const result = auth.validateAuth(bearer('rotating-guess'));
  assert.equal(result.valid, true);
  assert.equal(result.authRequired, false);
  assert.equal(result.principal, null);
});

test('an empty or comment-only keys file is not "configured"', () => {
  for (const content of ['', '# only a comment\n\n']) {
    const auth = loadFreshAuthModule({ API_KEYS_FILE: tmpKeys(content), API_KEY: '' });
    assert.equal(auth.authConfigured(), false);
    assert.equal(auth.validateAuth(bearer('x')).valid, false);
  }
});

test('a directory at the keys path is not "configured"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-keys-dir-'));
  const auth = loadFreshAuthModule({ API_KEYS_FILE: dir, API_KEY: '' });
  assert.equal(auth.authConfigured(), false);
  assert.equal(auth.validateAuth(bearer('x')).valid, false);
});

test('keys survive one empty read and are revoked by a second', async () => {
  const file = tmpKeys('key-one\n');
  const auth = loadFreshAuthModule({ API_KEYS_FILE: file, API_KEY: '' });
  assert.equal(auth.validateAuth(bearer('key-one')).valid, true);

  fs.writeFileSync(file, '');                       // half-written rotation
  await auth._reloadKeys();
  assert.equal(auth.validateAuth(bearer('key-one')).valid, true, 'one empty read keeps the old keys');

  await auth._reloadKeys();                         // still empty: a real revocation
  assert.equal(auth.validateAuth(bearer('key-one')).valid, false);
  assert.equal(auth.authConfigured(), false);
});

test('a non-empty read between two empty reads resets the count', async () => {
  const file = tmpKeys('key-one\n');
  const auth = loadFreshAuthModule({ API_KEYS_FILE: file, API_KEY: '' });
  fs.writeFileSync(file, '');
  await auth._reloadKeys();
  fs.writeFileSync(file, 'key-two\n');
  await auth._reloadKeys();
  assert.equal(auth.validateAuth(bearer('key-two')).valid, true);
  fs.writeFileSync(file, '');
  await auth._reloadKeys();
  assert.equal(auth.validateAuth(bearer('key-two')).valid, true, 'the count restarted after the good read');
});

test('a deleted keys file follows the same two-read rule', async () => {
  const file = tmpKeys('key-one\n');
  const auth = loadFreshAuthModule({ API_KEYS_FILE: file, API_KEY: '' });
  fs.rmSync(file);
  await auth._reloadKeys();
  assert.equal(auth.validateAuth(bearer('key-one')).valid, true);
  await auth._reloadKeys();
  assert.equal(auth.validateAuth(bearer('key-one')).valid, false);
});

test('AUTH_DISABLED ignores a rotating X-API-Key: one rate-limit bucket, not one per request', async () => {
  const { boot } = require('./httpHelpers');
  const auth = loadFreshAuthModule({ API_KEYS_FILE: tmpKeys(null), API_KEY: '', AUTH_DISABLED: 'true' });
  const limiter = loadFreshModules({}, ['../src/rateLimit']);
  const s = await boot({ auth, limiter });
  try {
    for (let i = 0; i < 20; i++) {
      await fetch(`${s.url}/health`, { headers: { 'X-API-Key': `guess-${i}` } });
      await fetch(`${s.url}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': `guess-${i}` },
        body: JSON.stringify({ html: '<p>x</p>' })
      });
    }
    assert.equal(limiter._size(), 1);
  } finally { await s.close(); }
});
