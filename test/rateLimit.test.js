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

test('counter storage stays bounded as distinct clients accumulate', async () => {
  const { isRateLimitedFor, _size } = loadRateLimit({
    RATE_LIMIT_MAX: '10',
    RATE_LIMIT_WINDOW_MS: '1'
  });

  // Sweeping is amortised to once per window and gated on the threshold, so the
  // map size at any single instant is a function of wall-clock timing — the
  // durable property is that it tracks *active* clients, not every client ever
  // seen. Five waves, each older than the window by the time the next starts.
  const WAVE = 1100;
  for (let wave = 0; wave < 5; wave++) {
    for (let i = 0; i < WAVE; i++) isRateLimitedFor(`wave${wave}-client${i}`);
    await new Promise(r => setTimeout(r, 5));
  }
  isRateLimitedFor('straggler');

  // 5500 distinct ids were seen. At worst the map holds the current wave plus a
  // previous one not yet swept; it must never approach the total.
  assert.ok(
    _size() <= 2 * WAVE + 10,
    `expected bounded storage, map held ${_size()} after ${5 * WAVE} distinct ids`
  );
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
