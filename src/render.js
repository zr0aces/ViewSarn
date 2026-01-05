const { chromium } = require('playwright');
const logger = require('./logger');

const PAPER_SIZES = new Set(['A4', 'A5', 'LETTER', 'LEGAL']);

let browser;

async function initBrowser() {
    if (!browser) {
        logger.info('Launching Playwright browser...');
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        logger.info('Browser launched.');
    }
    return browser;
}

async function closeBrowser() {
    if (browser) {
        logger.info('Closing Playwright browser...');
        await browser.close();
        browser = null;
        logger.info('Browser closed.');
    }
}

function parseMarginToMm(m) {
    if (!m) return 0;
    if (typeof m === 'number') return m;
    if (m.endsWith('mm')) return parseFloat(m.slice(0, -2));
    if (m.endsWith('cm')) return parseFloat(m.slice(0, -2)) * 10;
    if (m.endsWith('in')) return parseFloat(m.slice(0, -2)) * 25.4;
    return parseFloat(m);
}

function clampScale(s) {
    if (s === null || s === undefined) return null;
    if (isNaN(s)) return null;
    if (s < 0.1) return 0.1;
    if (s > 2) return 2;
    return s;
}

async function renderHtmlToBuffer(html, opts) {
    const b = await initBrowser();
    const isPng = !!opts.png;
    const dpi = opts.dpi && Number(opts.dpi) > 0 ? Number(opts.dpi) : 96;
    const contextOptions = {};
    if (isPng) {
        contextOptions.deviceScaleFactor = dpi / 96;
        contextOptions.viewport = { width: 1280, height: 800 };
    } else {
        contextOptions.viewport = null;
    }

    const context = await b.newContext(contextOptions);
    const page = await context.newPage();

    try {
        await page.setContent(html, { waitUntil: 'networkidle', timeout: 60_000 });
        await new Promise(r => setTimeout(r, 100));

        const contentSize = await page.evaluate(() => {
            const b = document.body; const h = document.documentElement;
            const width = Math.max(b.scrollWidth, b.offsetWidth, h.clientWidth, h.scrollWidth, h.offsetWidth);
            const height = Math.max(b.scrollHeight, b.offsetHeight, h.clientHeight, h.scrollHeight, h.offsetHeight);
            return { width, height };
        });

        const pxPerMm = 96 / 25.4;
        const paper = (opts.format || 'A4').toUpperCase();
        const paperMm = (paper === 'A5') ? { w: 148, h: 210 } :
            (paper === 'LETTER') ? { w: 216, h: 279 } :
                (paper === 'LEGAL') ? { w: 216, h: 356 } :
                    { w: 210, h: 297 };

        let paperWidthMm = paperMm.w, paperHeightMm = paperMm.h;
        if (opts.orientation === 'landscape') [paperWidthMm, paperHeightMm] = [paperHeightMm, paperWidthMm];

        const marginMm = parseMarginToMm(opts.margin || '10mm') || 0;
        const availableWidthPx = Math.max(1, (paperWidthMm - 2 * marginMm) * pxPerMm);
        const availableHeightPx = Math.max(1, (paperHeightMm - 2 * marginMm) * pxPerMm);

        let scale = availableWidthPx / contentSize.width;
        if (opts.single) {
            const scaleH = availableHeightPx / contentSize.height;
            scale = Math.min(scale, scaleH);
        }
        if (opts.scale) {
            const cl = clampScale(Number(opts.scale));
            if (cl) scale = cl;
        }
        if (scale < 0.1) scale = 0.1;
        if (scale > 2) scale = 2;

        let buffer;
        if (isPng) {
            const targetWidth = Math.max(1, Math.ceil(contentSize.width * scale));
            const targetHeight = opts.single ? Math.max(1, Math.ceil(contentSize.height * scale)) : Math.max(1, Math.ceil(availableHeightPx));
            try { await page.setViewportSize({ width: targetWidth, height: targetHeight }); } catch (e) { }
            buffer = await page.screenshot({ type: 'png', fullPage: !!opts.single });
        } else {
            const pdfOptions = {
                printBackground: true,
                format: (PAPER_SIZES.has(paper) ? paper : 'A4'),
                landscape: opts.orientation === 'landscape',
                margin: { top: opts.margin || '10mm', bottom: opts.margin || '10mm', left: opts.margin || '10mm', right: opts.margin || '10mm' },
                scale
            };
            buffer = await page.pdf(pdfOptions);
        }

        return { buffer, scale, contentSize, paper, orientation: opts.orientation || 'portrait' };
    } finally {
        await page.close();
        await context.close();
    }
}

module.exports = { renderHtmlToBuffer, initBrowser, closeBrowser };
