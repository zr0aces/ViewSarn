#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const CALVER_REGEX = /^(?<year>2\d{3})\.(?<month>[1-9]|1[0-2])\.(?<minor>\d+)$/;

const args = process.argv.slice(2);
const isCheckMode = args.includes('--check');
const isHelp = args.includes('--help') || args.includes('-h');

if (isHelp) {
  console.log(`Usage: node scripts/sync-version.mjs [options]

Options:
  --check      Validate that all target files match VERSION without writing changes
  -h, --help   Show this help message
`);
  process.exit(0);
}

// 1. Read and validate root VERSION file
const versionFilePath = path.join(rootDir, 'VERSION');
if (!fs.existsSync(versionFilePath)) {
  console.error(`ERROR: VERSION file not found at ${versionFilePath}`);
  process.exit(1);
}

const version = fs.readFileSync(versionFilePath, 'utf8').trim();
const match = version.match(CALVER_REGEX);
if (!match) {
  console.error(`ERROR: VERSION "${version}" does not match CalVer format YYYY.M.MINOR (e.g. 2026.8.1)`);
  process.exit(1);
}

const { year, month, minor } = match.groups;

const targets = [
  {
    name: 'package.json',
    file: path.join(rootDir, 'package.json'),
    check: (content) => {
      try {
        const pkg = JSON.parse(content);
        if (pkg.version !== version) {
          return `expected version "${version}", found "${pkg.version}"`;
        }
        return null;
      } catch (err) {
        return `invalid JSON: ${err.message}`;
      }
    },
    sync: (content) => {
      const pkg = JSON.parse(content);
      pkg.version = version;
      return JSON.stringify(pkg, null, 2) + '\n';
    }
  },
  {
    name: 'README.md',
    file: path.join(rootDir, 'README.md'),
    pattern: /\*\*Version:\*\* `\d{4}\.(?:[1-9]|1[0-2])\.\d+` \(CalVer\)/,
    expectedString: `**Version:** \`${version}\` (CalVer)`,
    check: function (content) {
      if (!content.includes(this.expectedString)) {
        const match = content.match(this.pattern);
        if (match) {
          return `expected "${this.expectedString}", found "${match[0]}"`;
        }
        return `missing version pattern: "${this.expectedString}"`;
      }
      return null;
    },
    sync: function (content) {
      if (this.pattern.test(content)) {
        return content.replace(this.pattern, this.expectedString);
      }
      // If pattern not present yet, insert under the subheadline
      const headerTarget = '**The Elite HTML-to-PDF/PNG Conversion Engine**\n';
      if (content.includes(headerTarget)) {
        return content.replace(
          headerTarget,
          `${headerTarget}\n${this.expectedString}\n`
        );
      }
      return `${this.expectedString}\n\n` + content;
    }
  },
  {
    name: 'documents/deployment.md',
    file: path.join(rootDir, 'documents', 'deployment.md'),
    check: (content) => {
      const issues = [];
      const dockerSpecific = `docker pull ghcr.io/zr0aces/viewsarn:${version}`;
      const tagSpecific = `- \`${version}\` - Specific version (CalVer YYYY.M.MINOR)`;
      const tagYearMonth = `- \`${year}.${month}\` - Year.month tag (YYYY.M)`;
      const tagYear = `- \`${year}\` - Year tag (YYYY)`;
      const gitTagExpected = `(e.g., \`v${version}\`)`;

      if (!content.includes(dockerSpecific)) {
        issues.push(`missing "${dockerSpecific}"`);
      }
      if (!content.includes(tagSpecific)) {
        issues.push(`missing "${tagSpecific}"`);
      }
      if (!content.includes(tagYearMonth)) {
        issues.push(`missing "${tagYearMonth}"`);
      }
      if (!content.includes(tagYear)) {
        issues.push(`missing "${tagYear}"`);
      }
      if (!content.includes(gitTagExpected)) {
        issues.push(`missing "${gitTagExpected}"`);
      }

      return issues.length > 0 ? issues.join(', ') : null;
    },
    sync: (content) => {
      let updated = content;
      updated = updated.replace(
        /(\*\*Pull the latest image:\*\*\s*```bash\s*docker pull ghcr\.io\/zr0aces\/viewsarn:)\S+/g,
        '$1latest'
      );
      updated = updated.replace(
        /(\*\*Pull a specific version:\*\*\s*```bash\s*docker pull ghcr\.io\/zr0aces\/viewsarn:)\S+/g,
        `$1${version}`
      );
      updated = updated.replace(
        /- `[^`]+` - Specific version \([^)]+\)/g,
        `- \`${version}\` - Specific version (CalVer YYYY.M.MINOR)`
      );
      updated = updated.replace(
        /- `[^`]+` - (?:Major\.minor version|Year\.month tag \(YYYY\.M\))/g,
        `- \`${year}.${month}\` - Year.month tag (YYYY.M)`
      );
      updated = updated.replace(
        /- `[^`]+` - (?:Major version only|Year tag \(YYYY\))/g,
        `- \`${year}\` - Year tag (YYYY)`
      );
      updated = updated.replace(
        /\(e\.g\., `v[^`]+`\)/g,
        `(e.g., \`v${version}\`)`
      );
      return updated;
    }
  }
];

let hasDivergence = false;
const results = [];

for (const target of targets) {
  if (!fs.existsSync(target.file)) {
    const errorMsg = `File not found: ${target.name}`;
    results.push({ name: target.name, status: 'missing', detail: errorMsg });
    hasDivergence = true;
    continue;
  }

  const content = fs.readFileSync(target.file, 'utf8');

  if (isCheckMode) {
    const divergence = target.check(content);
    if (divergence) {
      hasDivergence = true;
      results.push({ name: target.name, status: 'diverged', detail: divergence });
    } else {
      results.push({ name: target.name, status: 'synced' });
    }
  } else {
    const divergence = target.check(content);
    if (divergence) {
      const newContent = target.sync(content);
      fs.writeFileSync(target.file, newContent, 'utf8');
      results.push({ name: target.name, status: 'updated', detail: divergence });
    } else {
      results.push({ name: target.name, status: 'unchanged' });
    }
  }
}

if (isCheckMode) {
  if (hasDivergence) {
    console.error(`❌ Version check failed against VERSION (${version}):`);
    for (const r of results) {
      if (r.status !== 'synced') {
        console.error(`  - ${r.name}: ${r.detail}`);
      }
    }
    process.exit(1);
  } else {
    console.log(`✅ All target files match VERSION (${version}).`);
    process.exit(0);
  }
} else {
  console.log(`Synced version (${version}) to target files:`);
  for (const r of results) {
    console.log(`  - ${r.name}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`);
  }
}
