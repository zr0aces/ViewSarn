const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  generateKey,
  principalFor,
  writeKeysToFile,
  parseArgs,
  main,
} = require('../scripts/generate-apikey');
const { loadFreshModules } = require('./helpers');

const jsScript = path.resolve(__dirname, '..', 'scripts', 'generate-apikey.js');
const shScript = path.resolve(__dirname, '..', 'scripts', 'generate-apikey.sh');

test('generateKey creates cryptographically random keys', () => {
  const k1 = generateKey();
  const k2 = generateKey();

  assert.equal(typeof k1, 'string');
  assert.equal(k1.length, 64, '32 bytes hex should be 64 characters');
  assert.match(k1, /^[0-9a-f]{64}$/);
  assert.notEqual(k1, k2, 'repeated calls generate distinct keys');

  const b64 = generateKey({ format: 'base64url' });
  assert.equal(b64.length, 43, '32 bytes base64url should be 43 characters');
  assert.match(b64, /^[A-Za-z0-9_-]{43}$/);

  const prefixed = generateKey({ prefix: 'vs_' });
  assert.ok(prefixed.startsWith('vs_'));
  assert.equal(prefixed.length, 67);

  const customBytes = generateKey({ bytes: 16 });
  assert.equal(customBytes.length, 32, '16 bytes hex should be 32 characters');
});

test('principalFor matches ViewSarn auth principal generation', () => {
  const key = 'test-secret-key-12345';
  const expectedHash = crypto.createHash('sha256').update(key, 'utf8').digest('hex');
  const principal = principalFor(key);

  assert.equal(principal.id, `k:${expectedHash}`);
  assert.equal(principal.label, expectedHash.slice(0, 12));
});

test('parseArgs validates and normalizes arguments correctly', () => {
  const def = parseArgs([]);
  assert.equal(def.count, 1);
  assert.equal(def.file, null);
  assert.equal(def.prefix, '');
  assert.equal(def.format, 'hex');
  assert.equal(def.bytes, 32);
  assert.equal(def.raw, false);
  assert.equal(def.json, false);

  const parsed = parseArgs([
    '-f', 'keys.txt',
    '-n', '3',
    '-c', 'frontend app',
    '-p', 'vs_',
    '--format', 'base64url',
    '--bytes', '48',
    '--overwrite',
    '-q',
  ]);

  assert.equal(parsed.file, 'keys.txt');
  assert.equal(parsed.count, 3);
  assert.equal(parsed.comment, 'frontend app');
  assert.equal(parsed.prefix, 'vs_');
  assert.equal(parsed.format, 'base64url');
  assert.equal(parsed.bytes, 48);
  assert.equal(parsed.overwrite, true);
  assert.equal(parsed.raw, true);

  // Default file fallback when flag provided without parameter
  const defFile = parseArgs(['-f']);
  assert.equal(defFile.file, 'apikeys.txt');

  const eqSyntax = parseArgs(['--file=custom.txt', '--count=2', '--comment=ci', '--prefix=api_']);
  assert.equal(eqSyntax.file, 'custom.txt');
  assert.equal(eqSyntax.count, 2);
  assert.equal(eqSyntax.comment, 'ci');
  assert.equal(eqSyntax.prefix, 'api_');
});

test('parseArgs rejects invalid inputs', () => {
  assert.throws(() => parseArgs(['--count', '0']), /Count must be an integer between 1 and 10000/);
  assert.throws(() => parseArgs(['--count', '-5']), /Count must be an integer between 1 and 10000/);
  assert.throws(() => parseArgs(['--count', 'abc']), /Count must be an integer between 1 and 10000/);
  assert.throws(() => parseArgs(['--bytes', '8']), /Bytes must be an integer between 16 and 1024/);
  assert.throws(() => parseArgs(['--format', 'json']), /Invalid format/);
  assert.throws(() => parseArgs(['--prefix', 'bad prefix!']), /Prefix may only contain/);
  assert.throws(() => parseArgs(['--unknown-flag']), /Unknown option/);
});

