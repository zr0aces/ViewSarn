const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const { isAllowedUrl, parseAllowList, safeHost, handleRoute, handleWebSocket } = require('../src/egress');
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

test('a malformed EGRESS_ALLOW CIDR stops startup with a message naming the variable', () => {
  for (const entry of ['10.0.0.0/abc', '10.0.0.0/33', '::1/129', '10.0.0/8', '10.0.0.0/']) {
    assert.throws(() => parseAllowList(`ok.example,${entry}`), /EGRESS_ALLOW entry ".*" is not a valid CIDR/, entry);
  }
  assert.doesNotThrow(() => parseAllowList('10.0.0.0/0, fd00::/8, 192.168.1.1/32'));
});

// ---- route handling ----

function fakeRoute(url, { method = 'GET', headers = {}, body = null } = {}) {
  const calls = { continue: 0, abort: 0, fulfill: [] };
  return {
    calls,
    request: () => ({ url: () => url, method: () => method, headers: () => headers, postDataBuffer: () => body }),
    continue: async () => { calls.continue += 1; },
    abort: async () => { calls.abort += 1; },
    fulfill: async ({ response }) => { calls.fulfill.push(response.url); }
  };
}

// Answers each URL from `replies` ({ status, location }), 200 otherwise, and
// records every request it was asked to make.
function fakeApi(replies = {}) {
  const fetched = [];
  return {
    fetched,
    fetch: async (url, options) => {
      fetched.push({ url, method: options.method, headers: { ...options.headers }, data: options.data, maxRedirects: options.maxRedirects });
      const reply = replies[url] || { status: 200 };
      return {
        url,
        status: () => reply.status,
        headers: () => (reply.location ? { location: reply.location } : {}),
        dispose: async () => {}
      };
    }
  };
}

test('allowed requests are fetched without following redirects and fulfilled; blocked ones never leave', async (t) => {
  fakeLookup(t);
  const api = fakeApi();

  const ok = fakeRoute('http://public.example/a.png');
  await handleRoute(ok, api, none, new Map());
  assert.deepEqual(ok.calls, { continue: 0, abort: 0, fulfill: ['http://public.example/a.png'] });
  assert.equal(api.fetched[0].maxRedirects, 0, 'redirects must not be followed by the fetch itself');

  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://no-such-host.invalid/x.png', 'file:///etc/passwd']) {
    const route = fakeRoute(url);
    await handleRoute(route, api, none, new Map());
    assert.deepEqual(route.calls, { continue: 0, abort: 1, fulfill: [] }, url);
  }
  assert.equal(api.fetched.length, 1, 'nothing blocked was fetched');

  const dot = fakeRoute('data:image/png;base64,AAAA');
  await handleRoute(dot, api, none, new Map());
  assert.deepEqual(dot.calls, { continue: 1, abort: 0, fulfill: [] });
});

test('every redirect hop is checked: a public URL cannot bounce the browser to a private one', async (t) => {
  fakeLookup(t);
  const api = fakeApi({
    'http://public.example/r': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' }
  });
  const route = fakeRoute('http://public.example/r');
  await handleRoute(route, api, none, new Map());
  assert.deepEqual(route.calls, { continue: 0, abort: 1, fulfill: [] });
  assert.deepEqual(api.fetched.map(f => f.url), ['http://public.example/r'], 'the private hop was never requested');
});

test('allowed redirects are followed to the final response, relative locations included', async (t) => {
  fakeLookup(t);
  const api = fakeApi({
    'http://public.example/a': { status: 301, location: 'https://public.example/b' },
    'https://public.example/b': { status: 307, location: '/c' }
  });
  const route = fakeRoute('http://public.example/a', { method: 'POST' });
  await handleRoute(route, api, none, new Map());
  assert.deepEqual(route.calls.fulfill, ['https://public.example/c']);
  assert.deepEqual(api.fetched.map(f => `${f.method} ${f.url}`),
    ['POST http://public.example/a', 'GET https://public.example/b', 'GET https://public.example/c'],
    '301 turns the POST into a GET; 307 keeps the method');
});

