# ViewSarn Specification

The authoritative statement of **what ViewSarn must do**. Other documents explain how it does it (`architecture.md`), how to call it (`api_docs.md`), or how to run it (`deployment.md`); this one defines the behaviour they must all agree with.

Each requirement has an ID (`R-*`). Cite the ID when changing behaviour, reviewing a diff, or filing a bug — a change that contradicts a requirement here needs this document updated in the same commit.

**Status key:** ✅ implemented and covered by a test · ☑️ implemented, verified manually · ⬜ not implemented (stated so the boundary is explicit).

---

## 1. Purpose and scope

ViewSarn converts a caller-supplied HTML string into a PDF or PNG, rendering it with Chromium so that CSS, webfonts, and Thai typography come out as a browser would draw them.

**In scope:** one-shot conversion of self-contained HTML; Thai and English typography; API-key authentication; per-caller rate limiting; bounded resource use under load.

**Out of scope** — deliberately, so absence is not read as an oversight:

| | |
|---|---|
| ⬜ **R-0.1** | No URL rendering. The caller sends HTML; the service does not fetch a page to convert. |
| ⬜ **R-0.2** | No template engine, no merge fields. Callers assemble their own HTML. |
| ⬜ **R-0.3** | No persistence or job queue. A request is served or refused within its own lifetime; `save` writes a file but nothing indexes or serves it back. |
| ⬜ **R-0.4** | No distributed state. Rate limits and render slots are per process (see R-4.4). |
| ⬜ **R-0.5** | No HTML sanitisation. Callers are trusted to send HTML they control; see §6. |

---

## 2. Conversion

