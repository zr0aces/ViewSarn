const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'convert-cli.sh');
const hasJq = spawnSync('jq', ['--version']).status === 0;
const opts = { skip: hasJq ? false : 'jq is not installed' };

// A stand-in for curl that records each call and its request body, then answers
// with FAKE_STATUS. No server and no Chromium, and no in-process server for
// execFileSync to deadlock against.
function run(args, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-cli-'));
  fs.writeFileSync(path.join(dir, 'curl'), `#!/usr/bin/env bash
n=$(ls "$FAKE_DIR"/call-* 2>/dev/null | wc -l)
printf '%s\\n' "$@" > "$FAKE_DIR/call-$n.args"
out=""; while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-binary) cp "\${2#@}" "$FAKE_DIR/call-$n.body"; shift 2;;
    -o) out="$2"; shift 2;;
    *) shift;;
  esac
done
printf '%s' "\${FAKE_BODY:-%PDF-fake}" > "$out"
printf '%s' "\${FAKE_STATUS:-200}"
`, { mode: 0o755 });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-cli-cwd-'));
  fs.writeFileSync(path.join(cwd, 'page.html'), '<h1 class="x">"quoted" & <b>bold</b>\nsecond line</h1>');
  const result = spawnSync('bash', [script, ...args], {
    cwd,
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: cwd, FAKE_DIR: dir, ...env },
    encoding: 'utf8'
  });
  const calls = fs.readdirSync(dir).filter(f => f.endsWith('.body')).sort();
  const bodies = calls.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const callArgs = fs.readdirSync(dir).filter(f => f.endsWith('.args')).map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
  return { ...result, bodies, callArgs, cwd };
}

test('no --scale: the request has no scale key (the old script crashed here)', opts, () => {
  const r = run(['--file', 'page.html']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.bodies.length, 1);
  assert.equal('scale' in r.bodies[0].options, false);
  assert.equal(r.bodies[0].html, '<h1 class="x">"quoted" & <b>bold</b>\nsecond line</h1>', 'HTML survives JSON encoding intact');
  assert.equal(fs.readFileSync(path.join(r.cwd, 'output.pdf'), 'utf8'), '%PDF-fake');
});

test('--scale, --png, --single, --dpi are sent as JSON numbers and booleans', opts, () => {
  const r = run(['--file', 'page.html', '--scale', '0.8', '--png', '--single', '--dpi', '150', '--format', 'A5']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.bodies[0].options, { format: 'A5', scale: 0.8, dpi: 150, png: true, single: true });
});

test('--save sends exactly one request (the old script sent two)', opts, () => {
  const r = run(['--file', 'page.html', '--save', '--outpath', 'invoices/one.pdf'], { FAKE_BODY: '{"path":"x/one.pdf"}' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.bodies.length, 1);
  assert.equal(r.bodies[0].save, true);
  assert.equal(r.bodies[0].outPath, 'invoices/one.pdf');
  assert.match(r.stdout, /"path":"x\/one.pdf"/);
});

test('the key comes from the API_KEY environment variable, as --help says', opts, () => {
  const r = run(['--file', 'page.html'], { API_KEY: 'env-key' });
  assert.match(r.callArgs[0], /Authorization: Bearer env-key/);
  const flag = run(['--file', 'page.html', '--api-key', 'flag-key'], { API_KEY: 'env-key' });
  assert.match(flag.callArgs[0], /Bearer flag-key/);
});

test('an error response is reported and never written to the output file', opts, () => {
  const r = run(['--file', 'page.html', '--output', 'out.pdf'], { FAKE_STATUS: '401', FAKE_BODY: '{"error":"Unauthorized"}' });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /HTTP 401/);
  assert.match(r.stderr, /Unauthorized/);
  assert.equal(fs.existsSync(path.join(r.cwd, 'out.pdf')), false);
});

test('a missing file and a missing --file are usage errors', opts, () => {
  assert.equal(run(['--file', 'nope.html']).status, 2);
  assert.equal(run([]).status, 2);
  assert.equal(run(['--bogus']).status, 2);
});