test('a redirect loop is cut off and denied', async (t) => {
  fakeLookup(t);
  const api = fakeApi({ 'http://public.example/loop': { status: 302, location: '/loop' } });
  const route = fakeRoute('http://public.example/loop');
  await handleRoute(route, api, none, new Map());
  assert.deepEqual(route.calls, { continue: 0, abort: 1, fulfill: [] });
  assert.equal(api.fetched.length, 6, 'the first request plus five redirects');
});

test('only 301, 302, 303, 307 and 308 are followed; a 304 or 300 with a Location is handed over as is', async (t) => {
  fakeLookup(t);
  for (const status of [300, 304, 305]) {
    const api = fakeApi({ 'http://public.example/x': { status, location: '/elsewhere' } });
    const route = fakeRoute('http://public.example/x');
    await handleRoute(route, api, none, new Map());
    assert.deepEqual(route.calls.fulfill, ['http://public.example/x'], String(status));
    assert.equal(api.fetched.length, 1, String(status));
  }
});

test('a redirect drops the body and its headers when the method becomes GET, keeps HEAD, and drops credentials across origins', async (t) => {
  fakeLookup(t);
  const api = fakeApi({
    'http://public.example/form': { status: 303, location: 'http://v6.example/done' },
    'http://public.example/head': { status: 303, location: '/head2' }
  });
  const headers = { 'content-type': 'application/json', 'content-length': '2', authorization: 'Bearer x', cookie: 'a=b', accept: '*/*' };
  await handleRoute(fakeRoute('http://public.example/form', { method: 'POST', headers, body: Buffer.from('{}') }), api, none, new Map());
  const [, second] = api.fetched;
  assert.equal(second.method, 'GET');
  assert.equal(second.data, undefined);
  assert.deepEqual(second.headers, { accept: '*/*' }, 'no body headers, no credentials for the other origin');

  await handleRoute(fakeRoute('http://public.example/head', { method: 'HEAD', headers: { authorization: 'Bearer x' } }), api, none, new Map());
  assert.deepEqual(api.fetched.slice(2).map(f => `${f.method} ${f.headers.authorization}`), ['HEAD Bearer x', 'HEAD Bearer x'],
    'HEAD stays HEAD, and a same-origin hop keeps its credentials');
});

function fakeWebSocket(url) {
  const calls = { connect: 0, close: [] };
  return { calls, url: () => url, connectToServer: () => { calls.connect += 1; }, close: (o) => { calls.close.push(o.code); } };
}

test('WebSockets get the same check: public connects, private, unresolvable and unknown hosts are closed', async (t) => {
  fakeLookup(t);
  for (const url of ['ws://public.example/live', 'wss://public.example/live']) {
    const ws = fakeWebSocket(url);
    await handleWebSocket(ws, none, new Map());
    assert.deepEqual(ws.calls, { connect: 1, close: [] }, url);
  }
  for (const url of ['ws://127.0.0.1:9229/', 'wss://internal.example/', 'ws://no-such-host.invalid/']) {
    const ws = fakeWebSocket(url);
    await handleWebSocket(ws, none, new Map());
    assert.deepEqual(ws.calls, { connect: 0, close: [1008] }, url);
  }
  const allowed = fakeWebSocket('ws://127.0.0.1:9229/');
  await handleWebSocket(allowed, parseAllowList('127.0.0.1'), new Map());
  assert.equal(allowed.calls.connect, 1, 'EGRESS_ALLOW applies to WebSockets too');
});

test('render registers the filter for every request and every WebSocket of the context', async () => {
  const { render, state } = loadRender();
  await render.renderHtmlToBuffer('<p>x</p>', {});
  const [context] = state.contexts;
  assert.equal(context.routes.length, 1);
  assert.equal(context.routes[0].pattern, '**/*');
  assert.equal(context.wsRoutes.length, 1);
});

test('the route is registered before newPage', async () => {
  const order = [];
  const { render } = loadRender({
    newContext: async () => ({
      route: async () => { order.push('route'); },
      routeWebSocket: async () => { order.push('routeWebSocket'); },
      newPage: async () => {
        order.push('newPage');
        return { setContent: async () => {}, evaluate: async () => ({ width: 800, height: 600 }), pdf: async () => Buffer.from('p') };
      },
      close: async () => {}
    })
  });
  await render.renderHtmlToBuffer('<p>x</p>', {});
  assert.deepEqual(order, ['route', 'routeWebSocket', 'newPage']);
});
