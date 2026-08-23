#!/usr/bin/env node
// Owns CalVer (YYYY.M.MINOR) increments, then hands off to sync-version.
const fs = require('fs');
const { CALVER_REGEX, VERSION_FILE, parseCalver, formatCalver, compareCalver } = require('./calver');
const sync = require('./sync-version');

const HELP = `Usage: node scripts/release.js [options]

Owns CalVer (YYYY.M.MINOR) version increments and triggers sync.

Options:
  -v, --version <version>  Release this exact version (CalVer: YYYY.M.MINOR)
  --force                  Allow a version older than the current VERSION
  -h, --help               Show this help message
`;

// Returns { customVersion, force } or throws on a malformed flag.
function parseArgs(args) {
  let customVersion = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--force') {
      force = true;
    } else if (arg === '-v' || arg === '--version') {
      // Without this guard the operand is undefined, the override is silently
      // dropped, and the run auto-bumps instead — a release nobody asked for.
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`${arg} requires a version operand, e.g. ${arg} 2026.8.5`);
      }
      customVersion = value;
      i++;
    } else if (arg.startsWith('--version=')) {
      const value = arg.slice('--version='.length);
      if (!value) throw new Error('--version= requires a value, e.g. --version=2026.8.5');
      customVersion = value;
    } else {
      throw new Error(`Unknown argument "${arg}"`);
    }
  }

  return { customVersion, force };
}

// VERSION is the source of truth. When it is absent this is a first release, so
// start the current month at .1 — deliberately *not* reading package.json,
// which is a derived file and would make the source of truth ambiguous.
function readCurrentVersion() {
  if (!fs.existsSync(VERSION_FILE)) return null;
  const raw = fs.readFileSync(VERSION_FILE, 'utf8').trim();
  const parsed = parseCalver(raw);
  if (!parsed) throw new Error(`VERSION "${raw}" does not match CalVer format YYYY.M.MINOR (e.g. 2026.8.1)`);
  return parsed;
}

function nextVersion(current, now) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (current && current.year === year && current.month === month) {
    return { year, month, minor: current.minor + 1 };
  }
  return { year, month, minor: 1 };
}

function main(args) {
  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    return 0;
  }

  let options;
  try {
    options = parseArgs(args);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    return 1;
  }

  let current;
  try {
    current = readCurrentVersion();
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    return 1;
  }

  let target;
  if (options.customVersion) {
    target = parseCalver(options.customVersion);
    if (!target) {
      console.error(`ERROR: Provided version "${options.customVersion}" does not match CalVer format YYYY.M.MINOR (e.g. 2026.8.1)`);
      return 1;
    }
  } else {
    target = nextVersion(current, new Date());
  }

  const newVersion = formatCalver(target);
  if (!CALVER_REGEX.test(newVersion)) {
    console.error(`ERROR: Computed version "${newVersion}" is not a valid CalVer.`);
    return 1;
  }

  // A pre-dated VERSION file or a clock-skewed machine would otherwise publish
  // a version older than the last release, without saying anything.
  if (current && compareCalver(target, current) <= 0 && !options.force) {
    console.error(
      `ERROR: "${newVersion}" is not newer than the current version "${formatCalver(current)}".\n` +
      `       Pass --force to release it anyway, or --version <newer> to pick another.`
    );
    return 1;
  }

  fs.writeFileSync(VERSION_FILE, `${newVersion}\n`, 'utf8');
  console.log(`Updated VERSION -> ${newVersion}`);

  // Called in-process: same module system, same directory, no reason to spawn.
  let outcome;
  try {
    outcome = sync.run({ write: true });
  } catch (err) {
    console.error(`ERROR: Failed to sync version to target files: ${err.message}`);
    return 1;
  }
  for (const r of outcome.results) {
    console.log(`  - ${r.name}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`);
  }

  console.log(`\n🎉 Release v${newVersion} prepared!`);
  console.log(`\nNext steps (review and execute when ready):`);
  console.log(`  git add VERSION package.json README.md documents/deployment.md`);
  console.log(`  git commit -m "chore: release v${newVersion}"`);
  console.log(`  git tag -a "v${newVersion}" -m "Release v${newVersion}"`);
  console.log(`  git push origin main --tags\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { parseArgs, nextVersion };
