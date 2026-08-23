const PAPER_FORMATS = new Set(['A4', 'A5', 'LETTER', 'LEGAL']);
const ORIENTATIONS = new Set(['portrait', 'landscape']);
const WAIT_UNTIL = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);
const MARGIN_PATTERN = /^\d+(\.\d+)?(mm|cm|in)?$/;

// Returns an error string, or null when the options are usable. Rejecting here
// beats silently coercing: a typo in `format` used to fall back to A4 and hand
// back a plausible-looking wrong-sized document.
function validateOptions(options) {
    if (options === undefined || options === null) return null;
    if (typeof options !== 'object' || Array.isArray(options)) return '"options" must be an object';

    const { format, orientation, margin, dpi, scale, filename, waitUntil } = options;

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
    if (filename !== undefined && filename !== null) {
        if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
            return '"options.filename" must be a string without path separators';
        }
    }
    return null;
}

module.exports = { validateOptions, PAPER_FORMATS, ORIENTATIONS, WAIT_UNTIL };
