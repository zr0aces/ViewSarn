const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
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
