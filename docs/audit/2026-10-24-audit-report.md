# ViewSarn Engineering Audit — 2026-10-24

Commit audited: `facd5c7` (branch `main`, clean tree). Version `2026.8.3`.
**Coverage: PARTIAL.** All runtime code, tests, CI, Docker, and scripts were read. Prose docs (except the spec) and two files were not read line by line; Chromium could not run on the audit host. See §9.

---

## 1. Executive Summary

**System.** Single-process Express 5 service (`server.js`, 260 lines) with five modules in `src/`. `POST /convert` takes `{html, options, save, outPath}` and renders PDF/PNG in one shared Playwright Chromium browser. Each request gets a fresh `BrowserContext`. Renders pass a slot semaphore (`RENDER_CONCURRENCY`, queue `RENDER_QUEUE_MAX`) and race a `RENDER_TIMEOUT_MS` deadline. Auth is Bearer/`X-API-Key` against a hot-reloaded keys file or `API_KEY`. Rate limiting is an in-memory fixed window. `GET /health` and optional `/metrics` skip auth. Shipped as a Docker image (Node 24, baked Thai/English fonts) with GHCR publish on tags. No database, queue, or cache.

**Top risks**

| Area | Risk | IDs |
|---|---|---|
| Security | Plaintext API key written to INFO logs on every request (confirmed by execution). Real-looking key committed in `test-convert.js` and in git history. Auth fails open on a missing, empty, or directory-mounted keys file. | F-01, F-09, F-04 |
| Reliability | A dead Chromium is never relaunched, and `/health` stays `ok:true`, so the container is never restarted. One caller can hold every render slot. | F-02, F-07 |
| Resource | No cap on rendered pixel count (`dpi` ≤ 600 × unbounded page size). A single request can exceed the 2 GB container budget. | F-03 |
| Correctness | Thai/non-Latin-1 `filename` returns 500 after a full render (confirmed). This is a Thai-first service. | F-08 |
| Dependencies | `npm audit --omit=dev`: 1 critical (`proxy-addr`), 1 high (`body-parser`), 1 moderate (`qs`), all via `express@5.2.1`. | F-06 |
| Testing | The browser boundary, HTTP layer (`server.js`), and `save` path have zero automated tests. | §6 |

**Needs deeper investigation.** Chromium behaviour could not be exercised here (missing system libs, no root). F-02, F-03, F-05 rest on code reading plus documented Playwright behaviour. Verify them in the Docker image before acting on severity.

---

## 2. Findings

### [F-01] [HIGH] — API key written to logs in plaintext
- **Category:** Security / secrets handling
- **Location:** `server.js:85` (`id = provided || req.ip`), `server.js:101` (`req.authId = id`), `server.js:152` (`auth: req.authId`)
- **Confidence:** High — reproduced.
- **Problem:** The rate-limit identity is the raw presented key. It is reused as the log field `auth`. Every successful `/convert` logs the full key at INFO.
- **Evidence:** Ran the server with `API_KEY=test-secret-key-123` and a stubbed browser. Log line: `{"level":30,...,"auth":"test-secret-key-123","size":9,"mode":"pdf",...,"msg":"Convert request completed"}`. 5 occurrences in one short run.
- **Impact:** Anyone with log access (aggregators, support staff, shared dashboards) obtains live credentials. Keys are long-lived and file-based.
- **How it can occur:** Any authenticated request in production (`LOG_LEVEL=info` is the default).
- **Recommended fix:** In the auth middleware set `req.authId` to a short non-reversible label (first 8 hex chars of the SHA-256 digest `auth.js` already computes), or a key name from the keys file. Use it for both the rate-limit key and logging. Rotate every key that has already reached logs.
- **Expected impact:** Removes credential exposure through logs. Rate-limit behaviour is unchanged.

