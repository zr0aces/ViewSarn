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
// when private (an internal CDN, for example).
function parseAllowList(value) {
    const allow = { hostnames: new Set(), cidrs: new net.BlockList() };
    for (const raw of (value || '').split(',')) {
        const entry = raw.trim().toLowerCase();
        if (!entry) continue;
        const [address, prefix] = entry.split('/');
        if (net.isIP(address) && prefix !== undefined) allow.cidrs.addSubnet(address, Number(prefix), family(address));
        else if (net.isIP(address)) allow.cidrs.addAddress(address, family(address));
        else allow.hostnames.add(entry);
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

module.exports = { isAllowedUrl, parseAllowList, safeHost, _dns: dns };
