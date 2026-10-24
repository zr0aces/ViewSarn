# Plan 03: Browser lifecycle and resource limits

Fixes F-02, F-03, F-07, F-13. Depends on plans 01 and 02 (per-key cap uses the principal).

## Current state (verified)

- `src/render.js:16-28` `initBrowser()` caches `browser` forever; no `isConnected` check, no `disconnected` listener.
- `render.js:99-100` `initBrowser()` runs before `acquireSlot(signal)`; the signal never reaches the render work (R5).
- `render.js:199-208` `finally` awaits `context.close()` unbounded before `releaseSlot()`.
- `render.js:154-172` PNG: `targetWidth/Height` from `contentSize × scale`; `fullPage: !!opts.single` (R1: the screenshot covers the document, not the resized viewport).
- `server.js:23-25` IIFE has no catch; `server.js:248-255` shutdown has no deadline, no re-entry guard.
- `/health` (`server.js:230`) never consults the browser.

## Steps

### 1. Measure first (Docker)

Run the image. For a page of 1k, 10k, 20k CSS px tall and width 800, request PNG at dpi 96, 300, 600 with `single: true`, and record peak container RSS (`docker stats --no-stream`, sampled at 100 ms). Record results in this plan's EXECUTE notes. Choose `MAX_PNG_PIXELS` so peak RSS for one render stays within the per-render share of the compose memory budget (about 150 MB per the compose comment). Starting guess: 40,000,000 device pixels. Choose `MAX_PDF_PAGES` (starting guess 200). Cannot run on the audit host.

### 2. Browser ownership (F-02)

`src/render.js`:

```js
let browser = null, launching = null, closing = false;
async function getBrowser() {
    if (closing) throw httpError(503, 'Service is shutting down');
    if (browser && browser.isConnected()) return browser;
    if (!launching) {
        launching = chromium.launch({ args: [...], headless: true })
            .then((b) => {
                browser = b;
                b.on('disconnected', () => { if (browser === b) browser = null; logger.warn('Browser disconnected'); });
                return b;
            })
            .finally(() => { launching = null; });
    }
    return launching;
}
```

`initBrowser = getBrowser` (name kept for `server.js` and tests). `closeBrowser` sets `closing = true` first. Export `browserReady = () => !!browser && browser.isConnected()`.
In `renderHtmlToBuffer`, wrap `getBrowser()` failure as `httpError(503, 'Browser unavailable')` with the cause logged. Keep the call before `acquireSlot` (R5).

`src/app.js` `/health`: `if (!browserReady()) return res.status(503).json({ ok: false, browser: 'disconnected' })`. Inject `browserReady` in `createApp`.

Bound the close: `await Promise.race([context.close(), new Promise(r => setTimeout(r, 5000))]).catch(() => {})` in the `finally`; the timer is cleared when close wins.

Tests (`test/browserLifecycle.test.js`, stubbing `playwright` through `require.cache` as `test/renderTimeout.test.js` does): after a stub browser emits `disconnected` the next render relaunches; two concurrent calls launch once; `closeBrowser` followed by render gives 503; `/health` is 503 when `browserReady()` is false.

Commit: `fix(render): relaunch a dead browser and report it on /health`.

### 3. Abort during render (F-13)

In `renderHtmlToBuffer`, add a third racer:

```js
let onAbort;
const aborted = new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) return reject(httpError(499, 'Client closed the request'));
    onAbort = () => reject(httpError(499, 'Client closed the request'));
    signal.addEventListener('abort', onAbort, { once: true });
});
aborted.catch(() => {});
// race: [work, deadline, aborted]; in finally: if (onAbort) signal.removeEventListener('abort', onAbort);
```
The existing `finally` already closes the context and releases the slot. `server.js` already drops 499 silently. Update spec R-1.20 (abort now covers rendering).

Test: start a stub render that never resolves, abort the signal, assert rejection with status 499, slot released (`_inFlight().active === 0`) and context closed.

Commit: `fix(render): stop rendering when the client disconnects`.

### 4. Startup and shutdown (F-13, R12)

`server.js`: wrap the IIFE body in `try { ... } catch (err) { logger.fatal({ err }, 'Startup failed'); process.exit(1); }`.

Shutdown:

```js
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return; shuttingDown = true;
  logger.info({ signal }, 'Received shutdown signal');
  const force = setTimeout(() => { logger.error('Shutdown timed out'); process.exit(1); }, SHUTDOWN_TIMEOUT_MS);
  force.unref();
  server.close(async () => {
    try { await closeBrowser(); } catch (err) { logger.error({ err }, 'closeBrowser failed'); }
    process.exit(0);
  });
  server.closeIdleConnections?.();
};
```
After a short grace (for example 5 s), call `server.closeAllConnections()` so a stuck keep-alive cannot block exit. Config: `SHUTDOWN_TIMEOUT_MS` (default 10000).

