# Plan 05: Egress control and sandbox

Fixes F-05. Depends on plan 03 (shares `src/render.js` changes and the real-browser test path). Real-browser steps need Docker; the audit host could not run Chromium.

## Current state (verified)

- `src/render.js:21-24`: launch args `--no-sandbox --disable-setuid-sandbox`.
- `render.js:116` creates the context; no `route` anywhere. No `options.javascript` switch is added: the audit only said "consider" it, and it would widen the API for no finding.
- Spec R-0.5 and §6: callers are trusted. The deployment guide does not state the SSRF consequence.

## Steps

### 1. Destination check `src/egress.js`

Use `node:net` `BlockList` and `node:dns/promises`:

```js
const blocked = new net.BlockList();
for (const [net4, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15]]) blocked.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [['::1',128],['::',128],['fc00::',7],['fe80::',10]]) blocked.addSubnet(net6, prefix, 'ipv6');
async function isAllowedUrl(rawUrl, allowList, cache = new Map()) {   // cache: per render, host -> addresses
    const u = new URL(rawUrl);              // WHATWG parser normalises 2130706433 and 0x7f.1 to 127.0.0.1
    if (['data:', 'about:', 'blob:'].includes(u.protocol)) return true;
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (allowList.hostnames.has(host)) return true;
    let addrs = cache.get(host);
    if (!addrs) {   // one lookup per host per render; throws on lookup failure, the caller denies
        addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(a => a.address);
        cache.set(host, addrs);
    }
    const family = (a) => (a.includes(':') ? 'ipv6' : 'ipv4');
    // CIDR allow entries apply to the resolved addresses, not to the hostname.
    return addrs.every(a => allowList.cidrs.check(a, family(a)) || !blocked.check(a, family(a)));
}
```
`EGRESS_ALLOW` (comma-separated hostnames and CIDRs, default empty) is parsed once in `config.js` into `{ hostnames: Set, cidrs: net.BlockList }`. Treat IPv4-mapped IPv6 (`::ffff:127.0.0.1`) explicitly: unwrap to the IPv4 form before `check`, and verify in a test that `BlockList` agrees.

Unit tests (table-driven, `dns.lookup` stubbed): public IPv4 and IPv6, each blocked range at its first and last address, `localhost`, `http://2130706433/`, `http://0x7f.1/`, `http://[::ffff:7f00:1]/`, `http://user@127.0.0.1/`, `file:///etc/passwd`, `ftp://…`, a hostname resolving to both public and private (denied), a hostname allow-list hit, a CIDR allow entry matching a resolved private address, two URLs on one host cause one lookup. A DNS failure makes `isAllowedUrl` reject; the route handler (step 2) turns that into an abort.

Commit: `feat(egress): destination check`.

### 2. Wire into `src/render.js` (R11)

Inside `work`, register the route before `newPage`, immediately after `b.newContext(...)` succeeds and before `newPage`:

```js
const egressCache = new Map();
await context.route('**/*', async (route) => {
    const url = route.request().url();
    try {
        if (await isAllowedUrl(url, EGRESS_ALLOW, egressCache)) return await route.continue();
        logger.warn({ host: safeHost(url) }, 'Blocked outbound request');
    } catch (err) {
        // DNS failure or unparsable URL: deny. An unanswered route would hang the
        // request until the render deadline.
        logger.warn({ host: safeHost(url), reason: err.code || err.message }, 'Outbound request denied');
    }
    return route.abort('blockedbyclient').catch(() => {});
});
```
`safeHost` logs the hostname only (no path or query) and never throws. Redirects pass through `route` again at each hop.

Tests with a stub context: `route` is registered once, before `newPage`; allowed URL calls `continue`; blocked URL calls `abort`; a lookup that rejects (`ENOTFOUND`) calls `abort` and never leaves the request unanswered.

Commit: `feat(render): block private-network requests from rendered HTML`.

### 3. Real-browser test (Docker)

