const PAPER_SIZES = {
    A4: { w: 210, h: 297 },
    A5: { w: 148, h: 210 },
    LETTER: { w: 216, h: 279 },
    LEGAL: { w: 216, h: 356 }
};
const PX_PER_MM = 96 / 25.4;

// A margin is a number (mm) or a string like "10mm", "1cm", "0.5in". The scale
// maths and page.pdf must see the same value, so everything goes through here.
function parseMarginToMm(m) {
    if (!m) return 0;
    if (typeof m === 'number') return m;
    if (m.endsWith('mm')) return parseFloat(m.slice(0, -2));
    if (m.endsWith('cm')) return parseFloat(m.slice(0, -2)) * 10;
    if (m.endsWith('in')) return parseFloat(m.slice(0, -2)) * 25.4;
    return parseFloat(m);
}

module.exports = { PAPER_SIZES, PX_PER_MM, parseMarginToMm };