### [F-02] [HIGH] — Browser death is permanent; health check cannot see it
- **Category:** Reliability
- **Location:** `src/render.js:16-28` (`browser` cached forever), `src/render.js:116` (`b.newContext`), `server.js:230` (`/health`)
- **Confidence:** Medium. By code; Chromium crash not reproduced here.
- **Problem:** `initBrowser()` returns the cached handle without checking `browser.isConnected()`. There is no `'disconnected'` listener. If the Chromium process dies (OOM kill, `/dev/shm` exhaustion, renderer-manager crash), every later `newContext()` throws and every `/convert` returns 500. `/health` returns `ok:true` regardless. Compose `restart: unless-stopped` only reacts to process exit, and the healthcheck only probes `/health`.
- **Evidence:** No reference to `disconnected` or `isConnected` anywhere in `src/` or `server.js`. `/health` body does not touch `render.js`.
- **Impact:** Full outage with a green health check until a human restarts the container. Likelier under F-03 and F-07.
- **How it can occur:** Chromium OOM-killed by the kernel while Node survives (the cgroup kills the largest process). Also GPU/zygote crash.
- **Recommended fix:** In `initBrowser`, relaunch when `!browser || !browser.isConnected()`, serialised with a shared launch promise to avoid double launch. Register `browser.on('disconnected', () => { browser = null; })`. Make `/health` return 503 when the browser is not connected so orchestrators restart the container. Cap `context.close()` with a timeout so a wedged close cannot pin a slot (`render.js:206` awaits unbounded before `releaseSlot()`).
- **Expected impact:** Self-heals a crash. Removes the silent-outage failure mode.

### [F-03] [HIGH] — Output size is unbounded (PNG `dpi` × page dimensions)
- **Category:** Resource / availability
- **Location:** `src/render.js:103-106, 154-172`, `src/validate.js:27` (dpi ≤ 600), `docker-compose.yml:41-47` (memory budget)
- **Confidence:** Medium. By code; no Chromium benchmark was possible.
- **Problem:** For PNG, `deviceScaleFactor = dpi/96` (up to 6.25) and the viewport is set to `contentSize × scale`. `contentSize` is whatever the HTML lays out. `scale` is only floored at 0.1. Nothing bounds width × height × DSF². PDF has no page-count bound beyond the 60 s deadline.
- **Evidence:** Example: a 20 000 × 20 000 px body, `png:true, single:true, dpi:600` gives scale 0.1, so about 2 000 × 2 000 CSS px, about 12 500 × 12 500 device px, about 600 MB raw bitmap before PNG encoding. The compose budget assumes about 150 MB per render. The 15 MB body limit does not constrain layout size.
- **Impact:** One authenticated request (or any request when auth is open) can OOM the container or crash Chromium, which then triggers F-02.
- **How it can occur:** Buggy or hostile caller sends a tall page with high `dpi`.
- **Recommended fix:** After measuring, compute `pixels = targetWidth × targetHeight × dsf²`. Reject with 413/422 above a configured `MAX_PNG_PIXELS`, and reduce `dsf` or refuse when over. Add a `MAX_CONTENT_PX` check on `contentSize`. Add a PDF page-count ceiling (check page size before `page.pdf`).
- **Expected impact:** Bounds peak render memory to what the compose comments already promise.

### [F-04] [HIGH] — Authentication fails open on several realistic misconfigurations
- **Category:** Security / secure defaults
- **Location:** `src/auth.js:58-63, 81-90`, `server.js:240-241`, `docker-compose.yml:16, 74`
- **Confidence:** High on mechanism. Documented as deliberate (spec R-2.3, §6), but the consequences are not.
- **Problem:** Auth is enforced only if the keys file loaded with at least one key, or `API_KEY` is set. Otherwise every request is served. Cases that silently reach "open":
  1. `apikeys.txt` missing before `docker compose up`. Docker creates a *directory* at the bind-mount source, so `readFile` fails with `EISDIR` (not `ENOENT`), the key set stays empty, and the service is open. The compose file's only key source is that mount.
  2. A non-atomic key rotation (truncate, then write) overlapping the 30 s reload tick. Reload sees an empty file, sets `apiKeysFileExists=true` with zero keys, and falls through to `API_KEY` or open (`auth.js:81` requires `size > 0`).
  3. A file that holds only comments.
  When open, `req.authId` is the attacker-supplied `X-API-Key` string (`server.js:85`). Rotating that header gives a fresh rate-limit bucket per request, so the limiter is bypassed. Each bucket key can be up to ~16 KB, so the map grows unbounded within a window.
- **Evidence:** Code paths above. The "No API key configured" warning is the only signal (`server.js:240`).
- **Impact:** Unauthenticated PDF/PNG rendering and, with `save:true`, unauthenticated disk writes. Combined with F-05 it is an open SSRF proxy.
- **Recommended fix:** Fail closed. Require `AUTH_DISABLED=true` as an explicit opt-out; otherwise refuse to start when no key source resolves. Treat a present-but-empty keys file as "keep previous keys" like R-2.5. When auth is off, always rate-limit by IP and ignore the key header. Update spec R-2.3.
- **Expected impact:** Misconfiguration becomes a startup error instead of an open service.