Add `test/browser/egress.test.js`, skipped unless `RUN_BROWSER_TESTS=1`. Start a local HTTP server on 127.0.0.1 that counts requests per path. Render HTML that `fetch`es `http://127.0.0.1:<port>/secret.txt`, and a second page with `<img src="http://localhost:<port>/img.png">` and an `<img>` to a dead hostname (`http://no-such-host.invalid/`). Assert the server received 0 requests, so no parser or text extraction is needed, and assert the dead-host page still returns within a few seconds (not at the 60 s deadline). Assert a `data:` image page still renders. This is the exact probe the audit could not run.

Commit: `test(egress): real-browser SSRF probe`.

### 4. Sandbox investigation (decision 6)

In Docker, as `www-data`:
1. Remove `--no-sandbox` locally and run a render. Expected failure: "No usable sandbox".
2. Add `security_opt: ["seccomp=chrome.json"]` using the widely used Chromium profile (Jess Frazelle's `chrome.json`, reviewed and stored in the repo as `docker/chrome.json`) and retry.
3. Record outcome here.

If it works: drop the flags from `render.js`, add the profile to `docker-compose.yml` and the docs, keep the Dockerfile user unchanged. If not: keep `--no-sandbox`, and add compensating controls to compose where Chromium tolerates them: `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `read_only: true` with `tmpfs` for `/tmp` and `/output` where needed. Test each flag with the smoke render before keeping it.

Commit: `chore(docker): sandbox profile` (or `chore(docker): drop capabilities`).

### 5. Docs

`documents/deployment.md`: threat section. HTML is an SSRF vector; the route filter is an application layer check with a DNS-rebinding gap (the lookup in step 1 and Chromium's own lookup are separate); the real boundary is a network rule that denies private ranges and `169.254.169.254` from the container. Add a compose example with an egress-restricted network. Spec: requirements for the filter and `EGRESS_ALLOW`. Note: `route` does not intercept WebSockets.

## Acceptance

- The audit's SSRF probe no longer returns the secret.
- A page with `data:` assets still renders; fonts come from the image.
- `npm test` passes; `RUN_BROWSER_TESTS=1 npm run test:browser` passes in Docker.

## Risks and rollback

- Default block breaks callers loading internal assets (decision 5): use `EGRESS_ALLOW`.
- Extra DNS lookups add latency; keep a per-render cache (`Map`) only.
- Seccomp profile needs retesting on Playwright upgrades (plan 06 smoke test covers it).
- Revert per commit; `EGRESS_ALLOW` can list `0.0.0.0/0` if an operator must disable the filter.

## EXECUTE notes (2026-10-24)

- Step 3 ran in a real container built from this branch. A page that fetched a local server and a dead host produced 0 hits on the server with the filter; with the destination in `EGRESS_ALLOW` it produced 2 hits (the control). The dead host and `169.254.169.254` did not stall the render (0.6 s). `test/browser/egress.test.js` passes in the image.
- Step 4: Playwright adds `--no-sandbox` unless `chromiumSandbox: true` is passed. With it, Chromium fails to start under Docker's default seccomp profile and starts with `seccomp=unconfined` or `--cap-add SYS_ADMIN`. A custom `chrome.json` could not be tested: the Docker daemon on the audit host refused it at container init (`runc ... function not implemented`). Decision: keep `--no-sandbox` and add compensating controls (`cap_drop: ALL`, `no-new-privileges`, read-only root, `/tmp` tmpfs), which were verified with Thai PDF, PNG at dpi 300 and `save`.
- `options.javascript` was not added (dropped in review round 2).
- Correction (2026-10-25): "Redirects pass through `route` again at each hop" was wrong. Playwright calls a route handler only for the first URL of a redirect chain, so a public URL answering 302 to a private address bypassed the filter; a real-Chromium test confirmed the bypass. `handleRoute` in `src/egress.js` now follows redirects itself with `maxRedirects: 0` and checks every hop; `test/browser/egress.test.js` has a redirect case that fails on the old code.
- Correction (2026-10-25, review round 2): WebSockets bypassed the filter, because `context.route` never sees them. `handleWebSocket` now checks them through `context.routeWebSocket`. A real-Chromium experiment also showed that Chromium does not route a redirect handed to it by `route.fulfill`, so the filter must keep following hops itself.
