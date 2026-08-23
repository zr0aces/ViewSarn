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
| ☑️ **R-1.4** | With `save: true` the result is written under `OUTPUT_DIR` and the response is JSON metadata (`path`, `filename`, `size`, `scale`, `contentSize`, `paper`, `orientation`) instead of the file. |
| ☑️ **R-1.5** | `outPath` is resolved **under** `OUTPUT_DIR`. Leading `../` segments are stripped so a caller cannot write outside it. |
| ☑️ **R-1.6** | Paper size comes from `format` (`A4`, `A5`, `LETTER`, `LEGAL`, case-insensitive). An unrecognised value falls back to A4 rather than erroring, and must not resolve to an inherited object property. |
| ☑️ **R-1.7** | Margins accept `mm`, `cm`, and `in`. A bare number is read as mm. Other CSS units are not parsed. |
| ☑️ **R-1.15** | Request bodies over `BODY_LIMIT` are rejected with `413` by the body parser, before the route runs. |
| ✅ **R-1.16** | Every error carries a JSON `{ "error": ..., "request_id": ... }` body, including the `413` and malformed-JSON `400` raised by the body parser before any route runs. |
| ✅ **R-1.17** | `options` is validated before rendering: `format`, `orientation`, `waitUntil`, `margin`, `dpi`, `scale`, and `filename` are rejected with `400` when malformed, rather than silently coerced. `filename` may not contain path separators. |
| ☑️ **R-1.18** | Every request carries an `X-Request-Id` — the caller's if supplied, otherwise generated — echoed in the response header, included in the error body, and attached to that request's log lines. |
| ☑️ **R-1.19** | A `500` body reports a generic message. Chromium and filesystem detail goes to the log under the request id, never to the caller. |
| ☑️ **R-1.20** | A caller that disconnects while queued is dropped from the queue rather than rendered for, and no response is written to the closed socket. |

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
| ☑️ **R-2.1** | A key is accepted as `Authorization: Bearer <key>` or `X-API-Key: <key>`. (Tests cover the bearer form only.) |
| ☑️ **R-2.2** | Key sources resolve in order: a non-empty `API_KEYS_FILE` wins over `API_KEY`. |
| ✅ **R-2.7** | API keys are compared as fixed-length SHA-256 digests, never as raw strings — `===` on a secret leaks its prefix through response timing. |
| ☑️ **R-2.8** | The keys file is loaded **synchronously** at startup. An async first load leaves a window where a configured keys file is not yet read, during which the service falls back to `API_KEY` or serves unauthenticated. |
| ☑️ **R-2.3** | With **neither** configured, authentication is disabled and every request is served. The service must log a warning at startup saying so. This is a deliberate zero-config default, not a bug — see §6. |
| ☑️ **R-2.4** | The keys file is re-read every `API_KEYS_RELOAD_MS` so keys can be added or revoked without a restart. |
| ☑️ **R-2.5** | A **transient** read failure of the keys file (for example `EACCES`) must leave the previously loaded keys in force. Only the file's absence clears them. Failing to read must never silently drop the service into unauthenticated mode. |
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
| ☑️ **R-4.1** | One browser instance is launched at startup and reused. Each request gets its own isolated context, closed when the request ends. |
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

- **Auth is optional (R-2.3).** The service is designed to run on a private network or behind a gateway. Zero-config startup is a convenience for local use; the startup warning is what makes the state visible. Anything reachable from outside must set `API_KEY` or mount `API_KEYS_FILE`.
- **HTML is not sanitised (R-0.5).** Rendering caller-supplied HTML means running caller-supplied JavaScript in Chromium. Callers are trusted. Do not expose `/convert` directly to untrusted end users without a sanitising layer in front; per-request context isolation (R-4.1) limits cross-request leakage but is not a sandbox boundary.
- **Key comparison is not constant-time.** Keys are compared with `===` and set membership, which is timing-variable. Acceptable for high-entropy keys on a private network; switch to `crypto.timingSafeEqual` if that assumption stops holding.
- **`/health` is unauthenticated (R-5.1)** and exposes `pid` and the rate-limit configuration. Treat that as public information, or block the path at the proxy.

---

## 7. Operations

| | Requirement |
|---|---|
| ☑️ **R-5.1** | `GET /health` returns `200` with `ok`, `pid`, `apiAuthFileInUse`, and the rate-limit configuration. It skips **authentication** — container healthchecks and load balancer probes cannot present a key. |
| ☑️ **R-5.2** | `/health` is **not** exempt from rate limiting; it must not be pollable for free. |
| ☑️ **R-5.7** | `/metrics` exposes Prometheus counters when `METRICS_ENABLED=true`, off by default. Like `/health` it skips authentication but stays rate limited. |
| ☑️ **R-5.8** | CORS headers are sent only for origins listed in `CORS_ORIGINS`, which is empty by default — correct for a server-to-server service. A preflight from an unlisted origin is refused with `403`. |
| ☑️ **R-5.3** | Logs go to stdout as one JSON object per line when `NODE_ENV=production`. Human-readable formatting is a development-only concern and must not cost anything in production. |
| ☑️ **R-5.4** | `503` and `504` are load signals, logged at `warn`; only genuine faults log at `error`. |
| ☑️ **R-5.5** | Configuration is environment variables only, read once at startup. A malformed or out-of-range value falls back to its default rather than crashing — except where zero is meaningful (R-3.4, and `PORT=0` for an ephemeral port). |
| ☑️ **R-5.6** | The container ships the Thai and English fonts it renders with; output must not depend on host fonts. |

---

## 8. Response codes

| Code | Meaning | Requirement |
|---|---|---|
| `200` | Converted, or saved | R-1.1, R-1.4 |
| `400` | `html` missing or not a string | R-1.2 |
| `400` | Malformed JSON body — **HTML response** | R-1.16 |
| `413` | Body exceeded `BODY_LIMIT` — **HTML response** | R-1.15, R-1.16 |
| `401` | Key missing or wrong, where auth is configured | R-2.6 |
| `429` | Rate limit exceeded | R-3.2 |
| `500` | Render failed | — |
| `503` | Render queue full — retry | R-4.4 |
| `504` | Render exceeded its deadline | R-4.3 |

---

## 9. Change log

Requirements added or changed after the initial specification, with the reason. A requirement that exists only because something went wrong is worth keeping labelled as such.

| Requirement | Change | Why |
|---|---|---|
| R-4.2, R-4.4, R-4.6 | Added | Concurrency was unbounded; a burst opened a page per request until the container was killed. |
| R-4.3 | Added | `page.evaluate` has no timeout of its own. Combined with the new concurrency cap, one wedged page could pin a slot permanently and enough of them could stall the service — the cap turned a per-request hang into a global one, so the deadline had to come with it. |
| R-3.5 | Added | Counters were never reclaimed, growing one entry per distinct IP forever. The first fix swept on every insert, which is O(n) per request under a spray; sweeping is now amortised to once per window. |
| R-3.4 | Added | `RATE_LIMIT_MAX=0` silently became the default of 120, because config treated 0 as "unset" and the first-insert path never checked the count. |
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
