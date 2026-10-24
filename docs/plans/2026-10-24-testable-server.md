# Plan 01: Testable server

Enabler for HTTP-level tests (audit §6.1). `server.js` has no tests, and F-01, F-08, F-10, F-14 all live there. No behavior change in this plan.

## Current state

`server.js` is one async IIFE (lines 23-260) that calls `initBrowser()`, builds the Express app inline, and listens. It closes over `metrics` (line 65) and imports `validateAuth`, `isRateLimitedFor`, `renderHtmlToBuffer`, `_inFlight` directly. `src/auth.js` reads the keys file synchronously and starts a `setInterval` at import (R13), so a test that imports `server.js` pulls in real auth, a real browser launch, and a bound port.

## Steps

### 1. Extract `src/app.js`

Create `src/app.js` (4-space indent) exporting:

```js
function createApp({ config, logger, auth, limiter, render, validate, httpErrors }) {
    // auth    = { validateAuth, isAuthFileInUse }            (plan 02 adds authConfigured)
    // limiter = { isRateLimitedFor }
    // render  = { renderHtmlToBuffer, inFlight }             (plan 03 adds browserReady)
    // validate = { validateOptions }                         (plan 04 adds validateBody)
    // httpErrors = { bodyErrorHandler }
    // Later plans add fields to these objects and to config; the signature does not change.
    const app = express();
    const metrics = { requests: 0, renders: 0, failures: 0, rejected: 0, timeouts: 0, unauthorized: 0, rateLimited: 0 };
    // ...everything from server.js lines 27-236, unchanged...
    return { app, metrics };
}
module.exports = { createApp, ensureDir };
```

Move `ensureDir` (server.js lines 17-21) into this file. Replace destructured config constants (`PORT`, `OUTPUT_DIR`, `RATE_LIMIT_MAX`, `BODY_LIMIT`, `TRUST_PROXY`, `CORS_ORIGINS`, `METRICS_ENABLED`, `RATE_LIMIT_WINDOW_MS`) with `config.X`. Keep middleware order, log fields, and responses byte-identical. `render.inFlight` replaces `renderInFlight`; `auth.validateAuth`, `limiter.isRateLimitedFor`, and `validate.validateOptions` replace the direct imports.

### 2. Slim `server.js`

Keep only: require real modules, `ensureDir(OUTPUT_DIR)`, `initBrowser()`, `createApp({...real deps})`, `app.listen`, the startup warning, and the shutdown handlers (lines 238-258). Target under about 60 lines. Stay CommonJS, 2-space indent.

### 3. Test helper `test/httpHelpers.js`

```js
async function start(app) {
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}
```
Use global `fetch`. No supertest. Add a `makeDeps(overrides)` factory returning the stub `deps` object: `auth.validateAuth` accepting key `k1`, `limiter.isRateLimitedFor` with a counter, `render.renderHtmlToBuffer` returning `{buffer: Buffer.from('%PDF-stub'), scale: 1, contentSize: {width: 1, height: 1}, paper: 'A4', orientation: 'portrait'}`, `logger` writing JSON lines to an array so tests can inspect log output.

### 4. Characterization tests `test/app.test.js`

Each test calls `createApp(makeDeps(...))`, `start`, asserts, `close`:

1. 401 with no key; 200 with `Authorization: Bearer k1`; 200 with `X-API-Key: k1`.
2. 429 with `Retry-After`, `X-RateLimit-*` after the limiter stub trips.
3. Stub render throws `{status: 503}` → 503 plus `Retry-After: 5`; `{status: 504}` → 504; plain `Error('x')` → 500 body `Internal render error` and the message `x` absent from the response.
4. `html` missing → 400 JSON with `request_id`; oversized body → 413 JSON; malformed JSON → 400 JSON.
5. `save: true` with a temp `OUTPUT_DIR` writes a file and returns `path`, `filename`, `size`.
6. `/health` returns `ok: true`; `/metrics` returns counters when enabled, 404 when disabled.
7. `X-Request-Id` is echoed.

### 5. Mark known defects as `todo`

Add tests with `{ todo: 'F-01' }` etc. asserting the desired behavior, so they stay visible without failing the suite:
- F-01: captured logs do not contain `k1`.
- F-08: `filename: "รายงาน.pdf"` returns 200.
- F-10: `outPath: {a:1}` returns 400.
- F-14: unknown route returns JSON 404.
Later plans remove the `todo` flag.

### 6. Cross-check against the old server (once)

Before deleting the old inline code, run old and new `server.js` with the audit stub preload (`/tmp/claude-1001/-home-san-workspace-ViewSarn/aa557acc-fa48-4820-9c8c-20817e8d24a6/scratchpad/stub.js`, or recreate: it replaces `playwright` with a fake `chromium.launch`) and diff the response status, headers (minus `Date`, `X-Request-Id`) and body for ten scripted requests. Discard the script afterwards.

## Acceptance

- `npm test` passes, new tests included. `server.js` under about 60 lines.
- The ten-request diff is empty.
- `test/app.test.js` never imports `src/auth.js`, `src/render.js`, or `playwright`.

## Risks and rollback

Moving code can alter middleware order. The step 6 diff is the guard. Single-commit revert restores the previous file.

## EXECUTE notes (2026-10-24, recorded 2026-10-25)

- The ten-request diff ran against the old and new `server.js` with the stub preload: identical status, headers and bodies apart from the random request id.
- `server.js` is 80 lines, over the 60-line target, because plans 02 and 03 added the fail-closed startup check and bounded shutdown to it. The HTTP layer is entirely in `src/app.js`.
- `test/app.test.js` imports only `test/httpHelpers.js` and, in one test, `src/rateLimit.js` through `loadFreshModules`; never `src/auth.js`, `src/render.js` or `playwright`.
