# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ViewSarn is a single-process Express service that renders HTML to PDF or PNG via Playwright Chromium, with baked-in Thai/English fonts. One endpoint does the work: `POST /convert`. Node >= 24 (`engines` in package.json).

## Commands

```bash
npm start                          # node server.js
npm test                           # node --test test/*.test.js
node --test test/auth.test.js      # single test file
node --test --test-name-pattern='rate' test/rateLimit.test.js  # single test

npm run release                    # bump CalVer version (YYYY.M.MINOR) and sync files
npm run version:sync               # sync version from VERSION file to target files
npm run version:check              # check that all files match VERSION file (CI gate)

docker compose up --build          # full stack with fonts (see caveat below)
node test-convert.js               # manual smoke test against a RUNNING server on :3000
./convert-cli.sh --file page.html --png --single --output out.png   # CLI client, --help for all flags
```

Local `npm start` needs `OUTPUT_DIR` overridden — it defaults to `/output`, a container path:

```bash
OUTPUT_DIR=./output API_KEY=dev-key LOG_LEVEL=debug npm start
```

Fonts (Sarabun, Noto Sans Thai, Google Sans) are installed into the OS font cache by the **Dockerfile only** (`fc-cache`). Thai rendering fidelity cannot be validated with a native `npm start` unless those fonts are installed on the host — verify font-sensitive changes in Docker.

## Architecture

`server.js` is startup only: refuse to boot with no key source, then `main()` ensures the output dir, calls `initBrowser()`, builds the app with `createApp()` and listens; it also owns bounded shutdown. `src/app.js` `createApp({config, logger, auth, limiter, render, validate, httpErrors})` holds every HTTP concern, with collaborators injected so `test/app.test.js` drives the whole HTTP layer through stubs (`test/httpHelpers.js`) — no browser, no keys file, no `src/auth.js` import.

- `src/config.js` — every env var is read **once at require time**. Anything that changes config must clear `require.cache` for `src/config.js` *and* the consuming module — `test/helpers.js` (`loadFreshModules`) does this for the tests. Its `num()` takes a `min`: `0` is valid for `PORT` and `RATE_LIMIT_MAX`, but a `0` concurrency or interval would wedge the service, so those floor at 1.
- `src/auth.js` — validates `Authorization: Bearer <key>` or `X-API-Key`. Precedence: keys file (`API_KEYS_FILE`, one key per line, `#` comments) wins over `API_KEY` env. **Fails closed**: with neither configured, `server.js` exits 1 unless `AUTH_DISABLED=true`. A valid key becomes a principal `{ id: 'k:'+sha256, label: first 12 hex }`; logs and rate limits use that, never the key. The file is hot-reloaded on a `setInterval` (`API_KEYS_RELOAD_MS`, default 30s), and a missing or empty file must be seen on two consecutive reloads before keys are dropped, so a mid-write read does not lock everyone out.
- `src/rateLimit.js` — fixed-window counter in an in-memory `Map`, **per process**. Multiple replicas do not share limits. Stale entries are swept once the map passes 1024 keys and at most once per window — sweeping per insert is O(n) per request under an IP spray, which is exactly the load a limiter faces. A new id and an expired window open a window through the same path, which is what lets `RATE_LIMIT_MAX=0` reject request one. Rate-limit identity is the key's principal when supplied, else the client IP — and `req.ip` is the proxy's address unless `TRUST_PROXY` is set (`src/app.js` passes it to Express `trust proxy`), which silently merges every anonymous caller into one bucket.
- `src/render.js` — owns a **single module-level browser instance** shared by all requests; each request gets a fresh `BrowserContext`, closed in a `finally` (closing the context drops its pages — close only the context). Never launch a second browser: `getBrowser()` (exported as `initBrowser`) shares one launch promise, relaunches after a `disconnected` event, and `browserReady()` drives the `503` on `/health`. Renders pass through a slot semaphore capped at `RENDER_CONCURRENCY`; overflow queues up to `RENDER_QUEUE_MAX` for at most `RENDER_QUEUE_WAIT_MS`, then rejects with `503`. Every render races a `RENDER_TIMEOUT_MS` deadline (`504`) and the client's abort signal (`499`) — `page.evaluate` has no timeout of its own, so without the deadline a wedged page pins its slot and enough of them stall the service. `MAX_PNG_PIXELS` and `MAX_PDF_PAGES` (`src/limits.js`) refuse oversized output with `413` before rendering. Errors carry `.status`, which `src/app.js` maps to the response code. `test/concurrency.test.js` and `test/browserLifecycle.test.js` cover this; getting the release path wrong deadlocks the service.
- `src/egress.js` — every request the rendered page makes goes through `handleRoute`, which blocks private, loopback and link-local addresses unless `EGRESS_ALLOW` names them. Chromium routes only the **first** URL of a redirect chain — also when the redirect came from `route.fulfill` — so `handleRoute` fetches with `maxRedirects: 0` through the context's `APIRequestContext`, checks every `Location` hop itself, and fulfills the browser with the final response. Keep http(s) on that path: `route.continue()` or a fulfilled `3xx` lets Chromium follow the next hop unchecked. WebSockets bypass `context.route`; `handleWebSocket` checks them through `context.routeWebSocket`. `test/browser/egress.test.js` proves this against real Chromium (`RUN_BROWSER_TESTS=1`, in the image).

