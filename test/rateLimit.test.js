const test = require('node:test');
const assert = require('node:assert/strict');

function loadFreshRateLimitModule(env) {
  const previous = {
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS
  };

  Object.assign(process.env, env);

  const configPath = require.resolve('../src/config');
  const rateLimitPath = require.resolve('../src/rateLimit');

  delete require.cache[configPath];
  delete require.cache[rateLimitPath];

  const rateLimit = require('../src/rateLimit');

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return rateLimit;
}

test('isRateLimitedFor only limits requests after the configured max is exceeded', () => {
  const { isRateLimitedFor } = loadFreshRateLimitModule({
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
