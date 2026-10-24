# Audit Remediation Overview

Source: `docs/audit/2026-10-24-audit-report.md` (commit `facd5c7`, version `2026.8.3`). Seven plans fix findings F-01 to F-17. No plan is approved for EXECUTE.

## Plans and order

| # | Plan | Findings | Depends on |
|---|---|---|---|
| 01 | `2026-10-24-testable-server.md` | enabler for HTTP tests | none |
| 02 | `2026-10-24-auth-and-secrets.md` | F-01, F-04, F-06, F-09, F-11 | 01 |
| 03 | `2026-10-24-browser-lifecycle-and-limits.md` | F-02, F-03, F-07, F-13 | 01, 02 |
| 04 | `2026-10-24-request-hardening.md` | F-08, F-10, F-12, F-14 | 01, 02 |
| 05 | `2026-10-24-egress-and-sandbox.md` | F-05 | 03 |
| 06 | `2026-10-24-ci-image-and-tests.md` | F-17, remaining test gaps | 01, 03 |
| 07 | `2026-10-24-tooling-and-docs-cleanup.md` | F-15, F-16 | none |

Suggested sequence: 01, 02, then 03 and 04 (independent of each other), then 05, 06. Plan 07 can go any time.

## Rules for every plan

- One branch per plan, one commit per numbered step. Before each commit run `npm test` and `npm run version:check`.
- Test first: write the regression test, watch it fail, then fix.
- `documents/specification.md` is the contract. A behavior change updates its `R-*` requirement and change log in the same commit.
- Every new env var: read once in `src/config.js` (use `num()`), documented in `documents/deployment.md` and `docker-compose.yml`.
- Plain `node:test` + `node:assert/strict`. No new test framework. Indent: 4 spaces in `src/`, 2 spaces in `server.js`, `test/`, `scripts/`.
- Breaking changes ship through `npm run release` with a note in the commit body.

## Review log (plans checked against the code on 2026-10-24)

The first draft of the plans was written from the audit report. I re-read `server.js`, `src/render.js`, `src/auth.js`, `src/config.js`, `src/validate.js`, `src/rateLimit.js`, and `test/helpers.js`, and corrected these points:

| # | Correction | Plan |
|---|---|---|
| R1 | The F-03 pixel estimate was wrong for `single` PNGs. `fullPage: true` captures the document size, not the resized viewport, so the estimate must use `contentSize`. Non-single PNGs are bounded by the viewport. | 03 |
| R2 | Startup check must test "at least one key loaded", not `isAuthFileInUse()`. The latter is true for an empty keys file. | 02 |
| R3 | `ENOENT` on reload (file briefly missing during rotation) also clears all keys today (`auth.js:32-36`). Only non-`ENOENT` errors keep the old set. `EISDIR` is a gap only at startup. | 02 |
| R4 | Rate-limit identity must use the full digest, not the 8-character label. Two keys sharing a prefix would share a bucket. The label is for logs and directory names only (12 hex characters). | 02 |
| R5 | The abort signal reaches `acquireSlot` only. Aborting during render needs a third promise in the `Promise.race` in `renderHtmlToBuffer`. `initBrowser()` runs before `acquireSlot` and must stay there. | 03 |
| R6 | `body.save` is coerced with `!!`, so `"save": "false"` writes to disk. `outPath` and `save` live outside `options`, so `validateOptions` never sees them. Add body-level validation. | 04 |
| R7 | Filename validation already rejects `/`, `\`, NUL. Only `"`, control characters, and length are missing. | 04 |
| R8 | Reversed in review round 2: throttle failed keys after validation, so valid keys always pass. A pre-check locks out good users when `TRUST_PROXY` is off and all clients share the proxy's IP. | 02 |
| R9 | `rateLimit.js` uses `Date.now()`, so `node:test` `mock.timers` (Date) gives a deterministic clock. No source change is needed. | 06 |
| R10 | `/health` and `/metrics` share one `isHealth` flag in `server.js:72`. Split it before changing `/metrics` auth. | 02 |
| R11 | `context.route` must be registered before `newPage`. (The `javaScriptEnabled` option was dropped in review round 2.) | 05 |
| R12 | `server.close()` waits for open connections. Shutdown needs `closeAllConnections()` after the timeout. | 03 |
| R13 | `auth.js` runs a sync file read and a `setInterval` at import. Plan 01 injects auth so HTTP tests never import it. | 01 |

## Review round 2 (ponytail review of all plans)

| # | Fix | Plan |
|---|---|---|
| 1 | Failed-auth throttle no longer pre-blocks valid keys (see R8). | 02 |
| 2 | Save no longer uses `wx`; a repeated `filename` overwrites as before. `defaultName` no longer appends the extension twice. | 04 |
| 3 | Egress route handler wraps lookups in `try/catch` and aborts on error, so a dead host cannot hang a render to the deadline. | 05 |
| 4 | `MAX_INFLIGHT_PER_KEY` defaults to 0 (off) so bursts still use the queue. | 03 |
| 5 | Emptying the keys file revokes keys after two consecutive empty reads. | 02 |
| 6 | Real-browser SSRF test counts server hits instead of parsing output. | 05 |
| 7 | `npm audit` gate moved to a scheduled and release workflow. | 02, 06 |
| 8 | `createApp` takes grouped `deps` objects, so later plans do not change its signature. | 01 |
| 9 | Egress allow-list CIDRs apply to resolved addresses; per-render DNS cache in the sketch. | 05 |
| 10 | Margin unit change listed as a visible output change. | 04 |
| 11 | Save quota total is cached; symlink check runs before `mkdir`. | 04 |
| 12 | Metrics for oversize and per-key rejections. | 03 |
| lean | `options.javascript` dropped from plan 05. | 05 |
| extra | Plan 06 claimed the image has `test/`; it copies only `server.js` and `src/`. Browser tests now mount `test/` read-only. | 06 |

## Decisions needed before EXECUTE

Recommended default in bold.

1. Fail-closed auth (plan 02): **refuse to start with no key source unless `AUTH_DISABLED=true`.** Alternative: warn only.
2. `/metrics` (plan 02): **require auth when auth is on.** Alternative: separate port.
3. Committed key (plan 02): owner rotates it. **No history rewrite** unless the repo is or becomes public.
4. `save` (plan 04): **reject traversal with 400, namespace per key label, return a relative path.** Breaks clients that read the volume by the old absolute path.
5. Egress (plan 05): **block private, loopback, and link-local by default, with `EGRESS_ALLOW`.**
6. Sandbox (plan 05): **try removing `--no-sandbox` with a seccomp profile in Docker; keep it if that fails.**
7. CI audit gate (plan 02): **block on high or critical in a scheduled and `package*.json`-triggered workflow and on release tags, not on every push.**
8. `AGENTS.md` / `GEMINI.md` (plan 07): **symlinks to `CLAUDE.md`.**

## Not planned (needs benchmarks)

Page pool vs context-per-request, `RENDER_CONCURRENCY` vs the `cpus: 1.0` limit, peak RSS at dpi 300/600, `waitUntil: 'load'` default. Plan 03 step 1 produces the RSS numbers.

## Verification limit

Chromium could not run on the audit host. Plans 03, 05, and 06 need Docker (or a host with Playwright system libraries) for their real-browser steps. Unit steps use stubs.
