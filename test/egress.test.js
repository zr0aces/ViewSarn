const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const { isAllowedUrl, parseAllowList, safeHost } = require('../src/egress');
const { loadRender } = require('./stubBrowser');

const none = parseAllowList('');
const hosts = {
  'public.example': ['93.184.216.34'],
  'v6.example': ['2606:2800:220:1:248:1893:25c8:1946'],
  'internal.example': ['10.1.2.3'],
  'mixed.example': ['93.184.216.34', '10.0.0.5'],
  'localhost': ['127.0.0.1', '::1']
};
const fakeLookup = (t) => t.mock.method(dns, 'lookup', async (host) => {
  if (!hosts[host]) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  return hosts[host].map((address) => ({ address }));
});

test('public destinations are allowed', async (t) => {
  fakeLookup(t);
  for (const url of ['http://public.example/a.png', 'https://public.example:8443/', 'http://93.184.216.34/', 'http://[2606:2800:220:1:248:1893:25c8:1946]/', 'https://v6.example/']) {
    assert.equal(await isAllowedUrl(url, none), true, url);
  }
});

test('every private, loopback and link-local range is blocked at its edges', async () => {
  const blockedIps = [
    '0.0.0.1', '10.0.0.0', '10.255.255.255', '100.64.0.0', '100.127.255.255', '127.0.0.1', '127.255.255.255',
    '169.254.0.1', '169.254.169.254', '172.16.0.0', '172.31.255.255', '192.168.0.0', '192.168.255.255', '198.18.0.1'
  ];
  for (const ip of blockedIps) assert.equal(await isAllowedUrl(`http://${ip}/`, none), false, ip);
  for (const ip of ['[::1]', '[fc00::1]', '[fd12:3456::1]', '[fe80::1]', '[::]']) {
    assert.equal(await isAllowedUrl(`http://${ip}/`, none), false, ip);
  }
  // Just outside the ranges.
  for (const ip of ['172.15.255.255', '172.32.0.0', '11.0.0.0', '100.128.0.0', '192.169.0.0', '169.253.255.255']) {
    assert.equal(await isAllowedUrl(`http://${ip}/`, none), true, ip);
  }
});

test('alternative spellings of loopback are caught', async () => {
  for (const url of ['http://2130706433/', 'http://0x7f.1/', 'http://017700000001/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:127.0.0.1]/', 'http://user:pw@127.0.0.1/', 'http://127.1/']) {
    assert.equal(await isAllowedUrl(url, none), false, url);
  }
});

test('hostnames are resolved and every address is checked', async (t) => {
  fakeLookup(t);
  assert.equal(await isAllowedUrl('http://localhost/', none), false);
  assert.equal(await isAllowedUrl('http://internal.example/', none), false);
  assert.equal(await isAllowedUrl('http://mixed.example/', none), false, 'one private address is enough to deny');
});

test('non-http schemes are denied; data, about and blob are allowed', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://public.example/x', 'gopher://x/', 'javascript:alert(1)']) {
    assert.equal(await isAllowedUrl(url, none), false, url);
  }
  for (const url of ['data:image/png;base64,AAAA', 'about:blank', 'blob:http://public.example/uuid']) {
    assert.equal(await isAllowedUrl(url, none), true, url);
  }
});

test('a DNS failure rejects, so the caller can deny', async (t) => {
  fakeLookup(t);
  await assert.rejects(() => isAllowedUrl('http://no-such-host.invalid/', none), /ENOTFOUND/);
  await assert.rejects(() => isAllowedUrl('not a url', none));
});

test('EGRESS_ALLOW: hostnames, IPs and CIDRs open exactly what they name', async (t) => {
  fakeLookup(t);
  const allow = parseAllowList('internal.example, 192.168.5.0/24, 10.9.9.9 ,');
  assert.equal(await isAllowedUrl('http://internal.example/', allow), true, 'hostname entry');
  assert.equal(await isAllowedUrl('http://192.168.5.77/', allow), true, 'CIDR entry');
  assert.equal(await isAllowedUrl('http://192.168.6.1/', allow), false, 'next /24 stays blocked');
  assert.equal(await isAllowedUrl('http://10.9.9.9/', allow), true, 'single IP entry');
  assert.equal(await isAllowedUrl('http://10.9.9.8/', allow), false);

  hosts['cidr.example'] = ['192.168.5.9'];
  assert.equal(await isAllowedUrl('http://cidr.example/', allow), true, 'a CIDR applies to a hostname after it resolves');
  delete hosts['cidr.example'];
});

test('one lookup per host per render', async (t) => {
  const lookup = fakeLookup(t);
  const cache = new Map();
  await isAllowedUrl('http://public.example/a', none, cache);
  await isAllowedUrl('http://public.example/b', none, cache);
  await isAllowedUrl('https://public.example/c', none, cache);
  assert.equal(lookup.mock.callCount(), 1);
});

test('safeHost drops path and query and never throws', () => {
  assert.equal(safeHost('https://a.example/x?token=secret'), 'a.example');
  assert.equal(safeHost('garbage'), 'invalid-url');
});

// ---- wiring in render.js ----

function fakeRoute(url) {
  const calls = { continue: 0, abort: 0 };
  return {
    calls,
    request: () => ({ url: () => url }),
    continue: async () => { calls.continue += 1; },
    abort: async () => { calls.abort += 1; }
  };
}

test('render registers the filter before the page exists and answers every request', async (t) => {
  fakeLookup(t);
  const { render, state } = loadRender();
  await render.renderHtmlToBuffer('<p>x</p>', {});
  const [context] = state.contexts;
  assert.equal(context.routes.length, 1);
  assert.equal(context.routes[0].pattern, '**/*');

  const handler = context.routes[0].handler;
  const ok = fakeRoute('http://public.example/a.png');
  await handler(ok);
  assert.deepEqual(ok.calls, { continue: 1, abort: 0 });

  const private_ = fakeRoute('http://169.254.169.254/latest/meta-data/');
  await handler(private_);
  assert.deepEqual(private_.calls, { continue: 0, abort: 1 });

  const dead = fakeRoute('http://no-such-host.invalid/x.png');
  await handler(dead);
  assert.deepEqual(dead.calls, { continue: 0, abort: 1 }, 'a lookup failure aborts instead of leaving the request unanswered');

  const file = fakeRoute('file:///etc/passwd');
  await handler(file);
  assert.deepEqual(file.calls, { continue: 0, abort: 1 });
});

test('the route is registered before newPage', async () => {
  const order = [];
  const { render } = loadRender({
    newContext: async () => ({
      route: async () => { order.push('route'); },
      newPage: async () => {
        order.push('newPage');
        return { setContent: async () => {}, evaluate: async () => ({ width: 800, height: 600 }), pdf: async () => Buffer.from('p') };
      },
      close: async () => {}
    })
  });
  await render.renderHtmlToBuffer('<p>x</p>', {});
  assert.deepEqual(order, ['route', 'newPage']);
});
