// Size estimates for a render, kept pure so they can be tested without Chromium.

// Device pixels the PNG screenshot will allocate. With `single` the screenshot is
// full-page: it covers the whole document, not the resized viewport, so the
// document size must count too. Without it the screenshot is the viewport only.
function pngPixels({ contentSize, targetWidth, targetHeight, single, dsf }) {
    const width = single ? Math.max(contentSize.width, targetWidth) : targetWidth;
    const height = single ? Math.max(contentSize.height, targetHeight) : targetHeight;
    return Math.ceil(width * dsf) * Math.ceil(height * dsf);
}

// Pages a PDF will have: scaled content height over the printable page height.
function pdfPages({ contentHeight, scale, availableHeightPx }) {
    return Math.ceil((contentHeight * scale) / availableHeightPx);
}

module.exports = { pngPixels, pdfPages };