### [F-05] [MEDIUM] — Caller HTML runs with full network reach and `--no-sandbox`
- **Category:** Security
- **Location:** `src/render.js:21-24, 125` (launch args, `setContent`); no `page.route` anywhere
- **Confidence:** Medium. Not exercised (no Chromium here). It is the standard HTML-to-PDF SSRF class.
- **Problem:** HTML can include `fetch`, `<img>`, `<iframe>`, `<link>` to any host reachable from the container (cloud metadata `169.254.169.254`, sidecars, other internal services) and render the response into the returned PDF/PNG. Chromium runs with `--no-sandbox` as `www-data`, so a renderer exploit has the container user's reach.
- **Evidence:** Spec R-0.5 and §6 state callers are trusted and `/convert` must not face untrusted users. The deployment guide does not state the SSRF consequence.
- **Impact:** Internal-network data disclosure if any key holder, or any caller under F-04, is not fully trusted.
- **Recommended fix:** `context.route('**/*', ...)` to block private, link-local, and loopback ranges after DNS resolution. Consider blocking `file:`. Set `javaScriptEnabled:false` as an option for static documents. Run the container with a seccomp profile and drop `--no-sandbox` where possible (`--cap-add SYS_ADMIN` or a profile). Document the threat in `deployment.md`.
- **Expected impact:** Contains the blast radius of a leaked key or open deployment.

### [F-06] [MEDIUM] — Known-vulnerable transitive dependencies
- **Category:** Dependencies
- **Location:** `package-lock.json` (`express@5.2.1`, `body-parser@2.2.2`, `qs@6.15.2`, `proxy-addr`)
- **Confidence:** High that the advisories apply to the locked versions (`npm audit --omit=dev`). Medium on exploitability.
- **Evidence:** body-parser GHSA-v422-hmwv-36x6 (invalid `limit` value silently disables size enforcement) and GHSA-27r3-jxmh-p828 (trailing bytes after compressed body). proxy-addr GHSA-jqcg-44mw-7w3h (IPv4-mapped IPv6 trust-subnet spoofing, rated critical). qs GHSA-4mjr-xmp4-gh2g and GHSA-x5fp-wj9c-mxmx.
- **Impact:** The proxy-addr issue matters only when `TRUST_PROXY` is a subnet list. The body-parser `limit` issue means a malformed `BODY_LIMIT` env would silently remove the 15 MB cap (see `config.js:39`, which passes the raw string).
- **Recommended fix:** `npm audit fix` / bump `express`, commit the lockfile. Validate `BODY_LIMIT` at startup (`bytes.parse` result must be a positive number). Add `npm audit --omit=dev --audit-level=high` to CI.
- **Expected impact:** Closes the advisories and keeps them closed.

### [F-07] [MEDIUM] — No per-caller concurrency or queue-wait bound
- **Category:** Reliability / fairness
- **Location:** `src/render.js:48-83`, `server.js:68-103`
- **Confidence:** High (code). Impact depends on the number of key holders.
- **Problem:** Rate limiting counts arrivals only (compose says so). One key can submit pages that never reach `networkidle` (or `while(true){}`), each pinning a slot for the full 60 s. With `RENDER_CONCURRENCY=2` and 120 req/min, two requests starve everyone else. Queued requests wait with no timeout, up to `RENDER_QUEUE_MAX × timeout / concurrency` (about 16 min with shipped defaults), long after typical proxies have dropped them. The rendered-for client has already left but only the queue copy is cancelled.
- **Impact:** Noisy-neighbour denial of service on a shared deployment.
- **Recommended fix:** Per-key in-flight cap (reject 429 above N). A `RENDER_QUEUE_WAIT_MS` after which a queued request gets 503. Lower the default timeout or expose `timeout` per request with a ceiling.
- **Expected impact:** One caller can no longer monopolise the pool.

