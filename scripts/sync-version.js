#!/usr/bin/env node
// Propagates the root VERSION file into every file that repeats the version.
//
// check and sync run the *same* rules: a file is in sync exactly when applying
// the rules changes nothing. That equivalence is the point — a rule that sync
// writes but check forgets to assert cannot exist here.
const fs = require('fs');
const path = require('path');
const { CALVER_REGEX, ROOT_DIR, VERSION_FILE, parseCalver } = require('./calver');

function readVersion() {
  if (!fs.existsSync(VERSION_FILE)) {
    throw new Error(`VERSION file not found at ${VERSION_FILE}`);
  }
  const version = fs.readFileSync(VERSION_FILE, 'utf8').trim();
  if (!CALVER_REGEX.test(version)) {
    throw new Error(`VERSION "${version}" does not match CalVer format YYYY.M.MINOR (e.g. 2026.8.1)`);
  }
  return version;
}

function buildTargets(version) {
  const { year, month } = parseCalver(version);
  const readmeLine = `**Version:** \`${version}\` (CalVer)`;
  const readmePattern = /\*\*Version:\*\* `\d{4}\.(?:[1-9]|1[0-2])\.\d+` \(CalVer\)/;
  const readmeHeader = '**The Elite HTML-to-PDF/PNG Conversion Engine**\n';

  return [
    {
      name: 'package.json',
      file: path.join(ROOT_DIR, 'package.json'),
      rules: [
        {
          what: 'version field',
          apply: (content) => {
            const pkg = JSON.parse(content);
            pkg.version = version;
            return JSON.stringify(pkg, null, 2) + '\n';
          }
        }
      ]
    },
    {
      name: 'README.md',
      file: path.join(ROOT_DIR, 'README.md'),
      rules: [
        {
          what: 'version line',
          apply: (content) => {
            if (readmePattern.test(content)) return content.replace(readmePattern, readmeLine);
            if (content.includes(readmeHeader)) {
              return content.replace(readmeHeader, `${readmeHeader}\n${readmeLine}\n`);
            }
            return `${readmeLine}\n\n${content}`;
          }
        }
      ]
    },
    {
      name: 'documents/deployment.md',
      file: path.join(ROOT_DIR, 'documents', 'deployment.md'),
      rules: [
        {
          // The "latest" pull stays literally `latest`; sync used to rewrite it
          // while check never asserted it, so drift here went unnoticed.
          what: 'latest image tag',
          anchor: /\*\*Pull the latest image:\*\*/,
          apply: (content) => content.replace(
            /(\*\*Pull the latest image:\*\*\s*```bash\s*docker pull ghcr\.io\/zr0aces\/viewsarn:)\S+/g,
            '$1latest'
          )
        },
        {
          what: 'pinned image tag',
          anchor: /\*\*Pull a specific version:\*\*/,
          apply: (content) => content.replace(
            /(\*\*Pull a specific version:\*\*\s*```bash\s*docker pull ghcr\.io\/zr0aces\/viewsarn:)\S+/g,
            `$1${version}`
          )
        },
        {
          what: 'specific version tag',
          anchor: /- `[^`]+` - Specific version \([^)]+\)/,
          apply: (content) => content.replace(
            /- `[^`]+` - Specific version \([^)]+\)/g,
            `- \`${version}\` - Specific version (CalVer YYYY.M.MINOR)`
          )
        },
        {
          what: 'year.month tag',
          anchor: /- `[^`]+` - (?:Major\.minor version|Year\.month tag \(YYYY\.M\))/,
          apply: (content) => content.replace(
            /- `[^`]+` - (?:Major\.minor version|Year\.month tag \(YYYY\.M\))/g,
            `- \`${year}.${month}\` - Year.month tag (YYYY.M)`
          )
        },
        {
          what: 'year tag',
          anchor: /- `[^`]+` - (?:Major version only|Year tag \(YYYY\))/,
          apply: (content) => content.replace(
            /- `[^`]+` - (?:Major version only|Year tag \(YYYY\))/g,
            `- \`${year}\` - Year tag (YYYY)`
          )
        },
        {
          what: 'git tag example',
          anchor: /\(e\.g\., `v[^`]+`\)/,
          apply: (content) => content.replace(/\(e\.g\., `v[^`]+`\)/g, `(e.g., \`v${version}\`)`)
        }
      ]
    }
  ];
}

function applyRules(target, content) {
  let out = content;
  const changed = [];
  const missing = [];
  for (const rule of target.rules) {
    // A rule whose anchor has been reworded matches nothing, so its replace is a
    // silent no-op: the file then looks in sync while no longer carrying the
    // version at all. Report the missing anchor rather than passing green.
    if (rule.anchor && !rule.anchor.test(out)) {
      missing.push(rule.what);
      continue;
    }
    const next = rule.apply(out);
    if (next !== out) changed.push(rule.what);
    out = next;
  }
  return { content: out, changed, missing };
}

// write: false checks, true rewrites. Returns { version, results, hasDivergence }.
function run({ write }) {
  const version = readVersion();
  const results = [];
  let hasDivergence = false;

  for (const target of buildTargets(version)) {
    if (!fs.existsSync(target.file)) {
      results.push({ name: target.name, status: 'missing', detail: `File not found: ${target.name}` });
      hasDivergence = true;
      continue;
    }

    const original = fs.readFileSync(target.file, 'utf8');
    let applied;
    try {
      applied = applyRules(target, original);
    } catch (err) {
      results.push({ name: target.name, status: 'diverged', detail: `could not process: ${err.message}` });
      hasDivergence = true;
      continue;
    }

    if (applied.missing.length > 0) {
      hasDivergence = true;
      results.push({
        name: target.name,
        status: 'anchor-missing',
        detail: `cannot locate: ${applied.missing.join(', ')} — the surrounding text was reworded, so the version can no longer be placed`
      });
      continue;
    }

    if (applied.changed.length === 0) {
      results.push({ name: target.name, status: write ? 'unchanged' : 'synced' });
      continue;
    }

    hasDivergence = true;
    const detail = `out of sync: ${applied.changed.join(', ')}`;
    if (write) {
      fs.writeFileSync(target.file, applied.content, 'utf8');
      results.push({ name: target.name, status: 'updated', detail });
    } else {
      results.push({ name: target.name, status: 'diverged', detail });
    }
  }

  return { version, results, hasDivergence };
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Usage: node scripts/sync-version.js [options]

Options:
  --check      Validate that all target files match VERSION without writing changes
  -h, --help   Show this help message
`);
    return 0;
  }

  const check = argv.includes('--check');
  let outcome;
  try {
    outcome = run({ write: !check });
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    return 1;
  }

  if (check) {
    if (outcome.hasDivergence) {
      console.error(`❌ Version check failed against VERSION (${outcome.version}):`);
      for (const r of outcome.results) {
        if (r.status !== 'synced') console.error(`  - ${r.name}: ${r.detail}`);
      }
      return 1;
    }
    console.log(`✅ All target files match VERSION (${outcome.version}).`);
    return 0;
  }

  console.log(`Synced version (${outcome.version}) to target files:`);
  for (const r of outcome.results) {
    console.log(`  - ${r.name}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`);
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { run, readVersion, buildTargets };
