const test = require('node:test');
const assert = require('node:assert/strict');

function loadConfig(env) {
  const previous = {};
  for (const key of Object.keys(env)) { previous[key] = process.env[key]; process.env[key] = env[key]; }
  delete require.cache[require.resolve('../src/config')];
  try {
    return require('../src/config');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    delete require.cache[require.resolve('../src/config')];
  }
}

test('BODY_LIMIT accepts bytes and sized strings', () => {
  for (const value of ['1048576', '15mb', '15MB', '1.5 gb', '512kb', '100b']) {
    assert.equal(loadConfig({ BODY_LIMIT: value }).BODY_LIMIT, value);
  }
});

test('BODY_LIMIT defaults to 15mb when unset or empty', () => {
  assert.equal(loadConfig({ BODY_LIMIT: '' }).BODY_LIMIT, '15mb');
});

test('BODY_LIMIT rejects values body-parser would silently ignore', () => {
  for (const value of ['abc', '15 megabytes', '-5mb', '0', '15mb;', 'mb']) {
    assert.throws(() => loadConfig({ BODY_LIMIT: value }), /BODY_LIMIT is invalid/, value);
  }
});