| | Requirement |
|---|---|
| ☑️ **R-1.1** | `POST /convert` accepts a JSON body with a required `html` string and an optional `options` object, and returns a PDF by default or a PNG when `options.png` is true. |
| ☑️ **R-1.2** | A missing or non-string `html` is rejected with `400` before any browser work begins. |
| ☑️ **R-1.3** | Output streams back in the response body, with `Content-Type`, `Content-Length`, and a `Content-Disposition` filename. |
| ☑️ **R-1.4** | With `save: true` the result is written under `OUTPUT_DIR/<key label>/` and the response is JSON metadata (`path` relative to `OUTPUT_DIR`, `filename`, `size`, `scale`, `contentSize`, `paper`, `orientation`) instead of the file. |
| ☑️ **R-1.5** | `outPath` is resolved **under** the caller's own directory `OUTPUT_DIR/<key label>/`. A path that escapes it, by `..` segments or by a symlink, is refused with `400`; a leading `/` is tolerated and means the same as none. Two keys saving the same `outPath` write different files. A repeated `filename` or `outPath` overwrites the caller's earlier file. With `OUTPUT_MAX_BYTES` above 0, a save that would push the caller's directory past it is refused with `507`. |
| ☑️ **R-1.25** | `save` must be a boolean and `outPath` a non-empty string, `filename` must not contain quotes, control characters or more than 200 characters, `png` and `single` must be booleans, and a `margin` that leaves no printable area is refused, each with `400`. |
| ✅ **R-1.28** | Requests made by rendered HTML to loopback, private, link-local or carrier-grade-NAT addresses, or over a scheme other than `http`, `https`, `data`, `about` or `blob`, are aborted; WebSockets get the same check, with `ws` and `wss` read as `http` and `https`. Hostnames are resolved and every address is checked; every redirect hop (`301`, `302`, `303`, `307`, `308`) is checked the same way, a chain longer than 5 redirects is aborted, and credentials are not carried to another origin. A lookup failure aborts the request instead of leaving it unanswered. `EGRESS_ALLOW` (hostnames, IPs, CIDRs) names destinations that stay reachable. A redirected response is delivered under the first URL of its chain, so relative URLs inside it resolve against that URL. |
| ☑️ **R-1.27** | Every response is JSON with `error` and `request_id`, including an unknown route (`404`), an unsupported charset or `Content-Encoding` (`415`, with its own message), and an unexpected throw anywhere in the app (`500`, generic). |
| ☑️ **R-1.26** | `Content-Disposition` carries an ASCII `filename` fallback and an RFC 5987 `filename*=UTF-8''` value, so non-Latin names work. The success log line and the `renders` counter are written after the response is sent. |
| ☑️ **R-1.6** | Paper size comes from `format` (`A4`, `A5`, `LETTER`, `LEGAL`, case-insensitive). An absent value means A4; an unrecognised one is refused with `400` (R-1.17) and must not resolve to an inherited object property. |
| ☑️ **R-1.7** | Margins accept `mm`, `cm`, and `in`. A bare number is read as mm, and `0` means no margin; an absent margin is 10mm. Other CSS units are not parsed. |
| ☑️ **R-1.15** | Request bodies over `BODY_LIMIT` are rejected with `413` by the body parser, before the route runs. |
| ✅ **R-1.16** | Every error carries a JSON `{ "error": ..., "request_id": ... }` body, including the `413` and malformed-JSON `400` raised by the body parser before any route runs. |
| ✅ **R-1.17** | `options` is validated before rendering: `format`, `orientation`, `waitUntil`, `margin`, `dpi`, `scale`, and `filename` are rejected with `400` when malformed, rather than silently coerced. `filename` may not contain path separators. |
| ☑️ **R-1.18** | Every request carries an `X-Request-Id` — the caller's if supplied, otherwise generated — echoed in the response header, included in the error body, and attached to that request's log lines. |
| ☑️ **R-1.19** | A `500` body reports a generic message. Chromium and filesystem detail goes to the log under the request id, never to the caller. |
| ☑️ **R-1.20** | A caller that disconnects while queued is dropped from the queue rather than rendered for, and no response is written to the closed socket. A caller that disconnects while its render is running has the render abandoned, its context closed, and its slot released. |
| ☑️ **R-1.21** | A request that waits more than `RENDER_QUEUE_WAIT_MS` (default 30000) for a render slot is removed from the queue and answered `503`. |
| ☑️ **R-1.22** | A render whose output would exceed `MAX_PNG_PIXELS` (default 25,000,000 device pixels; full-page PNGs count the whole document) or `MAX_PDF_PAGES` (default 200) is refused with `413` before the screenshot or PDF is produced. `dpi` is never lowered silently. |
| ☑️ **R-1.23** | When `MAX_INFLIGHT_PER_KEY` is above 0, a caller with that many renders running or queued gets `429` with `Retry-After`. The default 0 means no cap. |
| ☑️ **R-1.24** | A browser that disconnects is replaced on the next render, concurrent callers share one launch, and a failed launch answers `503`. Shutdown stops new launches. A hung `context.close()` is abandoned after 5 s so it cannot pin a slot. |

### Scaling

| | Requirement |
|---|---|
| ☑️ **R-1.8** | Content is measured after layout, then scaled to the printable width (paper minus margins). With `single: true` it is also scaled to fit the printable height, so the output is one page. |
| ☑️ **R-1.9** | An explicit `options.scale` overrides the computed value. |
| ☑️ **R-1.10** | The final scale is clamped to 0.1–2.0, whether computed or supplied. `scale: null` means "compute it" and must not be read as zero. |
| ☑️ **R-1.11** | PNG resolution follows `dpi` (default 96) via `deviceScaleFactor`; `dpi` has no effect on PDF output. |

### Page readiness

| | Requirement |
|---|---|
| ☑️ **R-1.12** | Rendering waits for the page to reach `options.waitUntil` (default `networkidle`) before measuring. |
| ☑️ **R-1.13** | Webfonts are awaited before measuring, so text is measured in its final face — subject to R-4.3, this wait cannot be unbounded. |
| ☑️ **R-1.14** | Measurement happens after a painted frame, not after a fixed sleep. |

---

## 3. Authentication

