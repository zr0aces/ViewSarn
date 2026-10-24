const fs = require('fs').promises;
const path = require('path');

const SIZE_CACHE_MS = 5000;
// label -> { bytes, at }. Rescanning a directory of thousands of files on every
// save would make the quota check the slowest part of the request.
const sizes = new Map();

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

async function dirSize(dir) {
    let total = 0;
    for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) total += (await fs.stat(path.join(entry.parentPath, entry.name))).size;
    }
    return total;
}

async function usedBytes(label, base) {
    const cached = sizes.get(label);
    if (cached && Date.now() - cached.at < SIZE_CACHE_MS) return cached.bytes;
    const bytes = await dirSize(base);
    sizes.set(label, { bytes, at: Date.now() });
    return bytes;
}

// Walks up to the first directory that exists, so the symlink check can run
// before mkdir -p creates anything.
async function nearestExisting(dir) {
    for (let current = dir; ; current = path.dirname(current)) {
        try { await fs.stat(current); return current; } catch (e) { if (current === path.dirname(current)) throw e; }
    }
}

// Writes into <root>/<label>/. Each caller gets its own directory, so one key can
// never overwrite another's files. Anything that resolves outside it is a 400,
// not a silent rewrite.
async function saveBuffer({ root, label, outPath, defaultName, buffer, maxBytes = 0 }) {
    const base = path.resolve(root, label);
    await fs.mkdir(base, { recursive: true });

    // A leading slash used to be tolerated by joining under the root; keep that.
    const target = path.resolve(base, outPath ? outPath.replace(/^[/\\]+/, '') : defaultName);
    const escape = () => httpError(400, 'outPath must stay inside the output directory');
    if (!target.startsWith(base + path.sep)) throw escape();

    // Check the deepest existing ancestor BEFORE creating directories, so a symlink
    // inside the base cannot make us create directories outside it.
    const realBase = await fs.realpath(base);
    const realParent = await fs.realpath(await nearestExisting(path.dirname(target)));
    if (realParent !== realBase && !realParent.startsWith(realBase + path.sep)) throw escape();

    if (maxBytes && (await usedBytes(label, base)) + buffer.length > maxBytes) {
        throw httpError(507, 'Output quota exceeded for this key');
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);   // overwrite inside the caller's own directory, as before
    const cached = sizes.get(label);
    if (cached) cached.bytes += buffer.length;

    return { path: path.relative(root, target), filename: path.basename(target) };
}

module.exports = { saveBuffer, _resetSizeCache: () => sizes.clear() };
