#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Generate cryptographically secure API key
function generateKey({ bytes = 32, prefix = '', format = 'hex' } = {}) {
  const buf = crypto.randomBytes(bytes);
  const token = format === 'base64url' ? buf.toString('base64url') : buf.toString('hex');
  return prefix ? `${prefix}${token}` : token;
}

// Compute principal matching ViewSarn's src/auth.js:
// id is the full sha256 digest, label is the first 12 hex chars used in logs and directories.
function principalFor(key) {
  const hex = crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');
  return { id: `k:${hex}`, label: hex.slice(0, 12) };
}

// Write or append keys to the specified file with safe permissions (0600)
function writeKeysToFile(filePath, keysInfo, { overwrite = false } = {}) {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fileExists = fs.existsSync(resolved);
  let content = '';

  if (overwrite || !fileExists) {
    content = [
      '# ViewSarn API keys file',
      '# One key per line. Lines starting with # are ignored.',
      '',
    ].join('\n');
  } else {
    const existing = fs.readFileSync(resolved, 'utf8');
    if (existing.length > 0 && !existing.endsWith('\n')) {
      content += '\n';
    }
  }

  for (let i = 0; i < keysInfo.length; i++) {
    const item = keysInfo[i];
    const indexSuffix = keysInfo.length > 1 ? ` [${i + 1}/${keysInfo.length}]` : '';
    const commentText = item.comment
      ? `# ${item.comment}${indexSuffix} (created ${item.createdAt}, label ${item.label})`
      : `# Generated ${item.createdAt}${indexSuffix} (label ${item.label})`;
    content += `${commentText}\n${item.key}\n`;
  }

  if (overwrite || !fileExists) {
    fs.writeFileSync(resolved, content, { encoding: 'utf8', mode: 0o600 });
  } else {
    fs.appendFileSync(resolved, content, { encoding: 'utf8' });
  }

  try {
    fs.chmodSync(resolved, 0o600);
  } catch {
    // Non-POSIX or restricted file systems may ignore chmod
  }
}

function parseArgs(argv) {
  const options = {
    count: 1,
    file: null,
    comment: null,
    prefix: '',
    format: 'hex',
    bytes: 32,
    overwrite: false,
    raw: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-q' || arg === '--raw' || arg === '--quiet') {
      options.raw = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (arg === '-f' || arg === '--file') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        options.file = next;
        i++;
      } else {
        options.file = process.env.API_KEYS_FILE || 'apikeys.txt';
      }
    } else if (arg.startsWith('--file=')) {
      options.file = arg.slice(7);
    } else if (arg.startsWith('-f=')) {
      options.file = arg.slice(3);
    } else if (arg === '-n' || arg === '--count') {
      const val = argv[++i];
      if (val === undefined) throw new Error(`${arg} requires a number argument`);
      options.count = Number(val);
    } else if (arg.startsWith('--count=')) {
      options.count = Number(arg.slice(8));
    } else if (arg.startsWith('-n=')) {
      options.count = Number(arg.slice(3));
    } else if (arg === '-c' || arg === '--comment') {
      const val = argv[++i];
      if (val === undefined) throw new Error(`${arg} requires a comment string`);
      options.comment = val;
    } else if (arg.startsWith('--comment=')) {
      options.comment = arg.slice(10);
    } else if (arg.startsWith('-c=')) {
      options.comment = arg.slice(3);
    } else if (arg === '-p' || arg === '--prefix') {
      const val = argv[++i];
      if (val === undefined) throw new Error(`${arg} requires a prefix string`);
      options.prefix = val;
    } else if (arg.startsWith('--prefix=')) {
      options.prefix = arg.slice(9);
    } else if (arg.startsWith('-p=')) {
      options.prefix = arg.slice(3);
    } else if (arg === '--format') {
      const val = argv[++i];
      if (val === undefined) throw new Error(`${arg} requires a format string`);
      options.format = val;
    } else if (arg.startsWith('--format=')) {
      options.format = arg.slice(9);
    } else if (arg === '--bytes') {
      const val = argv[++i];
      if (val === undefined) throw new Error(`${arg} requires a number argument`);
      options.bytes = Number(val);
    } else if (arg.startsWith('--bytes=')) {
      options.bytes = Number(arg.slice(8));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.help) return options;

  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 10000) {
    throw new Error('Count must be an integer between 1 and 10000');
  }

  if (!Number.isInteger(options.bytes) || options.bytes < 16 || options.bytes > 1024) {
    throw new Error('Bytes must be an integer between 16 and 1024');
  }

  if (options.format !== 'hex' && options.format !== 'base64url') {
    throw new Error(`Invalid format "${options.format}". Allowed formats: hex, base64url`);
  }

  if (options.prefix && !/^[a-zA-Z0-9_-]+$/.test(options.prefix)) {
    throw new Error('Prefix may only contain alphanumeric characters, underscores, and hyphens');
  }

  if (options.comment) {
    options.comment = options.comment.replace(/[\r\n]+/g, ' ').trim();
  }

  return options;
}