| | Requirement |
|---|---|
| ☑️ **R-2.1** | A key is accepted as `Authorization: Bearer <key>` or `X-API-Key: <key>`. |
| ☑️ **R-2.2** | Key sources resolve in order: a non-empty `API_KEYS_FILE` wins over `API_KEY`. |
| ✅ **R-2.7** | API keys are compared as fixed-length SHA-256 digests, never as raw strings — `===` on a secret leaks its prefix through response timing. |
| ☑️ **R-2.9** | Wrong keys are counted per client IP against `AUTH_FAIL_MAX` per rate-limit window. Past the budget the response is `429` with `Retry-After` instead of `401`. A valid key must never be refused because of failed attempts from the same IP. |
| ☑️ **R-2.8** | The keys file is loaded **synchronously** at startup. An async first load leaves a window where a configured keys file is not yet read, during which the service falls back to `API_KEY` or serves unauthenticated. |
| ☑️ **R-2.3** | With **neither** configured, the service must refuse to start (exit 1, naming the keys path and saying so when that path is a directory) and, if the check is bypassed, must answer every request with 401. Running with no keys requires the explicit opt-out `AUTH_DISABLED=true`, which logs a warning at startup, ignores any presented key header, and rate-limits by client IP only. |
| ☑️ **R-2.4** | The keys file is re-read every `API_KEYS_RELOAD_MS` so keys can be added or revoked without a restart. |
| ☑️ **R-2.5** | A **transient** read failure of the keys file (for example `EACCES`) must leave the previously loaded keys in force. A missing or empty file keeps the previous keys for one reload and clears them on the second consecutive missing or empty read, so a half-written rotation is tolerated and emptying the file still revokes keys. Failing to read must never silently drop the service into unauthenticated mode. |
| ☑️ **R-2.6** | Rejected requests get `401` with a `WWW-Authenticate` header and no detail about why the key failed. |

---

## 4. Rate limiting

| | Requirement |
|---|---|
| ✅ **R-3.1** | Requests are counted per API key, or per client IP when no key is supplied, in a fixed window of `RATE_LIMIT_WINDOW_MS`. |
| ☑️ **R-3.6** | The client IP must be resolved through `TRUST_PROXY` (Express `trust proxy`). Behind a reverse proxy without it, every anonymous caller resolves to the proxy's address and shares one bucket, so one noisy client rate limits everyone. Enabling it without a trusted proxy in front is the opposite failure: callers spoof `X-Forwarded-For` and get a fresh bucket per request. Default is `false` — correct only when the service is reached directly. |
| ☑️ **R-3.2** | Over `RATE_LIMIT_MAX` in a window, the response is `429` with `Retry-After` and a `retry_after_seconds` body field. (Tests cover the limiter decision, not the HTTP response.) |
| ☑️ **R-3.3** | Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (seconds). |
| ✅ **R-3.4** | `RATE_LIMIT_MAX=0` rejects the very first request. A configured zero means zero, not "fall back to the default". |
| ✅ **R-3.5** | Counter storage must stay bounded as distinct clients accumulate, and reclaiming it must not cost an O(n) scan per request — an IP spray is precisely the load a limiter faces. |

---

## 5. Resource limits

The service runs one Chromium instance; every in-flight render holds a page, and page memory is what drives peak RSS. These requirements exist so a traffic spike degrades predictably instead of ending in an OOM kill.

