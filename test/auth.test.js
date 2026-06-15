const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadFreshAuthModule(env) {
  const previous = {
    API_KEY: process.env.API_KEY,
    API_KEYS_FILE: process.env.API_KEYS_FILE,
    API_KEYS_RELOAD_MS: process.env.API_KEYS_RELOAD_MS,
    LOG_LEVEL: process.env.LOG_LEVEL
  };

  Object.assign(process.env, env);
  process.env.LOG_LEVEL = 'silent';

  const configPath = require.resolve('../src/config');
  const loggerPath = require.resolve('../src/logger');
  const authPath = require.resolve('../src/auth');

  delete require.cache[configPath];
  delete require.cache[loggerPath];
  delete require.cache[authPath];

  const auth = require('../src/auth');

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return auth;
}

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
