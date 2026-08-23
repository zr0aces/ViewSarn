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
  assert.equal(result.provided, 'sample-key');
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
  assert.equal(result.provided, 'invalid-key');
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