| | Requirement |
|---|---|
| ☑️ **R-4.1** | One browser instance is launched at startup and shared by every request; a disconnected one is replaced, never run alongside a second (R-1.24). Each request gets its own isolated context, closed when the request ends. |
| ✅ **R-4.2** | At most `RENDER_CONCURRENCY` renders run at once. Beyond that, requests wait for a slot. |
| ✅ **R-4.3** | A render that exceeds `RENDER_TIMEOUT_MS` is abandoned with `504` **and its slot is released**. No single request may hold a slot indefinitely: with the concurrency cap in place, enough wedged renders would otherwise stall the service entirely. |
| ✅ **R-4.8** | An abandoned render must not leak its browser context, including when the deadline fires *before* the context finishes being created. Whichever side gets there second closes it. |
| ✅ **R-4.4** | The wait queue is bounded by `RENDER_QUEUE_MAX`; past it, requests get `503` with `Retry-After`. Queued requests still hold their parsed bodies, so an unbounded queue only moves the OOM from pages to backlog. |
| ☑️ **R-4.5** | Request bodies are capped at `BODY_LIMIT` (default 15mb). |
| ☑️ **R-4.6** | Peak memory is therefore bounded by roughly (`RENDER_CONCURRENCY` × page) + (`RENDER_QUEUE_MAX` × `BODY_LIMIT`). Operators sizing a container need both numbers, not just the first. |
| ☑️ **R-4.7** | `SIGTERM`/`SIGINT` stop accepting connections, close the browser, then exit. |
| ☑️ **R-4.9** | A render abandoned at the deadline releases its slot before its context has finished closing, so the page cap may be exceeded by the abandoned render for that moment. The overshoot is bounded by the number of simultaneous timeouts and resolves on its own. |

---

## 6. Security posture

Stated plainly, because two defaults here are permissive on purpose and reviewers should not have to re-derive the reasoning.

- **Auth is on unless explicitly disabled (R-2.3).** The service is designed to run on a private network or behind a gateway, where `AUTH_DISABLED=true` is acceptable. Without a key source and without that opt-out it does not start. Anything reachable from outside must set `API_KEY` or mount `API_KEYS_FILE`.
- **HTML is not sanitised (R-0.5).** Rendering caller-supplied HTML means running caller-supplied JavaScript in Chromium. Callers are trusted. Do not expose `/convert` directly to untrusted end users without a sanitising layer in front; per-request context isolation (R-4.1) limits cross-request leakage but is not a sandbox boundary.
- **Key comparison is constant-time (R-2.7).** Keys are compared as fixed-length SHA-256 digests (set membership for the keys file, `crypto.timingSafeEqual` for `API_KEY`), so response timing does not reveal a key's prefix.
- **`/health` is unauthenticated (R-5.1)** and exposes the rate-limit configuration. Treat that as public information, or block the path at the proxy.

---

## 7. Operations

| | Requirement |
|---|---|
| ☑️ **R-5.1** | `GET /health` returns `200` when the browser is connected and `503` when it is not (body: `ok`, `browser`), plus `apiAuthFileInUse`, and the rate-limit configuration. It skips **authentication** — container healthchecks and load balancer probes cannot present a key. |
| ☑️ **R-5.2** | `/health` is **not** exempt from rate limiting; it must not be pollable for free. |
| ☑️ **R-5.7** | `/metrics` exposes Prometheus counters when `METRICS_ENABLED=true`, off by default. It requires a key whenever authentication is configured, and is open only when the service runs with `AUTH_DISABLED=true`. It is rate limited either way. |
| ☑️ **R-5.8** | CORS headers are sent only for origins listed in `CORS_ORIGINS`, which is empty by default — correct for a server-to-server service. A preflight from an unlisted origin is refused with `403`. |
| ☑️ **R-5.3** | Logs go to stdout as one JSON object per line when `NODE_ENV=production`. Human-readable formatting is a development-only concern and must not cost anything in production. |
| ☑️ **R-5.4** | `503` and `504` are load signals, logged at `warn`; only genuine faults log at `error`. |
| ☑️ **R-5.5** | Configuration is environment variables only, read once at startup. A malformed or out-of-range value falls back to its default rather than crashing — except where zero is meaningful (R-3.4, and `PORT=0` for an ephemeral port), and except `BODY_LIMIT` and `EGRESS_ALLOW`, which stop startup with a message naming the variable: falling back there would silently drop a size cap or an allow-list entry. |
| ☑️ **R-5.6** | The container ships the Thai and English fonts it renders with; output must not depend on host fonts. |

---

## 8. Response codes

Every body below is JSON with `error` and `request_id` (R-1.27).

