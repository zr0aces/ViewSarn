#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const CALVER_REGEX = /^(?<year>2\d{3})\.(?<month>[1-9]|1[0-2])\.(?<minor>\d+)$/;

const args = process.argv.slice(2);

// Handle help
if (args.includes('-h') || args.includes('--help')) {
  console.log(`Usage: node scripts/release.mjs [options]

Owns CalVer (YYYY.M.MINOR) version increments and triggers sync.

Options:
  -v, --version <version>  Manually specify release version (CalVer: YYYY.M.MINOR)
  -h, --help               Show this help message
`);
  process.exit(0);
}

// 1. Check for manual version override
let customVersion = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-v' || args[i] === '--version') {
    customVersion = args[i + 1];
    i++;
  } else if (args[i].startsWith('--version=')) {
    customVersion = args[i].split('=')[1];
  }
}

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1; // 1-12, no leading zero

let newVersion = '';

if (customVersion) {
  const match = customVersion.match(CALVER_REGEX);
  if (!match) {
    console.error(`ERROR: Provided version "${customVersion}" does not match CalVer format YYYY.M.MINOR (e.g. 2026.8.1)`);
    process.exit(1);
  }
  newVersion = customVersion;
} else {
  // 2. Read old version from VERSION, falling back to package.json, falling back to current date
  const versionFilePath = path.join(rootDir, 'VERSION');
  const pkgFilePath = path.join(rootDir, 'package.json');

  let oldVersion = '';
  if (fs.existsSync(versionFilePath)) {
    oldVersion = fs.readFileSync(versionFilePath, 'utf8').trim();
  } else if (fs.existsSync(pkgFilePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFilePath, 'utf8'));
      oldVersion = pkg.version || '';
    } catch {
      oldVersion = '';
    }
  }

  const oldMatch = oldVersion.match(CALVER_REGEX);
  if (oldMatch) {
    const oldYear = parseInt(oldMatch.groups.year, 10);
    const oldMonth = parseInt(oldMatch.groups.month, 10);
    const oldMinor = parseInt(oldMatch.groups.minor, 10);

    if (oldYear === currentYear && oldMonth === currentMonth) {
      newVersion = `${currentYear}.${currentMonth}.${oldMinor + 1}`;
    } else {
      newVersion = `${currentYear}.${currentMonth}.1`;
    }
  } else {
    // No prior CalVer found — start at .1 for current year/month
    newVersion = `${currentYear}.${currentMonth}.1`;
  }
}

// 3. Validate new version
if (!CALVER_REGEX.test(newVersion)) {
  console.error(`ERROR: Computed version "${newVersion}" is not a valid CalVer.`);
  process.exit(1);
}

// 4. Write to VERSION file
const versionFilePath = path.join(rootDir, 'VERSION');
fs.writeFileSync(versionFilePath, `${newVersion}\n`, 'utf8');
console.log(`Updated VERSION -> ${newVersion}`);

// 5. Run sync-version.mjs to propagate version to target files
const syncScriptPath = path.join(__dirname, 'sync-version.mjs');
try {
  execSync(`node "${syncScriptPath}"`, { stdio: 'inherit' });
} catch (err) {
  console.error(`ERROR: Failed to run sync-version.mjs: ${err.message}`);
  process.exit(1);
}

// 6. Print finishing git commands (deliberately stopping short of auto-running)
console.log(`\n🎉 Release v${newVersion} prepared!`);
console.log(`\nNext steps (review and execute when ready):`);
console.log(`  git add VERSION package.json README.md documents/deployment.md`);
console.log(`  git commit -m "chore: release v${newVersion}"`);
console.log(`  git tag -a "v${newVersion}" -m "Release v${newVersion}"`);
console.log(`  git push origin main --tags\n`);
