# Plan 02: Auth and secrets

Fixes F-01, F-04, F-06, F-09, F-11. Depends on plan 01. Highest risk, ship first.

## Current state (verified)

- `src/auth.js:68-93` `validateAuth(req)` returns `{ valid, authRequired, provided }`. `provided` is the raw key.
- `server.js:85` `id = provided || req.ip`; `server.js:101` `req.authId = id`; `server.js:152` logs `auth: req.authId`. This is F-01.
- `src/auth.js:31-40` `applyKeyFileError`: `ENOENT` clears the key set and sets `apiKeysFileExists = false` (R3). Other errors keep the old set. At startup (`auth.js:58-63`) `EISDIR` leaves the set empty, so auth is off.
- `src/auth.js:81` auth applies only if `apiKeysFileExists && apiKeySet.size > 0`; a file read as empty replaces the set with an empty one.
- `server.js:72` `isHealth` covers `/health` and `/metrics`.
- `server.js:78-82` returns 401 before the limiter runs (F-11).

## Steps

### 1. Principal instead of raw key (F-01)

`src/auth.js`: add

```js
const principalFor = (key) => { const hex = digestHex(key); return { id: `k:${hex}`, label: hex.slice(0, 12) }; };
```

`validateAuth` returns `{ valid, authRequired, principal }`, where `principal` is `principalFor(provided)` only when the key is valid, else `null`. Remove `provided` from the return value. Update `test/auth.test.js` for the new shape.

`src/app.js` auth middleware (R4): `const principal = valid && authRequired ? p : { id: req.ip || 'unknown', label: 'anon' }`; rate-limit with `principal.id` (full digest, no bucket collisions); set `req.principal = principal`. Log `auth: req.principal.label` at the completion log line. Never put the raw key on `req`.

Test: remove the plan-01 `todo` on F-01. Assert the captured log output contains neither `k1` nor the full digest.

Commit: `fix(auth): log a key label, never the key`.

### 2. Fail closed (F-04)

`src/config.js`: `AUTH_DISABLED: process.env.AUTH_DISABLED === 'true'`.

`src/auth.js`:
- New export `authConfigured()` returns `(apiKeysFileExists && apiKeySet.size > 0) || !!API_KEY_ENV` (R2).
- `applyKeyFileError` and `loadApiKeysFromFile` (R3): other read errors keep the previous keys and warn. A missing file (`ENOENT`) or a file that parses to zero keys is counted in `emptyReads`. The first such read keeps the current set and warns (tolerates a half-written file during rotation). The second consecutive one accepts the empty set, so emptying the file still revokes the last key within two reload ticks. Any non-empty read resets `emptyReads` to 0. With zero keys accepted and no `API_KEY`, `validateAuth` returns `valid: false` (below), so revocation closes the service rather than opening it.
- Startup `EISDIR` is handled by step 2's startup check below, not by silent fallback.
- `validateAuth`: when `AUTH_DISABLED` is true and nothing is configured, `authRequired = false`. When not disabled and nothing is configured, return `valid: false` (defense in depth if the startup check is bypassed).

`server.js` startup, before `listen`:

```js
if (!authConfigured() && !AUTH_DISABLED) {
  logger.fatal({ file: API_KEYS_FILE }, 'No API key configured. Set API_KEY, mount API_KEYS_FILE with at least one key, or set AUTH_DISABLED=true.');
  process.exit(1);
}
```
Add a hint when `fs.statSync(API_KEYS_FILE).isDirectory()`: "is a directory; create the file before docker compose up".

When `AUTH_DISABLED` is true, `src/app.js` ignores both key headers entirely and keys the limiter by IP only.

Docs: spec R-2.3 (open mode now explicit), R-2.5 (keep previous keys on empty file and on `ENOENT`), change log; `docker-compose.yml` comment ("create apikeys.txt first"); `documents/deployment.md`.

Tests (`test/auth.test.js`, using `loadFreshModules` with temp files): empty file, comment-only file, one empty read after load keeps old keys, a second consecutive empty read clears them (revocation works), the same two-read rule for a deleted file, a non-empty read in between resets the count, directory at the path gives `authConfigured() === false`. HTTP test: `AUTH_DISABLED` ignores a rotating `X-API-Key` (limiter map size stays 1).

