const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFreshModules } = require('./helpers');

const loadConfig = (env) => loadFreshModules(env, ['../src/config']);

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

test('EGRESS_ALLOW with a malformed CIDR refuses to load, like BODY_LIMIT', () => {
  assert.throws(() => loadConfig({ EGRESS_ALLOW: '10.0.0.0/99' }), /EGRESS_ALLOW entry "10.0.0.0\/99"/);
});
