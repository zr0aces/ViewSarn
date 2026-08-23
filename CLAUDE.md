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

`server.js` is one top-level async IIFE: ensure output dir → `initBrowser()` → build Express app → listen. It holds all HTTP concerns; `src/` holds the logic.

- `src/config.js` — every env var is read **once at require time**. Anything that changes config must clear `require.cache` for `src/config.js` *and* the consuming module — `test/helpers.js` (`loadFreshModules`) does this for the tests. Its `num()` takes a `min`: `0` is valid for `PORT` and `RATE_LIMIT_MAX`, but a `0` concurrency or interval would wedge the service, so those floor at 1.
- `src/auth.js` — validates `Authorization: Bearer <key>` or `X-API-Key`. Precedence: keys file (`API_KEYS_FILE`, one key per line, `#` comments) wins over `API_KEY` env. **Fails open**: if neither is configured, `validateAuth` returns `valid: true` and the service is unauthenticated (server logs a warning at boot). The file is hot-reloaded on a `setInterval` (`API_KEYS_RELOAD_MS`, default 30s).
- `src/rateLimit.js` — fixed-window counter in an in-memory `Map`, **per process**. Multiple replicas do not share limits. Stale entries are swept once the map passes 1024 keys and at most once per window — sweeping per insert is O(n) per request under an IP spray, which is exactly the load a limiter faces. A new id and an expired window open a window through the same path, which is what lets `RATE_LIMIT_MAX=0` reject request one. Rate-limit identity is the API key when supplied, else the client IP.
- `src/render.js` — owns a **single module-level browser instance** shared by all requests; each request gets a fresh `BrowserContext`, closed in a `finally` (closing the context drops its pages — don't also close the page). Never launch a second browser; `initBrowser()` is idempotent and `closeBrowser()` runs on SIGTERM/SIGINT shutdown. Renders pass through a slot semaphore capped at `RENDER_CONCURRENCY`; overflow queues up to `RENDER_QUEUE_MAX`, then rejects with a `503`-tagged error. Every render races a `RENDER_TIMEOUT_MS` deadline (`504`) — `page.evaluate` has no timeout of its own, so without the deadline a wedged page pins its slot and enough of them stall the service. Errors carry `.status`, which `server.js` maps to the response code. `test/concurrency.test.js` covers all of it; getting the release path wrong deadlocks the service.

The interesting logic is the scale computation in `renderHtmlToBuffer`: measure rendered content size in-page, convert paper size + margins to px at 96 DPI, then `scale = availableWidth / contentWidth` (also fit height when `single`), clamped to 0.1–2. An explicit `options.scale` overrides the computed value. PDF passes `scale` to `page.pdf()`; PNG instead resizes the viewport and uses `deviceScaleFactor = dpi / 96`, with `fullPage` only when `single`.

`options.png`, `single`, `format` (A4/A5/LETTER/LEGAL), `orientation`, `margin`, `dpi`, `scale`, `filename` come from the request body; unknown formats silently fall back to A4.

`body.save: true` writes to `OUTPUT_DIR` and returns JSON metadata instead of streaming the file. `body.outPath` is joined under `OUTPUT_DIR` after stripping leading `../` — keep that normalization if you touch the save path.

Logging is Pino (`src/logger.js`), driven by `LOG_LEVEL`. `pino-pretty` is a **devDependency** and is only wired up when `NODE_ENV !== 'production'` — it costs a worker thread and emits non-parseable output, so production logs raw JSON. The Dockerfile installs with `--omit=dev`, so requiring `pino-pretty` unconditionally would crash the image on boot.

## Conventions

CommonJS (`require`/`module.exports`), 4-space indent in `src/`, 2-space in `server.js` and tests. No linter, no build step, no framework in tests — plain `node:test` + `node:assert/strict`.

## CI

`.github/workflows/docker-publish.yml` builds and pushes to GHCR **only on tags `v*` and published releases**. Nothing runs tests in CI — run `npm test` locally before pushing.

## Docs

`documents/specification.md` is the exception to "the code is the source of truth": it states what the service **must** do, as numbered `R-*` requirements with a change log explaining why each exists. Read it before changing request handling, auth, rate limiting, or the render limits — and if a change contradicts a requirement, update the requirement in the same commit rather than leaving the two disagreeing. It is also the Spec axis for `/code-review`, which previously had no spec to check against.

The rest of `documents/` (architecture, api_docs, deployment, development, fonts) explains how the service works and how to run it. That prose is hand-maintained and can drift; where it disagrees with the code, the code wins.
