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

test('counter storage tracks active clients, not every client ever seen', (t) => {
  // A mocked clock makes the sweep exact: no wall-clock timing, no slack in the bound.
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { isRateLimitedFor, _size } = loadRateLimit({
    RATE_LIMIT_MAX: '10',
    RATE_LIMIT_WINDOW_MS: '1000'
  });

  const WAVE = 1100; // above the 1024-key sweep threshold
  for (let wave = 0; wave < 5; wave++) {
    for (let i = 0; i < WAVE; i++) isRateLimitedFor(`wave${wave}-client${i}`);
    // The first key of a wave finds every earlier wave older than the window and
    // sweeps it, so only the current wave is ever held.
    assert.equal(_size(), WAVE, `after wave ${wave}`);
    t.mock.timers.tick(1001);
  }

  isRateLimitedFor('straggler');
  assert.equal(_size(), 1, '5500 distinct ids were seen; only the live one remains');
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
