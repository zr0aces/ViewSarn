const net = require('net');
const dns = require('dns').promises;

// Where rendered HTML may NOT reach: loopback, private, link-local (this includes
// the 169.254.169.254 cloud metadata address), carrier-grade NAT, and the IPv6
// equivalents. net.BlockList also matches IPv4-mapped IPv6 such as ::ffff:7f00:1.
const blocked = new net.BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15]
]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::1', 128], ['::', 128], ['fc00::', 7], ['fe80::', 10]]) {
    blocked.addSubnet(address, prefix, 'ipv6');
}

const family = (address) => (address.includes(':') ? 'ipv6' : 'ipv4');

// EGRESS_ALLOW: comma-separated hostnames, IPs and CIDRs that stay reachable even
// when private (an internal CDN, for example). A malformed CIDR stops startup
// with a message naming the variable, rather than a bare ERR_OUT_OF_RANGE or a
// "hostname" containing a slash that silently matches nothing.
function parseAllowList(value) {
    const allow = { hostnames: new Set(), cidrs: new net.BlockList() };
    for (const raw of (value || '').split(',')) {
        const entry = raw.trim().toLowerCase();
        if (!entry) continue;
        if (!entry.includes('/')) {
            if (net.isIP(entry)) allow.cidrs.addAddress(entry, family(entry));
            else allow.hostnames.add(entry);
            continue;
        }
        const [address, prefix] = entry.split('/');
        const max = net.isIP(address) === 6 ? 128 : 32;
        if (!net.isIP(address) || !/^\d{1,3}$/.test(prefix) || Number(prefix) > max) {
            throw new Error(`EGRESS_ALLOW entry "${raw.trim()}" is not a valid CIDR. Use an address and a prefix such as 10.20.0.0/16.`);
        }
        allow.cidrs.addSubnet(address, Number(prefix), family(address));
    }
    return allow;
}

// Resolves the host (once per render, through `cache`) and checks every address.
// Throws if the lookup fails or the URL does not parse: the caller denies.
async function isAllowedUrl(rawUrl, allowList, cache = new Map()) {
    const url = new URL(rawUrl);   // the WHATWG parser turns 2130706433 and 0x7f.1 into 127.0.0.1
    if (['data:', 'about:', 'blob:'].includes(url.protocol)) return true;
    if (!['http:', 'https:'].includes(url.protocol)) return false;

    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (allowList.hostnames.has(host)) return true;

    let addresses = cache.get(host);
    if (!addresses) {
        addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
        cache.set(host, addresses);
    }
    // CIDR allow entries apply to the resolved addresses, not to the hostname.
    return addresses.every((a) => allowList.cidrs.check(a, family(a)) || !blocked.check(a, family(a)));
}

// Hostname only: a query string or path can carry a secret.
function safeHost(rawUrl) {
    try { return new URL(rawUrl).hostname; } catch { return 'invalid-url'; }
}

const MAX_REDIRECTS = 5;
// The statuses a browser follows; 300, 304 and 305 with a Location are not redirects.
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const isHttp = (url) => /^https?:/i.test(url);
// Required lazily, not at the top: config requires this module for
// parseAllowList, and the logger requires config.
const log = () => require('./logger');

// Playwright calls a route handler only for the first URL of a redirect chain,
// and Chromium does not route a redirect it was handed through route.fulfill
// either (both checked against real Chromium). So redirects are followed here
// through `api` (the context's APIRequestContext), checking every hop, and the
// browser gets the final response under the first URL; relative URLs inside a
// redirected stylesheet or frame therefore resolve against that first URL.
// Every request gets an answer: an unanswered one hangs until the render deadline.
async function handleRoute(route, api, allowList, cache) {
    const request = route.request();
    let url = request.url();
    let method = request.method();
    let data = request.postDataBuffer() || undefined;
    const headers = { ...request.headers() };
    try {
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            if (!(await isAllowedUrl(url, allowList, cache))) {
                log().warn({ host: safeHost(url), hop }, 'Blocked outbound request');
                break;
            }
            // data:, blob: and about: never redirect; a redirect to one is refused.
            if (!isHttp(url)) {
                if (hop === 0) return await route.continue();
                break;
            }
            // shortcut: the response is buffered in Node instead of streamed; the render
            // deadline and the container memory limit bound it. Stream if large assets matter.
            const response = await api.fetch(url, { method, headers, data, maxRedirects: 0, failOnStatusCode: false });
            const status = response.status();
            const location = response.headers().location;
            if (!REDIRECTS.has(status) || !location) return await route.fulfill({ response });
            await response.dispose();
            const next = new URL(location, url);
            // The Fetch standard's rules: 303, and 301 or 302 after a POST, become a
            // body-less GET (HEAD stays HEAD), and credentials stay with their origin.
            if ((status === 303 && method !== 'HEAD') || ((status === 301 || status === 302) && method === 'POST')) {
                method = 'GET';
                data = undefined;
                delete headers['content-type'];
                delete headers['content-length'];
            }
            if (next.origin !== new URL(url).origin) {
                delete headers.authorization;
                delete headers.cookie;
            }
            url = next.href;
            if (hop === MAX_REDIRECTS) log().warn({ host: safeHost(url) }, 'Too many redirects');
        }
    } catch (err) {
        // DNS failure, an unparsable URL, or the fetch itself failed: deny.
        log().warn({ host: safeHost(url), reason: err.code || err.message }, 'Outbound request denied');
    }
    return route.abort('blockedbyclient').catch(() => {});
}

// WebSockets never reach context.route; Playwright routes them separately. The
// same check applies, with ws: and wss: read as http: and https:. A WebSocket
// handshake does not follow redirects, so there is only one hop.
async function handleWebSocket(ws, allowList, cache) {
    const url = ws.url();
    try {
        if (await isAllowedUrl(url.replace(/^ws/i, 'http'), allowList, cache)) return ws.connectToServer();
        log().warn({ host: safeHost(url) }, 'Blocked outbound WebSocket');
    } catch (err) {
        log().warn({ host: safeHost(url), reason: err.code || err.message }, 'Outbound WebSocket denied');
    }
    return ws.close({ code: 1008, reason: 'Blocked by egress policy' });
}

module.exports = { isAllowedUrl, parseAllowList, safeHost, handleRoute, handleWebSocket };