The interesting logic is the scale computation in `renderHtmlToBuffer`: measure rendered content size in-page, convert paper size + margins to px at 96 DPI, then `scale = availableWidth / contentWidth` (also fit height when `single`), clamped to 0.1–2. An explicit `options.scale` overrides the computed value. PDF passes `scale` to `page.pdf()`; PNG instead resizes the viewport and uses `deviceScaleFactor = dpi / 96`, with `fullPage` only when `single`.

`options.png`, `single`, `format` (A4/A5/LETTER/LEGAL), `orientation`, `margin`, `dpi`, `scale`, `filename` come from the request body. `src/validate.js` rejects unknown values with `400`; `render.js` owns the defaults (`paperFor()` in `src/paper.js` is the one A4 default). A numeric `margin` is millimetres, and `0` means no margin.

Every error body is JSON with `error` and `request_id`, including the `413`/malformed-`400` the body parser raises before any route — an error handler mounted straight after `express.json()` converts those, since Express's default would answer with HTML. A `500` deliberately returns a generic message; the real error goes to the log under the request id. `options` is validated in `src/validate.js` before rendering rather than coerced, and `src/httpErrors.js` holds the body-parser error middleware. `test/validate.test.js` covers both.

A client disconnect is detected with an `AbortController` fired from `res.on('close')` guarded by `res.writableFinished`, **not** `req.signal`: in Express 5 that signal is already aborted when the handler runs, so using it rejects every render as a disconnect and the request hangs with no response.

`body.save: true` writes to `OUTPUT_DIR/<key label>/` (`src/save.js`) and returns JSON metadata with a path relative to `OUTPUT_DIR`, instead of streaming the file. `body.outPath` is resolved under that directory; anything that escapes it, by `..` or a symlink, is a `400` rather than a silent rewrite — keep that check if you touch the save path. `OUTPUT_MAX_BYTES` caps one key's directory (`507`).

Logging is Pino (`src/logger.js`), driven by `LOG_LEVEL`. `pino-pretty` is a **devDependency** and is only wired up when `NODE_ENV !== 'production'` — it costs a worker thread and emits non-parseable output, so production logs raw JSON. The Dockerfile installs with `--omit=dev`, so requiring `pino-pretty` unconditionally would crash the image on boot.

## Conventions

Application code and `.js` entries remain CommonJS (`require`/`module.exports`). Release/sync wrappers dynamically import repository-local `.mjs` CalVer core/inventory; this is the scoped release-tooling exception. 4-space indent in `src/`; 2-space in `server.js`, `test/`, and `scripts/`. No linter, no build step, no framework in tests — plain `node:test` + `node:assert/strict`.

## Release Tooling

Root VERSION is authoritative. Default release prepares only (bump, metadata sync, check); `--tag` opts into an exact-path commit and annotated local tag. Build is unsupported; nothing pushes. Run `npm run release -- --help` for examples; to tag an already-prepared version, use printed Git commands instead of rerunning release. `npm run version:check` is read-only; `node --test scripts/version-control.test.mjs` tests the shared tooling.

## CI

`.github/workflows/ci.yml` runs `npm test` and `npm run version:check` on every push and pull request, and builds the image and runs `scripts/smoke.js` (a Thai PDF and PNG plus a font check) against it. `.github/workflows/docker-publish.yml` builds, smoke-tests and Trivy-scans the image, then pushes to GHCR **only on tags `v*` and published releases**.

## Docs

`documents/specification.md` is the exception to "the code is the source of truth": it states what the service **must** do, as numbered `R-*` requirements with a change log explaining why each exists. Read it before changing request handling, auth, rate limiting, or the render limits — and if a change contradicts a requirement, update the requirement in the same commit rather than leaving the two disagreeing. It is also the Spec axis for `/code-review`, which previously had no spec to check against.

The rest of `documents/` (architecture, api_docs, deployment, development, fonts) explains how the service works and how to run it. That prose is hand-maintained and can drift; where it disagrees with the code, the code wins.

## Plans

When creating a plan file under `docs/plans/`, the filename must include the creation date using the format `YYYY-MM-dd-plan-name.md`.
Use the actual date when the plan is created.
Use a clear, descriptive name for `plan-name`.

Example: `2026-09-12-document-figures-alignment.md`