### [F-08] [MEDIUM] — Non-Latin-1 or quoted `filename` breaks the response after rendering
- **Category:** Correctness
- **Location:** `server.js:159, 176`, `src/validate.js:33-37`
- **Confidence:** High — reproduced.
- **Problem:** `Content-Disposition` is built as `attachment; filename="${filename}"`. `res.setHeader` throws for characters above U+00FF, so a Thai filename returns 500 *after* the full render. The success log line and `metrics.renders` are already counted. A `"` in the name injects extra header parameters.
- **Evidence:** `filename:"รายงาน.pdf"` returned `500 {"error":"Internal render error"}`. `filename:"a\"; x=\"b.pdf"` produced `Content-Disposition: attachment; filename="a"; x="b.pdf"`.
- **Impact:** The main audience (Thai users) cannot name their downloads in their own language. Wasted renders. Misleading success metric.
- **Recommended fix:** Build the header with RFC 6266/5987: `filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded>`. Reject or strip `"`, CR, LF, control characters in `validateOptions`. Emit the log line and increment `renders` only after the response is written.
- **Expected impact:** Thai names work; metrics match reality.

### [F-09] [MEDIUM] — Live-looking API key committed to the repository
- **Category:** Security / secrets
- **Location:** `test-convert.js:19`; present in history since `d522c04` (initial migration)
- **Confidence:** High that a key-shaped secret is committed. Unknown whether it is live.
- **Evidence:** `'Authorization': 'Bearer api_1G…[redacted]'`. Removing it from HEAD does not remove it from history.
- **Recommended fix:** Rotate that key if it was ever valid. Read the key from `process.env.API_KEY` in the script. Purge history only if the repo is, or will become, public.
- **Expected impact:** Removes a standing credential from source control.

### [F-10] [MEDIUM] — `save: true` has no ownership, quota, or collision control
- **Category:** Security / data integrity / operations
- **Location:** `server.js:128-132, 158-172`
- **Confidence:** High (code, partly executed).
- **Problem:**
  - Every key can write to and overwrite any file under `OUTPUT_DIR`, including other keys' output. Default names are `output-${Date.now()}.pdf` (same-millisecond collisions possible).
  - No size or count quota and no cleanup: unbounded disk growth from a caller at 120 req/min.
  - The response returns the absolute server path (`path: finalPath`).
  - `outPath` as a non-string (object/number) throws in `path.normalize` and returns 500 instead of 400 (reproduced).
  - Traversal protection is a regex strip of leading `../`. Executed payload `../../../../tmp/x.pdf` was contained under `OUTPUT_DIR` (**no escape found**), but the pattern is fragile (symlinks inside `OUTPUT_DIR` are not considered).
- **Recommended fix:** Validate `outPath` as a string in `validateOptions`. Resolve with `path.resolve` and verify the prefix (`finalPath.startsWith(root + path.sep)`), rejecting rather than silently rewriting. Namespace by key label (see F-01), write with `flag:'wx'` unless overwrite is requested, add a disk-usage cap, and return a relative path.
- **Expected impact:** Prevents cross-tenant overwrite and disk exhaustion; clean 400s.

### [F-11] [LOW] — Failed authentication is not rate limited; public endpoints leak detail
- **Category:** Security
- **Location:** `server.js:78-82`, `server.js:230-236`, `server.js:208-228`
- **Problem:** The 401 path returns before `isRateLimitedFor`, so key guessing is unthrottled (3 wrong keys → 401, 401, 401, no limit headers). `/health` exposes `pid`, auth mode, and rate-limit config. `/metrics` (when enabled) is unauthenticated.
- **Recommended fix:** Count 401s per IP in the limiter (cheap). Drop `pid` from `/health`. Put `/metrics` on a separate port or behind auth.

### [F-12] [LOW] — Option validation gaps
- **Category:** Correctness / input validation
- **Location:** `src/validate.js`, `src/render.js:85-92, 150, 174-180`
- **Evidence:** `png:"false"` returned PNG (truthy string; `png` and `single` are never validated). A number `margin` is read as mm for the scale math but passed to Playwright as pixels. The bare string `"10"` has the same mismatch. Margins larger than half the paper clamp `availableWidth` to 1 px and `page.pdf` rejects, giving a 500 instead of a 400.
- **Recommended fix:** Validate `png`/`single` as booleans. Normalise margin to a `"<n>mm"` string once and use it for both the math and Playwright. Add an upper bound check relative to paper size.