test('writeKeysToFile creates file with 0600 permissions and appends cleanly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-test-keys-'));
  const targetFile = path.join(tmpDir, 'subdir', 'apikeys.txt');

  try {
    const key1 = generateKey();
    const p1 = principalFor(key1);
    const item1 = {
      key: key1,
      id: p1.id,
      label: p1.label,
      comment: 'first key',
      createdAt: '2026-10-25T05:00:00.000Z',
    };

    writeKeysToFile(targetFile, [item1]);

    assert.ok(fs.existsSync(targetFile));
    const stat = fs.statSync(targetFile);
    assert.equal(stat.mode & 0o777, 0o600, 'file permissions must be 0600');

    let content = fs.readFileSync(targetFile, 'utf8');
    assert.ok(content.includes('# ViewSarn API keys file'));
    assert.ok(content.includes('# first key (created 2026-10-25T05:00:00.000Z, label ' + p1.label + ')'));
    assert.ok(content.includes(key1));

    // Append second key
    const key2 = generateKey();
    const p2 = principalFor(key2);
    const item2 = {
      key: key2,
      id: p2.id,
      label: p2.label,
      comment: 'second key',
      createdAt: '2026-10-25T05:05:00.000Z',
    };

    writeKeysToFile(targetFile, [item2]);

    content = fs.readFileSync(targetFile, 'utf8');
    assert.ok(content.includes(key1), 'original key preserved');
    assert.ok(content.includes(key2), 'second key appended');
    assert.ok(content.includes('# second key'));

    // Overwrite with third key
    const key3 = generateKey();
    const p3 = principalFor(key3);
    const item3 = {
      key: key3,
      id: p3.id,
      label: p3.label,
      comment: 'replacement key',
      createdAt: '2026-10-25T05:10:00.000Z',
    };

    writeKeysToFile(targetFile, [item3], { overwrite: true });

    content = fs.readFileSync(targetFile, 'utf8');
    assert.ok(!content.includes(key1), 'overwritten file must not have key1');
    assert.ok(content.includes(key3));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI generate-apikey.js outputs raw key with -q', () => {
  const result = spawnSync('node', [jsScript, '-q'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const key = result.stdout.trim();
  assert.match(key, /^[0-9a-f]{64}$/);
});

test('CLI generate-apikey.js outputs JSON array with --json', () => {
  const result = spawnSync('node', [jsScript, '--json', '-n', '2', '--prefix', 'vs_'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout);
  assert.equal(Array.isArray(data), true);
  assert.equal(data.length, 2);
  assert.ok(data[0].key.startsWith('vs_'));
  assert.match(data[0].id, /^k:[0-9a-f]{64}$/);
  assert.equal(data[0].label, data[0].id.slice(2, 14));
});

test('CLI generate-apikey.js writes to file and sets 0600 mode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-cli-keys-'));
  const target = path.join(tmpDir, 'test-keys.txt');

  try {
    const result = spawnSync('node', [jsScript, '-f', target, '-c', 'automation key'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('Generated 1 API key and appended to'));
    assert.ok(fs.existsSync(target));
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    const content = fs.readFileSync(target, 'utf8');
    assert.ok(content.includes('# automation key'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI generate-apikey.js exits with 2 on invalid arguments', () => {
  const result = spawnSync('node', [jsScript, '--invalid-arg'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes('Unknown option'));
});

test('CLI generate-apikey.sh works in shell execution', () => {
  const result = spawnSync('bash', [shScript, '-q'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const key = result.stdout.trim();
  assert.match(key, /^[0-9a-f]{64}$/);
});

test('CLI generate-apikey.sh works in pure shell fallback without node', () => {
  // Pass minimal PATH containing standard utilities and openssl, but excluding node
  const result = spawnSync('bash', [shScript, '-q'], {
    env: { PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const key = result.stdout.trim();
  assert.match(key, /^[0-9a-f]{64}$/);
});

test('generated key authenticates against ViewSarn auth module', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewsarn-auth-int-'));
  const keysFile = path.join(tmpDir, 'apikeys.txt');

  try {
    // Generate key to keysFile
    const res = spawnSync('node', [jsScript, '-f', keysFile, '-c', 'int-test'], { encoding: 'utf8' });
    assert.equal(res.status, 0);

    const keysContent = fs.readFileSync(keysFile, 'utf8');
    const generatedKey = keysContent.split(/\r?\n/).find(l => l && !l.startsWith('#')).trim();
    assert.ok(generatedKey);

    const auth = loadFreshModules({
      API_KEYS_FILE: keysFile,
      API_KEYS_RELOAD_MS: '1000',
    }, ['../src/auth']);

    const validResult = auth.validateAuth({
      get(name) {
        if (name.toLowerCase() === 'authorization') return `Bearer ${generatedKey}`;
        return null;
      }
    });

    assert.equal(validResult.valid, true);
    assert.equal(validResult.authRequired, true);
    assert.equal(validResult.principal.label, principalFor(generatedKey).label);

    const invalidResult = auth.validateAuth({
      get(name) {
        if (name.toLowerCase() === 'authorization') return 'Bearer invalid-key';
        return null;
      }
    });

    assert.equal(invalidResult.valid, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