function showHelp(out) {
  out.write(`ViewSarn API Key Generator

Usage:
  node scripts/generate-apikey.js [options]
  ./scripts/generate-apikey.sh [options]

Options:
  -f, --file [PATH]       Append/write key(s) to keys file (default: apikeys.txt)
  -n, --count NUM         Number of keys to generate (default: 1)
  -c, --comment TEXT      Add a descriptive comment above the key in the file
  -p, --prefix STRING     Key prefix (e.g. "vs_", "api_")
      --format FORMAT     Key encoding: 'hex' (default, 32 bytes = 64 chars) or 'base64url'
      --bytes NUM         Entropy bytes to generate (default: 32, minimum: 16)
      --overwrite         Overwrite the target file instead of appending
  -q, --raw, --quiet      Output raw key(s) only (one per line, ideal for scripts)
      --json              Output structured JSON (key, id, label)
  -h, --help              Show this help message

Examples:
  # Generate a single secure key with principal info:
  node scripts/generate-apikey.js

  # Generate a raw key for scripting:
  export API_KEY=$(node scripts/generate-apikey.js -q)

  # Generate and append directly to apikeys.txt with comment:
  node scripts/generate-apikey.js -f apikeys.txt -c "billing-service"

  # Generate 3 prefixed keys as JSON:
  node scripts/generate-apikey.js -n 3 --prefix "vs_" --json
`);
}

function main(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    io.stderr.write(`Error: ${err.message}\nRun with --help for usage.\n`);
    return 2;
  }

  if (options.help) {
    showHelp(io.stdout);
    return 0;
  }

  const now = new Date().toISOString();
  const keys = [];

  for (let i = 0; i < options.count; i++) {
    const key = generateKey({
      bytes: options.bytes,
      prefix: options.prefix,
      format: options.format,
    });
    const principal = principalFor(key);
    keys.push({
      key,
      id: principal.id,
      label: principal.label,
      comment: options.comment,
      createdAt: now,
    });
  }

  if (options.file) {
    try {
      writeKeysToFile(options.file, keys, { overwrite: options.overwrite });
    } catch (err) {
      io.stderr.write(`Error writing to file ${options.file}: ${err.message}\n`);
      return 1;
    }
  }

  if (options.raw) {
    for (const item of keys) {
      io.stdout.write(`${item.key}\n`);
    }
    return 0;
  }

  if (options.json) {
    io.stdout.write(JSON.stringify(keys, null, 2) + '\n');
    return 0;
  }

  const countStr = keys.length === 1 ? '1 API key' : `${keys.length} API keys`;
  if (options.file) {
    io.stdout.write(`Generated ${countStr} and ${options.overwrite ? 'overwrote' : 'appended to'} ${options.file}:\n\n`);
  } else {
    io.stdout.write(`Generated ${countStr}:\n\n`);
  }

  for (const item of keys) {
    io.stdout.write(`  Key:       ${item.key}\n`);
    io.stdout.write(`  Label:     ${item.label} (matches server logs and directory names)\n`);
    io.stdout.write(`  Principal: ${item.id}\n\n`);
  }

  if (options.file) {
    io.stdout.write('File permissions set to 0600 (owner read/write only).\n');
  } else {
    io.stdout.write('Tip: Use -f apikeys.txt to save to keys file, or -q / --raw for scripts.\n');
  }

  return 0;
}

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exitCode = code;
}

module.exports = {
  generateKey,
  principalFor,
  writeKeysToFile,
  parseArgs,
  showHelp,
  main,
};
