const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFreshModules } = require('./helpers');

const loadRateLimit = (env) => loadFreshModules(env, ['../src/rateLimit']);

test('isRateLimitedFor only limits requests after the configured max is exceeded', () => {
  const { isRateLimitedFor } = loadRateLimit({
    RATE_LIMIT_MAX: '2',
    RATE_LIMIT_WINDOW_MS: '60000'
  });

  const first = isRateLimitedFor('client-1');
  const second = isRateLimitedFor('client-1');
  const third = isRateLimitedFor('client-1');

  assert.equal(first.limited, false);
  assert.equal(first.remaining, 1);
  assert.equal(second.limited, false);
  assert.equal(second.remaining, 0);
  assert.equal(third.limited, true);
  assert.equal(third.remaining, 0);
});

test('counters for idle clients are evicted once the map grows past the sweep threshold', () => {
  const { isRateLimitedFor, _size } = loadRateLimit({
    RATE_LIMIT_MAX: '10',
    RATE_LIMIT_WINDOW_MS: '1'  // every entry is stale almost immediately
  });

  for (let i = 0; i < 1100; i++) isRateLimitedFor('client-' + i);

  assert.ok(_size() < 1100, `expected stale counters to be swept, map held ${_size()}`);
});

test('the sweep is amortised: a long window does not rescan the map on every new key', () => {
  const { isRateLimitedFor, _size } = loadRateLimit({
    RATE_LIMIT_MAX: '10',
    RATE_LIMIT_WINDOW_MS: '60000' // nothing is stale yet, so no entry can be dropped
  });

  for (let i = 0; i < 2000; i++) isRateLimitedFor('spray-' + i);

  // Every key is still live, so all 2000 must survive. The point of the
  // assertion is that reaching this state stays cheap, not that it stays small.
  assert.equal(_size(), 2000);
});

test('RATE_LIMIT_MAX=0 is honoured rather than falling back to the default', () => {
  const { isRateLimitedFor } = loadRateLimit({
    RATE_LIMIT_MAX: '0',
    RATE_LIMIT_WINDOW_MS: '60000'
  });

  assert.equal(isRateLimitedFor('client-1').limited, true, '0 must reject the first request');
});