Commit: `feat(auth)!: fail closed unless AUTH_DISABLED=true`.

### 3. Dependencies and `BODY_LIMIT` (F-06)

1. `npm audit fix --omit=dev --dry-run`. If it only bumps `express` within the current major, run it without `--dry-run`. Otherwise pin `express` to the first version whose tree reports clean, and note it.
2. `src/config.js`: parse `BODY_LIMIT`. Accept a positive integer or `/^\d+(\.\d+)?\s*(b|kb|mb|gb)?$/i`. Anything else throws at load (`Error('BODY_LIMIT is invalid: ...')`), so the server cannot start with the cap disabled.
3. Add `.github/workflows/audit.yml` running `npm audit --omit=dev --audit-level=high`. Triggers: weekly `schedule`, `workflow_dispatch`, and pushes or PRs that touch `package.json` or `package-lock.json`. Do not run it on every push: a new advisory would turn every unrelated PR red. Plan 06 also runs the same command in `docker-publish.yml` before an image is pushed.
4. Tests: valid and invalid `BODY_LIMIT` values through `loadFreshModules`.
5. Run `npm test`, then a real render in Docker (the Express bump can change body-parser behavior).

Commit: `chore(deps): fix audit findings, validate BODY_LIMIT, gate CI`.

### 4. Committed key (F-09)

`test-convert.js:19`: replace the literal with `process.env.API_KEY`; print usage and exit 1 if unset. Owner action (not code): rotate the key that was committed. History rewrite only if decision 3 says so.

Commit: `fix(test): read API key from env in test-convert.js`.

### 5. Failed-auth throttle and public endpoints (F-11, R8, R10)

`src/rateLimit.js`: add a limit parameter: `function isRateLimitedFor(id, max = RATE_LIMIT_MAX)` (same body, compare to `max`). No read-only check is needed.

`src/config.js`: `AUTH_FAIL_MAX` (default 30, `num(..., 30, 1)`).

`src/app.js` middleware order: validate the key first. A valid key always passes. On an invalid key, call `isRateLimitedFor('authfail:' + ip, AUTH_FAIL_MAX)`: if it says limited, answer 429 with `Retry-After`, else 401. Do not block before validating: `TRUST_PROXY` is off by default, so behind a proxy every client shares one IP, and a pre-check would lock out valid users because of one bad client.

Split `isHealth` into `isHealth` and `isMetrics`. `/health` stays unauthenticated. `/metrics` requires auth when `authConfigured()` (decision 2). Remove `pid` from `/health`.

Tests: the 31st wrong key from one IP gets 429 and a correct key from the same IP still gets 200; `/health` has no `pid`; `/metrics` returns 401 without a key when auth is on.

Commit: `fix(auth): throttle failed attempts, protect /metrics, trim /health`.

### 6. Docs

Update spec requirements and change log, `documents/deployment.md`, `documents/api_docs.md` (`/metrics` auth, 429 on repeated 401).

## Acceptance

- Captured logs contain no key and no full digest.
- Start with no key source and no `AUTH_DISABLED`: exit code 1 with the message.
- One empty or missing keys-file read after load leaves old keys valid; two in a row clear them.
- `npm audit --omit=dev --audit-level=high` exits 0 and runs in `audit.yml`, not on every push.
- `npm test` and `npm run version:check` pass.

## Risks and rollback

- Open deployments stop starting; fix is `AUTH_DISABLED=true`. Needs a release note.
- Old logs still hold keys; the owner must rotate them and expire the logs.
- Revert per commit. `AUTH_DISABLED=true` restores open mode without a revert.

## EXECUTE notes (2026-10-24, recorded 2026-10-25)

- Logs: `test/app.test.js` asserts neither the key nor the principal's full digest is logged. The digest assertion was missing until the code review of PR #5 added it.
- Exit 1 with no key source: `test/startup.test.js`, including the keys path that is a directory.
- Two-read rule: `test/auth.test.js`.
- `npm audit --omit=dev --audit-level=high` exits 0 (0 vulnerabilities) and runs in `audit.yml` on a schedule and on `package*.json` changes, plus as a hard gate in `docker-publish.yml`. Its first GitHub run passed on PR #5.