| Code | Meaning | Requirement |
|---|---|---|
| `200` | Converted, or saved | R-1.1, R-1.4 |
| `400` | `html` missing or not a string | R-1.2 |
| `400` | Malformed JSON body | R-1.16 |
| `400` | Invalid `options`, `save`, `outPath` or `filename`; `outPath` escapes the caller's directory | R-1.17, R-1.25, R-1.5 |
| `401` | Key missing or wrong, where auth is configured | R-2.6 |
| `404` | Unknown route | R-1.27 |
| `413` | Body exceeded `BODY_LIMIT` | R-1.15, R-1.16 |
| `413` | Rendered output would exceed `MAX_PNG_PIXELS` or `MAX_PDF_PAGES` | R-1.22 |
| `415` | Unsupported charset or `Content-Encoding` | R-1.27 |
| `429` | Rate limit exceeded | R-3.2 |
| `429` | Too many wrong keys from one IP | R-2.9 |
| `429` | Too many renders in flight for one key | R-1.23 |
| `500` | Render failed — generic message | R-1.19 |
| `503` | Render queue full, queue wait exceeded, or browser unavailable — retry | R-4.4, R-1.21, R-1.24 |
| `503` | `/health` while the browser is disconnected | R-5.1 |
| `504` | Render exceeded its deadline | R-4.3 |
| `507` | Save would exceed `OUTPUT_MAX_BYTES` | R-1.5 |

---

## 9. Change log

Requirements added or changed after the initial specification, with the reason. A requirement that exists only because something went wrong is worth keeping labelled as such.