### [F-13] [LOW] — Lifecycle edges
- **Category:** Reliability
- **Location:** `server.js:23-25, 248-258`, `src/render.js:98-100, 199-208`
- **Problem:**
  - The startup IIFE has no `catch`. A Chromium launch failure surfaces as an unhandled rejection (observed: `Executable doesn't exist`, process exit 1).
  - Shutdown has no deadline and no error handling around `closeBrowser()`. A second signal re-enters `shutdown`.
  - The `disconnected` abort signal is passed to `acquireSlot` only. A client that leaves during rendering still consumes a slot until completion or 60 s (R-1.20 covers only the queued case).
  - `initBrowser` is not safe for concurrent first calls (two launches, one leaked). Currently reachable only at boot.
- **Recommended fix:** Wrap startup in try/catch with a clear fatal log. Add a shutdown timeout and `process.exitCode`. Pass the signal into the render work and close the context on abort.

### [F-14] [LOW] — Error contract holes
- **Location:** `server.js` (no catch-all 404), `src/httpErrors.js:9-11`
- **Evidence:** `GET /nope` returned `404 text/html`. Unsupported-charset/encoding errors (415) are labelled `Malformed JSON body`.
- **Recommended fix:** Add a JSON 404 handler and a final error middleware. Map `err.type` to messages.

### [F-15] [LOW] — Helper scripts are broken or hazardous
- **Category:** Tooling
- **Location:** `convert-cli.sh`, `cleanup_fonts.sh`, `wrap_html.sh`
- **Evidence (executed):** `convert-cli.sh --file example.html` without `--scale` fails: `jq: error ... string ("null") cannot be parsed as a number` (`OPT_SCALE` defaults to the string `null`, line 113, then `tonumber`).
- **By code:**
  - `--save` posts the request **twice** (lines 264 and 267), so each saved document is rendered and written twice.
  - `API_KEY=""` at line 11 ignores the `API_KEY` env var that `--help` promises.
  - The python3 branch contains invalid bash substitutions (lines 152, 198-204).
  - Fixed `/tmp/convert_headers` and `/tmp/convert_cli_req.json` paths are symlink-race prone and leave request bodies in world-readable files.
  - `cleanup_fonts.sh` hard-codes `/root/HausPay/apiPdfConvert/...` and has no `set -e`. If a `cd` fails, the `rm` loop runs in the *current* directory, deleting any `.ttf` not on the keep list.
  - `wrap_html.sh` interpolates raw HTML into JSON (breaks on any `"` or newline) and sends `"scale": "1"` as a string.
  - `result.pdf` (an HTML error page) and `.claude/settings.local.json.bak.*` are tracked.
- **Recommended fix:** Delete `cleanup_fonts.sh`, `wrap_html.sh`, `result.pdf`, and the `.bak` file. Fix the CLI (`set` scale only when given, single request with `-w`, honour env key, `mktemp`).

### [F-16] [LOW] — Documentation and spec drift
- **Location:** `documents/specification.md:118, 144-145`; `documents/deployment.md:184, 380`; `AGENTS.md`, `GEMINI.md`
- **Evidence:** Spec §6 says keys are compared with `===` (not constant-time), contradicting R-2.7 (SHA-256 digests, `timingSafeEqual`). Spec §8 labels the 400/413 responses "HTML response", contradicting R-1.16 (JSON). `deployment.md` healthchecks use `curl`, which the slim image does not ship (compose notes this).
- **Recommended fix:** Correct the two spec lines. Use the `node -e fetch` probe in deployment examples.

### [F-17] [INFO] — Supply chain and image hygiene
- **Location:** `Dockerfile:2`, `.github/workflows/*.yml`
- **Observations:** Base image tag not pinned by digest. GitHub Actions pinned by major tag, not SHA. Publish workflow pushes `latest` on every `v*` tag with no image vulnerability scan or smoke render. The Dockerfile has no `HEALTHCHECK` (only compose does). CI never builds the image, so a broken Dockerfile or Playwright/browser version mismatch is found only at release. (Locally, Playwright 1.62.1 expects browser build 1234; a stale cache had 1228, which is why a host run fails.)
- **Recommended fix:** CI job that builds the image and renders one document. Pin by digest/SHA via Dependabot. Add `trivy`/`grype`.

---

## 3. Performance & Resource Optimization

**High impact**
- Bound output size (F-03). This is the main memory lever and is currently unbounded.
- Per-key concurrency cap and queue-wait timeout (F-07). Prevents slot starvation.

