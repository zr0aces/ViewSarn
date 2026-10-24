# Plan 04: Request hardening

Fixes F-08, F-10, F-12, F-14. Depends on plans 01 and 02 (uses `req.principal.label`).

## Current state (verified)

- `server.js:159, 176`: `filename` goes straight into `Content-Disposition`. `validate.js:33-37` already rejects non-strings, `/`, `\`, NUL (R7).
- `server.js:128-129`: `saveToDisk = !!body.save` (so `"false"` saves), `outPathRel = body.outPath || null` (R6). Neither is checked by `validateOptions`.
- `server.js:163-170`: regex strip of leading `../`, `path.join`, `writeFile`. No ownership, no `wx`, no quota. Response `path` is absolute.
- `render.js:150` and `render.js:174-179`: `parseMarginToMm` reads a number as mm; `page.pdf` receives the raw value (pixels for numbers and unit-less strings). `png` and `single` are never validated.
- `server.js:149-156`: success metric and log run before the response is written.
- No catch-all 404; `src/httpErrors.js:9-11` labels every parser error "Malformed JSON body".

## Steps

### 1. Body and option validation (F-12, R6, R7)

`src/validate.js`:
- `png`, `single`: `typeof === 'boolean'` or error `"options.png" must be a boolean`.
- `filename`: also reject `"`, control characters `/[\x00-\x1f\x7f]/`, length over 200.
- New `validateBody(body)` returns an error string or null: `save` must be boolean or undefined; `outPath` must be a non-empty string when present, at most 512 characters, no NUL. Call it in the handler before `validateOptions`.
- Margin sum: with `format` and `orientation` (defaulting to A4 portrait), reject when `2 * marginMm >= min(paperWidthMm, paperHeightMm)`. Export `PAPER_SIZES` and `parseMarginToMm` from a shared place (`src/paper.js`) so `validate.js` and `render.js` use one copy.

`src/render.js`: normalise the margin once. `const marginMm = parseMarginToMm(opts.margin ?? '10mm')`; pass `` `${marginMm}mm` `` to `page.pdf`. This removes the mm vs px mismatch for numbers and unit-less strings.

Tests (`test/validate.test.js`): `png: "false"` rejected; `save: "false"` rejected; `outPath: {a:1}` rejected; filename with `"`, CR, LF rejected; margin 200mm on A4 rejected. Render test (stub page) that `page.pdf` receives `"10mm"` for `margin: 10`.

Commit: `fix(validate): validate png, single, save, outPath, margin bounds`.

### 2. Content-Disposition (F-08)

Add `contentDisposition(filename)` in `src/validate.js` (or `src/http.js`):

```js
function contentDisposition(name) {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
```
Use it at `server.js:176`. Unit tests: Thai name, name with spaces, name with `'` and `*`, pure ASCII (both parameters present, ASCII one unchanged).

In `src/app.js` move `metrics.renders += 1` and the "Convert request completed" log into `res.on('finish', ...)` registered before sending; the existing `res.on('close')` abort guard is unaffected.

Tests: remove the F-08 `todo`; `filename: "รายงาน.pdf"` returns 200 and a header that matches `filename\*=UTF-8''%E0%B8%A3`. A header failure no longer increments `renders`.

Commit: `fix(http): RFC 6266 Content-Disposition, count success after write`.

### 3. Save module (F-10)

New `src/save.js`:

```js
async function saveBuffer({ root, label, outPath, defaultName, buffer, maxBytes }) {
    const base = path.resolve(root, label);
    await fs.mkdir(base, { recursive: true });
    const rel = outPath ? outPath.replace(/^[/\\]+/, '') : defaultName;
    const target = path.resolve(base, rel);
    if (!target.startsWith(base + path.sep)) throw httpError(400, 'outPath must stay inside the output directory');
    const realBase = await fs.realpath(base);
    // Check the deepest existing ancestor BEFORE mkdir -p, so a symlink inside base cannot make us create directories outside it.
    const realParent = await fs.realpath(await nearestExisting(path.dirname(target)));
    if (realParent !== realBase && !realParent.startsWith(realBase + path.sep)) throw httpError(400, 'outPath must stay inside the output directory');
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (maxBytes && (await dirSize(base)) + buffer.length > maxBytes) throw httpError(507, 'Output quota exceeded');
    await fs.writeFile(target, buffer);   // overwrite inside the caller's own directory, as before
    return { path: path.relative(root, target), filename: path.basename(target) };
}
```
`defaultName` is `options.filename` when given (it already carries its extension, as today), else `` `output-${crypto.randomUUID()}.${ext}` `` (never `Date.now()`). Do not use `wx`: a repeated `filename` used to overwrite, and `EEXIST` would surface as a 500. `nearestExisting(p)` walks up from `p` until `fs.stat` succeeds. `dirSize` sums `fs.stat` over `readdir({recursive:true})` of the caller's directory; cache the total per label for 5 s and add each written size to it, so a save does not rescan thousands of files. Config: `OUTPUT_MAX_BYTES` (default 0 = off).

The handler calls `saveBuffer` with `label = req.principal.label`, returns `{ path, filename, size, scale, contentSize, paper, orientation }` (relative path).

Tests (`test/save.test.js`, temp dir): `../../x.pdf`, absolute `/etc/x.pdf`, symlink inside the label dir pointing out (create with `fs.symlink`), two labels with the same `outPath` land in different files, default names never collide in 1000 calls, quota returns 507, a repeated `filename` or `outPath` overwrites inside the same label directory and returns 200 both times, a symlink escape creates no directory outside the base.

Commit: `fix(save)!: contain, namespace and cap saved output`. Update `CLAUDE.md` (the "keep that normalization" paragraph describing the regex strip), spec requirements for `save`, and `documents/api_docs.md` (response shape).

### 4. Error contract (F-14)

`src/app.js`, after the routes:

```js
app.use((req, res) => res.status(404).json({ error: 'Not found', request_id: req.requestId }));
app.use((err, req, res, next) => { /* log, then 500 JSON generic */ });
```
`src/httpErrors.js`: map `err.type`: `entity.parse.failed` → 400 "Malformed JSON body"; `entity.too.large` → 413 (existing); `charset.unsupported`, `encoding.unsupported` → 415 with a specific message; anything else → generic 400. Tests for each type (send `Content-Type: application/json; charset=utf-16` and `Content-Encoding: br`). Remove the F-14 `todo`.

Commit: `fix(http): JSON 404 and accurate body-parser errors`.

### 5. Client scripts

`convert-cli.sh` and `test-convert.js` must send booleans for `png`/`single` (plan 07 rewrites the CLI body). Grep both for string values now.

## Acceptance

- Thai filename → 200 with a valid header; `png: "false"` → 400; object `outPath` → 400.
- Traversal, absolute path, and symlink escape are blocked.
- Two keys saving to the same `outPath` write different files; response path is relative.
- `GET /nope` → JSON 404.
- `npm test` passes.

## Risks and rollback

- API-visible (decision 4): clients that read saved files by old absolute path break; stricter `png`/`single` rejects string values. Release note.
- Visible output change: a numeric `margin` (or unit-less string) was applied as pixels by `page.pdf` but as mm by the scale maths. After step 1 it is real mm, so a caller that sends `margin: 10` now gets about 10 mm instead of about 2.6 mm and the layout shifts. Release note.
- Revert per commit.

## EXECUTE notes (2026-10-24, recorded 2026-10-25)

- Every acceptance item has a test: Thai filename, `png: "false"` and object `outPath` in `test/app.test.js` and `test/validate.test.js`; traversal, absolute path, symlink escape, per-key directories and relative paths in `test/save.test.js`; JSON 404 in `test/app.test.js`. Thai filename and `save` were also checked against the image.
- Step 2 specified `parseMarginToMm(opts.margin ?? '10mm')`, but the code kept `||`, so `margin: 0` still became 10mm. The code review of PR #5 caught it; fixed, with a test in `test/browserLifecycle.test.js`.