| Requirement | Change | Why |
|---|---|---|
| R-1.28 | Changed | Playwright calls a route handler only for the first URL of a redirect chain, so a public URL answering `302` to `169.254.169.254` bypassed the filter (code review of PR #5). Redirects are now followed by the filter itself, hop by hop. Verified in the image: the redirect target received a request before the fix and none after. |
| R-1.28 | Changed | WebSockets never reach `context.route`, so a page could open `ws://` to the host's private network; they are now checked through `routeWebSocket`. Only the five redirect statuses browsers follow are followed, with Fetch-standard method and credential rules. Verified in the image: the WebSocket test fails on the earlier code. |
| R-5.5 | Changed | `BODY_LIMIT` already refused to start on a malformed value (body-parser drops its cap on one), and a malformed `EGRESS_ALLOW` CIDR crashed at startup with a bare `ERR_OUT_OF_RANGE`; both are now stated, and the `EGRESS_ALLOW` error names the variable. |
| R-1.7 | Changed | `margin: 0` was read as "unset" and became 10mm. |
| R-1.6 | Changed | It still said an unknown format falls back to A4, contradicting R-1.17, which rejects it. |
| R-4.1 | Changed | The browser is no longer launched once for the life of the process; R-1.24 replaces a dead one. |
| R-4.2, R-4.4, R-4.6 | Added | Concurrency was unbounded; a burst opened a page per request until the container was killed. |
| R-4.3 | Added | `page.evaluate` has no timeout of its own. Combined with the new concurrency cap, one wedged page could pin a slot permanently and enough of them could stall the service — the cap turned a per-request hang into a global one, so the deadline had to come with it. |
| R-3.5 | Added | Counters were never reclaimed, growing one entry per distinct IP forever. The first fix swept on every insert, which is O(n) per request under a spray; sweeping is now amortised to once per window. |
| R-3.4 | Added | `RATE_LIMIT_MAX=0` silently became the default of 120, because config treated 0 as "unset" and the first-insert path never checked the count. |
| R-2.3 | Changed | Auth failed open: a missing keys file, a keys path that Docker created as a directory, or an empty file all left the service unauthenticated with only a log warning (audit 2026-10-24, F-04). Open mode now needs `AUTH_DISABLED=true`. |
| R-2.9 | Added | A request with a wrong key is counted per client IP (`AUTH_FAIL_MAX`, default 30 per window); past the budget the answer is 429 instead of 401. A valid key is never throttled by failed attempts, because behind a proxy without `TRUST_PROXY` all clients share one IP. |
| R-5.1 | Changed | `/health` no longer returns `pid`, and returns `503` when the browser is disconnected so the orchestrator restarts the container (audit F-02). |
| R-1.28 | Added | Caller HTML could fetch cloud metadata and internal services and render the response into the output (audit F-05). Verified in the image: a page fetching a local server produced 0 hits with the filter and 2 with the destination allowed. |
| R-1.27 | Added | An unknown route returned an HTML 404 and every body-parser error was labelled "Malformed JSON body" (audit F-14). |
| R-1.4, R-1.5, R-1.25, R-1.26 | Changed | `save` let every key overwrite any file, accepted traversal by silent rewrite, returned the absolute server path and 500ed on a non-string `outPath`; a Thai `filename` 500ed after a full render (audit F-08, F-10, F-12). |
| R-1.22 | Measured | In the image, peak container memory was 243 MB at 3M device pixels, 432 MB at 15M, 1005 MB at 39M and 1854 MB at 78M (about 22 bytes per pixel over a 142 MB idle browser), so the default is 25M, which keeps two concurrent renders inside the 2 GB compose limit. |
| R-1.20 to R-1.24 | Added | A dead Chromium was never replaced and `/health` stayed green; output size was unbounded; one key could hold every slot; queued requests waited with no bound (audit F-02, F-03, F-07, F-13). |
| R-5.7 | Changed | `/metrics` requires a key when auth is configured. |
| R-2.5 | Changed | The first empty or missing read keeps the previous keys; a second consecutive one clears them, so revoking the last key works. |
| R-2.5 | Added | Any read error on the keys file cleared every key, which could drop a running service into unauthenticated mode on a transient `EACCES`. |
| R-5.1, R-5.2 | Added | `/health` sat behind the global auth middleware, so every container healthcheck and Kubernetes probe failed once a key was configured. Exempting it from auth alone — not from rate limiting — fixes the probes without opening free polling. |
| R-1.10 | Added | A refactor made `scale: null` clamp to 0.1, which would have shrunk every render that did not pass an explicit scale. |
| R-1.6 | Tightened | Paper lookup moved to an object map, where `format: "constructor"` would otherwise resolve to an inherited property. |
| R-1.13, R-1.14 | Added | A fixed 100ms sleep was replaced by waiting on webfonts and a painted frame; the font wait then needed its own bound to satisfy R-4.3. |
| R-5.3 | Added | `pino-pretty` was running in production, costing a worker thread and emitting non-parseable logs while the docs claimed JSON. |
| R-4.8 | Added | The render deadline could fire while `newContext` was still in flight. The cleanup path saw no context to close, then the context arrived with nobody waiting for it — leaking a context and its pages for the life of the process, and quietly exceeding the concurrency cap since the slot had already been returned. |
| R-1.16 | Met | Parser-level errors (`413`, malformed-JSON `400`) came back as HTML from Express's default handler while every other error was JSON, so clients had no single error shape to parse. |
| R-1.17 | Added | Only `html` was validated. A typo in `format` silently fell back to A4 and returned a plausible-looking wrong-sized document. |
| R-1.19 | Added | The `500` body echoed `err.message` verbatim, handing Chromium and filesystem internals to the caller. |
| R-2.7 | Added | Keys were compared with `===` and set membership on raw strings, which is timing-variable. |
| R-2.8 | Added | The first keys-file load was async, leaving a startup window where a configured keys file was not yet read — requests in that window fell back to `API_KEY` or were served unauthenticated. |
| R-1.20, R-4.9 | Added | A disconnected caller still consumed a render slot; and an abandoned render briefly exceeds the page cap, which was true but undocumented. |
| R-3.6 | Added | `trust proxy` was never set while the deployment guide recommends an nginx reverse proxy that forwards `X-Forwarded-For`. Every anonymous client therefore resolved to the proxy's IP and shared a single rate-limit bucket. |
