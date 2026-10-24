const { PAPER_SIZES, parseMarginToMm, paperFor } = require('./paper');

const PAPER_FORMATS = new Set(Object.keys(PAPER_SIZES));
const ORIENTATIONS = new Set(['portrait', 'landscape']);
const WAIT_UNTIL = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);
const MARGIN_PATTERN = /^\d+(\.\d+)?(mm|cm|in)?$/;

// Returns an error string, or null when the options are usable. Rejecting here
// beats silently coercing: a typo in `format` used to fall back to A4 and hand
// back a plausible-looking wrong-sized document.
function validateOptions(options) {
    if (options === undefined || options === null) return null;
    if (typeof options !== 'object' || Array.isArray(options)) return '"options" must be an object';

    const { format, orientation, margin, dpi, scale, filename, waitUntil, png, single } = options;

    if (format !== undefined && !(typeof format === 'string' && PAPER_FORMATS.has(format.toUpperCase()))) {
        return `"options.format" must be one of ${[...PAPER_FORMATS].join(', ')}`;
    }
    if (orientation !== undefined && !ORIENTATIONS.has(orientation)) {
        return '"options.orientation" must be "portrait" or "landscape"';
    }
    if (waitUntil !== undefined && !WAIT_UNTIL.has(waitUntil)) {
        return `"options.waitUntil" must be one of ${[...WAIT_UNTIL].join(', ')}`;
    }
    if (margin !== undefined && !(typeof margin === 'number' ? margin >= 0 : MARGIN_PATTERN.test(String(margin)))) {
        return '"options.margin" must be a number or a string like "10mm", "1cm", "0.5in"';
    }
    if (dpi !== undefined && !(Number.isFinite(Number(dpi)) && Number(dpi) > 0 && Number(dpi) <= 600)) {
        return '"options.dpi" must be a number between 1 and 600';
    }
    if (scale !== undefined && scale !== null && !(Number.isFinite(Number(scale)) && Number(scale) >= 0.1 && Number(scale) <= 2)) {
        return '"options.scale" must be a number between 0.1 and 2, or null';
    }
    if (png !== undefined && typeof png !== 'boolean') return '"options.png" must be a boolean';
    if (single !== undefined && typeof single !== 'boolean') return '"options.single" must be a boolean';
    if (filename !== undefined && filename !== null) {
        if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
            return '"options.filename" must be a string without path separators';
        }
        // Control characters would split the Content-Disposition header, and a quote
        // would end its filename parameter early.
        if (/[\x00-\x1f\x7f"]/.test(filename) || filename.length > 200) {
            return '"options.filename" must be at most 200 characters, without quotes or control characters';
        }
    }
    // A margin that leaves no printable area makes page.pdf fail with a 500, so
    // reject it here, against the paper the request will actually use.
    if (margin !== undefined) {
        const paper = paperFor(format);
        if (2 * parseMarginToMm(margin) >= Math.min(paper.w, paper.h)) {
            return '"options.margin" leaves no printable area on this paper size';
        }
    }
    return null;
}

// Fields that sit beside `options` in the request body.
function validateBody(body) {
    const { save, outPath } = body;
    if (save !== undefined && typeof save !== 'boolean') return '"save" must be a boolean';
    if (outPath !== undefined && outPath !== null) {
        if (typeof outPath !== 'string' || outPath.length === 0 || outPath.length > 512 || outPath.includes('\0')) {
            return '"outPath" must be a non-empty string of at most 512 characters';
        }
    }
    return null;
}

module.exports = { validateOptions, validateBody, WAIT_UNTIL };