Test: stub a failing `initBrowser` and run `server.js` as a child process with the stub preload; expect exit code 1 and one fatal log line.

Commit: `fix(server): handle startup failure and bound shutdown`.

### 5. Size ceilings (F-03, R1)

New pure module `src/limits.js`:

```js
function pngPixels({ contentSize, targetWidth, targetHeight, single, dsf }) {
    const w = single ? Math.max(contentSize.width, targetWidth) : targetWidth;
    const h = single ? Math.max(contentSize.height, targetHeight) : targetHeight;
    return Math.ceil(w * dsf) * Math.ceil(h * dsf);
}
function pdfPages({ contentHeight, scale, availableHeightPx }) {
    return Math.ceil((contentHeight * scale) / availableHeightPx);
}
```
`src/config.js`: `MAX_PNG_PIXELS`, `MAX_PDF_PAGES` (values from step 1).

In `renderHtmlToBuffer`, directly after `scale` is final and before `setViewportSize` or `page.pdf`: if over the limit, `throw httpError(413, 'Rendered output would exceed the size limit')`. Do not lower `dpi` silently. Add 413 handling note to the app error path (it already echoes non-500 messages).

Tests: table-driven unit tests for `pngPixels` and `pdfPages` (single vs non-single, dsf 6.25, scale override 2 with wide content). Stub-render test that a 20,000 px tall page at dpi 600 gives 413 before any viewport call.

Commit: `fix(render): cap PNG pixels and PDF pages`.

### 6. Queue wait and per-key cap (F-07)

`render.js` `acquireSlot`: when queuing, start `setTimeout(RENDER_QUEUE_WAIT_MS)` that removes the entry and rejects with `httpError(503, 'Timed out waiting for a render slot')`. Clear the timer in `entry.resolve` and `onAbort`. Config: `RENDER_QUEUE_WAIT_MS` (default 30000).

`src/app.js`: `const inflight = new Map()` keyed by `req.principal.id`. In `/convert`, after validation and before the render: when `MAX_INFLIGHT_PER_KEY > 0` and `(inflight.get(id) || 0) >= MAX_INFLIGHT_PER_KEY`, respond 429 with `Retry-After: 5`. Increment, and decrement exactly once in `res.on('close')`. Config: `MAX_INFLIGHT_PER_KEY`, default 0 (off), parsed with `num(..., 0, 0)`. A cap equal to `RENDER_CONCURRENCY` would make the queue unreachable for any single key, so a batch caller that sends 10 requests at once would get 429 on 8 of them instead of queueing. Shared deployments opt in; a good starting value is half of `RENDER_QUEUE_MAX`. Document this in `deployment.md`.

Tests: with `mock.timers`, a queued request rejects with 503 after `RENDER_QUEUE_WAIT_MS` and `_inFlight().waiting` returns to 0. HTTP test: with cap 1, a second concurrent request from the same key gets 429 while a different key proceeds; counter returns to 0 after completion and after client abort.

Commit: `feat(render): bound queue wait and per-key concurrency`.

### 7. Metrics, spec and docs

Metrics (`src/app.js`): add `viewsarn_render_oversize_total` (413 from step 5) and `viewsarn_per_key_limited_total` (per-key 429). Count a queue-wait 503 under the existing `rejected` counter. Add a metrics test for each.

Spec: new requirements for health-503, size ceilings, queue wait, per-key cap; update R-1.20. `documents/deployment.md` and `docker-compose.yml`: new env vars.

## Acceptance

- Killing Chromium in Docker (`docker exec … pkill -f chrome`): the next `/convert` succeeds (relaunch) or `/health` returns 503 within one check.
- A 20k px page at dpi 600 gives 413 and the container stays under budget.
- With `MAX_INFLIGHT_PER_KEY=1`, a second concurrent request from one key gets 429 and another key is served. With the default (0), a burst of 10 requests all complete via the queue.
- `npm test` passes.

## Risks and rollback

- Relaunch while requests are in flight: those fail with 503; check their slots release (step 2 test).
- Limits that are too low reject legitimate pages; all are env-tunable.
- Revert per commit.

## EXECUTE notes (2026-10-24)

- Step 1 measured in the image (headless shell, 2 GB, 1 CPU, `RENDER_CONCURRENCY=1`), 780 px wide `single` PNG at dpi 96: peak cgroup memory 243 MB at 3M device pixels, 432 MB at 15M, 1005 MB at 39M, 1854 MB at 78M, over a 142 MB idle browser. That is about 22 bytes per pixel. The default `MAX_PNG_PIXELS` moved from the 40M estimate to 25M so two concurrent renders fit the 2 GB compose limit. `MAX_PDF_PAGES` (200) is still unmeasured. dpi 300 and 600 were not run separately: the device-pixel count already folds dpi in.
- Killing Chromium in a running container was not exercised; recovery is covered by the stub-browser tests (`test/browserLifecycle.test.js`).