**Medium impact**
- `networkidle` is the default wait. Documented as adding about 500 ms for self-contained HTML (`api_docs.md:173`). A `waitUntil:'load'` default for HTML with no network references saves latency for most callers. Needs a product decision, not a code defect.
- Stop rendering for disconnected clients mid-render (F-13). Saves slot-seconds under client timeouts.

**Low impact**
- `JSON.stringify`-free hot path is already lean; `res.send(buffer)` avoids a copy (good).
- Rate-limiter sweep is amortised correctly. Memory bound holds when auth is on. With auth off, see F-04.

**Benchmark before changing**
- New context + page per request vs a small page pool, at `RENDER_CONCURRENCY=2` on 1 CPU.
- `RENDER_CONCURRENCY` vs the `cpus: '1.0'` limit (compose pins 2; the headroom claim in comments is unmeasured).
- Peak RSS for PNG at `dpi=300/600` on a long page (validates F-03 thresholds).

---

## 4. Security Findings

F-01 (key in logs), F-04 (fail-open auth), F-09 (committed key), F-05 (SSRF/no-sandbox), F-10 (`save`), F-06 (dependencies), F-11 (unthrottled 401, public endpoints), F-08 (header injection).

**Checked and sound:** key comparison uses digests (`auth.js:11-16, 83, 86`). `outPath` traversal payloads stayed under `OUTPUT_DIR`. `format:"constructor"` is rejected. 500s do not echo internals (R-1.19). CORS is off by default.

**Limits:** Chromium never ran here, so SSRF, `file:` access, and sandbox behaviour are unverified. No live-key validity check was made for F-09.

---

## 5. Reliability & Concurrency Findings

F-02 (no browser recovery), F-07 (slot starvation, unbounded queue wait), F-03 (OOM leading to F-02), F-13 (startup/shutdown/abort edges). Context cleanup after the deadline race (`render.js:111-121, 199-208`) is correct and covered by `renderTimeout.test.js`. Slot accounting and queue removal on abort are correct and tested. Remaining lifecycle risk: `context.close()` is awaited without a bound before `releaseSlot()` (`render.js:206-207`).

---

## 6. Testing Gaps

Status: `npm test` — 29 pass / 0 fail. `node --test scripts/version-control.test.mjs` — 20 pass. `npm run version:check` — OK.

Highest value missing, in order:
1. **HTTP integration test for `server.js`** (supertest-style with the stubbed browser, as `renderTimeout.test.js` already stubs). Would have caught F-01 (assert no key in log output), F-08, F-10, F-14, and the 401/429/503/504 mapping that R-3.2/R-2.6 mark "verified manually". Today `server.js` has no test at all.
2. **Browser-crash test.** Stub `newContext` to throw "browser has been closed" and assert recovery and a failing `/health` (F-02).
3. **`save` path tests.** Traversal payloads, non-string `outPath`, overwrite, collision (F-10).
4. **Auth fail-open tests.** Empty keys file, directory at the keys path (`EISDIR`), comment-only file (F-04). Existing tests cover only the happy path and an unrelated key; none covers reload.
5. **Misleading assertions.** The "bounded storage" rate-limit test asserts `≤ 2×WAVE+10` using real timers (timing-dependent). `renderTimeout` tests use a stub that cannot fail like Chromium. `validate.test.js` never tests `png`/`single`.
6. **Docker smoke test in CI** (F-17): build, render a Thai sample, assert non-empty PDF and font presence (R-5.6 has no automated check).

---

## 7. Architecture Recommendations

- **Make `server.js` testable.** Export `createApp({render, auth, limiter})` and start listening only in a `main`. Tied to: zero HTTP-layer tests and the fact that F-01/F-08/F-14 live there.
- **Separate identity from credential.** One `principal` object (`{id, label}`) produced by auth and consumed by rate-limit, logs, `save` namespacing, and metrics. Tied to F-01, F-10.
- **Own the browser lifecycle in one place** (`getBrowser()` with relaunch, connected check, launch mutex) and expose its state to `/health`. Tied to F-02, F-13.
- **Decide the trust model explicitly.** Either keep "trusted callers only" and enforce it (fail-closed auth, egress filter) or accept untrusted HTML and add the controls in F-05. Today the spec says one thing and the defaults do another.

---

## 8. Recommended Action Plan

