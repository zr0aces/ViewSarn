const { chromium } = require('playwright');
const { RENDER_CONCURRENCY, RENDER_QUEUE_MAX, RENDER_TIMEOUT_MS } = require('./config');
const logger = require('./logger');

const PAPER_SIZES = {
    A4: { w: 210, h: 297 },
    A5: { w: 148, h: 210 },
    LETTER: { w: 216, h: 279 },
    LEGAL: { w: 216, h: 356 }
};
const WAIT_UNTIL = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);
const PX_PER_MM = 96 / 25.4;
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;

let browser;

async function initBrowser() {
    if (!browser) {
        logger.info('Launching Playwright browser...');
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        logger.info({ concurrency: RENDER_CONCURRENCY }, 'Browser launched.');
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

// Cap concurrent pages. Every in-flight render holds a Chromium page, so an
// unbounded burst is what turns a traffic spike into an OOM kill.
let active = 0;
const waiting = [];

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

function acquireSlot(signal) {
    if (signal && signal.aborted) {
        return Promise.reject(httpError(499, 'Client closed the request'));
    }
    if (active < RENDER_CONCURRENCY) {
        active += 1;
        return Promise.resolve();
    }
    // Each queued request still holds its parsed body, so the queue needs its
    // own ceiling — otherwise the page cap just moves the OOM to the backlog.
    if (waiting.length >= RENDER_QUEUE_MAX) {
        return Promise.reject(httpError(503, 'Render queue is full, retry shortly'));
    }
    // A caller that has already hung up should not be rendered for: it burns a
    // slot producing output nobody reads, and delays the callers behind it.
    return new Promise((resolve, reject) => {
        const entry = {};
        const onAbort = () => {
            const index = waiting.indexOf(entry);
            if (index !== -1) waiting.splice(index, 1);
            reject(httpError(499, 'Client closed the request'));
        };
        entry.resolve = () => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve();
        };
        waiting.push(entry);
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
}

function releaseSlot() {
    const next = waiting.shift();
    if (next) next.resolve();
    else active -= 1;
}

function parseMarginToMm(m) {
    if (!m) return 0;
    if (typeof m === 'number') return m;
    if (m.endsWith('mm')) return parseFloat(m.slice(0, -2));
    if (m.endsWith('cm')) return parseFloat(m.slice(0, -2)) * 10;
    if (m.endsWith('in')) return parseFloat(m.slice(0, -2)) * 25.4;
    return parseFloat(m);
}

function clamp(s) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

async function renderHtmlToBuffer(html, opts, { signal } = {}) {
    const b = await initBrowser();
    await acquireSlot(signal);

    const isPng = !!opts.png;
    const dpi = opts.dpi && Number(opts.dpi) > 0 ? Number(opts.dpi) : 96;
    const contextOptions = isPng
        ? { deviceScaleFactor: dpi / 96, viewport: { width: 1280, height: 800 } }
        : { viewport: null };

    let context;
    let timer;
    // The deadline can fire while newContext is still in flight, in which case
    // the finally below runs before there is anything to close. Whoever gets
    // there second does the closing: the finally if the context already exists,
    // otherwise the render itself once it sees it has been abandoned.
    let abandoned = false;
    const work = (async () => {
        const created = await b.newContext(contextOptions);
        context = created;
        if (abandoned) {
            await created.close().catch(() => {});
            throw httpError(504, 'Render abandoned before it started');
        }
        const page = await context.newPage();

        const waitUntil = WAIT_UNTIL.has(opts.waitUntil) ? opts.waitUntil : 'networkidle';
        await page.setContent(html, { waitUntil, timeout: RENDER_TIMEOUT_MS });

        // One round-trip: settle the page, then measure it. page.evaluate has no
        // timeout of its own, so both waits are bounded inside the page — an
        // unresolvable font would otherwise pin this render's slot forever.
        const contentSize = await page.evaluate(async () => {
            await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2000))]);
            // Two frames = one painted layout. Replaces a blind 100ms sleep:
            // same "let it settle" intent, typically ~32ms instead.
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const b = document.body; const h = document.documentElement;
            const width = Math.max(b.scrollWidth, b.offsetWidth, h.clientWidth, h.scrollWidth, h.offsetWidth);
            const height = Math.max(b.scrollHeight, b.offsetHeight, h.clientHeight, h.scrollHeight, h.offsetHeight);
            return { width, height };
        });

        const requested = (opts.format || 'A4').toUpperCase();
        // Object.hasOwn, not a bare lookup: `format: "constructor"` would
        // otherwise resolve to an inherited property and poison the math.
        const paper = Object.hasOwn(PAPER_SIZES, requested) ? requested : 'A4';
        const paperMm = PAPER_SIZES[paper];

        let paperWidthMm = paperMm.w, paperHeightMm = paperMm.h;
        if (opts.orientation === 'landscape') [paperWidthMm, paperHeightMm] = [paperHeightMm, paperWidthMm];

        const marginMm = parseMarginToMm(opts.margin || '10mm') || 0;
        const availableWidthPx = Math.max(1, (paperWidthMm - 2 * marginMm) * PX_PER_MM);
        const availableHeightPx = Math.max(1, (paperHeightMm - 2 * marginMm) * PX_PER_MM);

        let scale = availableWidthPx / contentSize.width;
        if (opts.single) scale = Math.min(scale, availableHeightPx / contentSize.height);
        // Guard on opts.scale being present first: Number(null) is 0, which would
        // otherwise clamp to MIN_SCALE and shrink every unscaled render.
        const override = opts.scale ? Number(opts.scale) : NaN;
        scale = clamp(Number.isFinite(override) ? override : scale);

        let buffer;
        if (isPng) {
            const targetWidth = Math.max(1, Math.ceil(contentSize.width * scale));
            const targetHeight = opts.single
                ? Math.max(1, Math.ceil(contentSize.height * scale))
                : Math.max(1, Math.ceil(availableHeightPx));
            try {
                await page.setViewportSize({ width: targetWidth, height: targetHeight });
            } catch (e) {
                logger.debug({ err: e, targetWidth, targetHeight }, 'setViewportSize failed, keeping default viewport');
            }
            buffer = await page.screenshot({ type: 'png', fullPage: !!opts.single });
        } else {
            const margin = opts.margin || '10mm';
            buffer = await page.pdf({
                printBackground: true,
                format: paper, // already narrowed to a PAPER_SIZES key above
                landscape: opts.orientation === 'landscape',
                margin: { top: margin, bottom: margin, left: margin, right: margin },
                scale
            });
        }

        return { buffer, scale, contentSize, paper, orientation: opts.orientation || 'portrait' };
    })();

    // The deadline covers the whole render, not just page load: screenshot, pdf
    // and evaluate each have their own ways of never returning.
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(httpError(504, `Render exceeded ${RENDER_TIMEOUT_MS}ms`)),
            RENDER_TIMEOUT_MS
        );
    });
    // Closing the context below rejects the abandoned work; swallow it so a lost
    // race never surfaces as an unhandled rejection.
    work.catch(() => {});

    try {
        return await Promise.race([work, deadline]);
    } finally {
        clearTimeout(timer);
        abandoned = true;
        // Closing the context drops its pages; closing both is redundant work.
        // It also aborts whatever the abandoned render was still awaiting.
        if (context) await context.close().catch(() => {});
        releaseSlot();
    }
}

module.exports = {
    renderHtmlToBuffer,
    initBrowser,
    closeBrowser,
    // exported for tests: the slot logic deadlocks the service if it is wrong
    _acquireSlot: acquireSlot,
    _releaseSlot: releaseSlot,
    _inFlight: () => ({ active, waiting: waiting.length })
};
