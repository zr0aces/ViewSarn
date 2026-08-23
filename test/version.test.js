const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const CALVER_REGEX = /^(?<year>2\d{3})\.(?<month>[1-9]|1[0-2])\.(?<minor>\d+)$/;
const rootDir = path.resolve(__dirname, '..');

test('VERSION file exists and contains valid CalVer string', () => {
  const versionFile = path.join(rootDir, 'VERSION');
  assert.ok(fs.existsSync(versionFile), 'VERSION file must exist at repo root');
  const version = fs.readFileSync(versionFile, 'utf8').trim();
  assert.match(version, CALVER_REGEX, 'VERSION must match CalVer format YYYY.M.MINOR');
});

test('CalVer regex rejects invalid month formats with leading zeroes and invalid months', () => {
  assert.ok(!CALVER_REGEX.test('2026.08.1'), 'Must reject leading zero in month');
  assert.ok(!CALVER_REGEX.test('2026.0.1'), 'Must reject month 0');
  assert.ok(!CALVER_REGEX.test('2026.13.1'), 'Must reject month 13');
  assert.ok(!CALVER_REGEX.test('1.0.0'), 'Must reject semver format');
  assert.ok(CALVER_REGEX.test('2026.8.1'), 'Must accept valid CalVer 2026.8.1');
  assert.ok(CALVER_REGEX.test('2026.12.10'), 'Must accept valid CalVer 2026.12.10');
});

test('sync-version.mjs --check passes on synced repository', () => {
  const output = execSync('node scripts/sync-version.mjs --check', {
    cwd: rootDir,
    encoding: 'utf8'
  });
  assert.match(output, /All target files match VERSION/);
});