**Immediate (this week)**
1. F-01: stop logging the key; rotate keys exposed in existing logs.
2. F-09: rotate the committed key; read it from env in `test-convert.js`.
3. F-06: `npm audit fix`; validate `BODY_LIMIT`.
4. F-04: pre-create `apikeys.txt` guidance in compose docs; start-up error when no auth is configured and no explicit opt-out.

**Short term**
5. F-02: browser relaunch + `/health` reflects browser state.
6. F-03: pixel/size ceilings.
7. F-08: RFC 6266 `Content-Disposition`; move success log/metric after write.
8. F-07: per-key in-flight cap, queue-wait timeout.
9. Add the HTTP integration test suite (§6.1–6.4).

**Medium term**
10. F-05: egress filter and sandbox review. F-10: `save` hardening and quota. F-11, F-12, F-13, F-14.
11. F-17: image build and smoke render in CI; SHA-pin actions.

**Optional**
12. F-15, F-16: delete dead scripts, fix CLI, correct spec/deployment drift, dedupe agent instruction files.
13. Benchmarks in §3.

---

## 9. Audit Coverage

**Result: PARTIAL.** Every runtime, test, CI, Docker, and script file was read. The files below were not read in full.

**Reviewed (read in full)**
- `/`: `server.js`, `package.json`, `VERSION`, `Dockerfile`, `docker-compose.yml`, `.gitignore`, `CLAUDE.md`, `test-convert.js`, `convert-cli.sh`, `cleanup_fonts.sh`, `wrap_html.sh`, `example.html`
- `src/`: `auth.js`, `config.js`, `httpErrors.js`, `logger.js`, `rateLimit.js`, `render.js`, `validate.js`
- `test/`: `auth.test.js`, `concurrency.test.js`, `helpers.js`, `rateLimit.test.js`, `renderTimeout.test.js`, `validate.test.js`, `version.test.js`
- `scripts/`: `release.js`, `sync-version.js`, `version-targets.mjs`, `version-control.mjs`
- `.github/workflows/`: `ci.yml`, `docker-publish.yml`
- `documents/specification.md`
- `.claude/settings.local.json.bak.1787539082`
- `result.pdf` (head only; it is an HTML error page)

**Not read line by line (unverified)**
- `scripts/version-control.test.mjs`: executed (20 pass), not read.
- `documents/api_docs.md`, `architecture.md`, `deployment.md`, `development.md`, `fonts.md`, `README.md`: searched for specific claims only (key comparison, `save`, `waitUntil`, healthcheck, SSRF). Other drift may exist.
- `AGENTS.md`, `GEMINI.md`: symlinks to `CLAUDE.md` (git mode 120000). An earlier draft called them byte-identical copies, because `diff` follows symlinks; that was wrong, and no change is needed.
- `LICENSE`: not read; no operational impact.

**Excluded**
- `fonts/**` (TTF binaries and OFL/README texts): third-party assets, not reviewable as code. Dockerfile `COPY` paths were checked against the file names.
- `package-lock.json`: generated. Used for `npm audit` and version-sync only.
- `graphify-out/**`: generated tool output.
- `node_modules/`: vendored, not tracked.

**Traced / exercised**
- Executed with a stubbed browser (`-r` preload): server boot, `/convert` success, Thai and quoted `filename`, `outPath` object, traversal payload, `png:"false"`, unmatched route, wrong-key attempts, log inspection (F-01).
- Executed: `convert-cli.sh` default and `--scale` runs (F-15).
- Code-traced: request lifecycle (auth, limiter, validate, slot, context, deadline, cleanup), key reload, shutdown.

**Checks run**
| Command | Outcome |
|---|---|
| `npm test` | 29 pass, 0 fail |
| `node --test scripts/version-control.test.mjs` | 20 pass, 0 fail |
| `npm run version:check` | `Checked 2026.8.3` |
| `npm audit --omit=dev` | 3 vulnerabilities (1 critical, 1 high, 1 moderate) |
| `node server.js` with real Playwright | Failed: browser build 1234 not installed (cache holds 1228); unhandled rejection exit 1 |
| `chrome-headless-shell` 1228 | Failed: missing `libatk-1.0.so.0` and other system libs; no root to install |

**Behaviours not verified:** any real Chromium rendering (scale maths, fonts, PNG/PDF output, SSRF, `file:` access, sandbox), the F-02 crash path, the F-03 memory numbers, double render on `convert-cli.sh --save` (read from code; an execution attempt deadlocked in its own test harness), Docker image build, GHCR publish, shellcheck (not installed).
