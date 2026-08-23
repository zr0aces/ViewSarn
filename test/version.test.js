const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Import the real definitions rather than restating them: a test that carries
// its own copy of the regex passes happily while the scripts drift away.
const { CALVER_REGEX, VERSION_FILE, parseCalver, compareCalver } = require('../scripts/calver');
const { run } = require('../scripts/sync-version');
const { parseArgs, nextVersion } = require('../scripts/release');

test('VERSION file exists and contains valid CalVer string', () => {
  assert.ok(fs.existsSync(VERSION_FILE), 'VERSION file must exist at repo root');
  const version = fs.readFileSync(VERSION_FILE, 'utf8').trim();
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

test('every target file matches VERSION', () => {
  const { hasDivergence, results } = run({ write: false });
  const diverged = results.filter(r => r.status !== 'synced');
  assert.equal(hasDivergence, false, `out of sync: ${JSON.stringify(diverged)}`);
});

test('the release minor resets when the month or year changes', () => {
  const august = new Date(2026, 7, 15); // month is 0-indexed
  assert.deepEqual(nextVersion({ year: 2026, month: 8, minor: 2 }, august), { year: 2026, month: 8, minor: 3 });
  assert.deepEqual(nextVersion({ year: 2026, month: 7, minor: 5 }, august), { year: 2026, month: 8, minor: 1 });
  assert.deepEqual(nextVersion({ year: 2025, month: 12, minor: 9 }, august), { year: 2026, month: 8, minor: 1 });
  assert.deepEqual(nextVersion(null, august), { year: 2026, month: 8, minor: 1 }, 'a first release starts at .1');
});

test('--version requires an operand instead of silently auto-bumping', () => {
  assert.throws(() => parseArgs(['--version']), /requires a version operand/);
  assert.throws(() => parseArgs(['-v']), /requires a version operand/);
  assert.throws(() => parseArgs(['--version=']), /requires a value/);
  assert.throws(() => parseArgs(['--version', '--force']), /requires a version operand/);
  assert.throws(() => parseArgs(['--nonsense']), /Unknown argument/);

  assert.deepEqual(parseArgs(['--version', '2026.8.5']), { customVersion: '2026.8.5', force: false });
  assert.deepEqual(parseArgs(['--version=2026.8.5']), { customVersion: '2026.8.5', force: false });
  assert.deepEqual(parseArgs(['--force']), { customVersion: null, force: true });
});

test('CalVer ordering detects a version that would move backwards', () => {
  const current = parseCalver('2026.8.2');
  assert.ok(compareCalver(parseCalver('2026.8.3'), current) > 0, 'a later minor is newer');
  assert.ok(compareCalver(parseCalver('2026.9.1'), current) > 0, 'a later month is newer');
  assert.ok(compareCalver(parseCalver('2026.8.1'), current) < 0, 'an earlier minor is older');
  assert.ok(compareCalver(parseCalver('2025.12.9'), current) < 0, 'an earlier year is older');
  assert.equal(compareCalver(parseCalver('2026.8.2'), current), 0, 'the same version is not newer');
});
