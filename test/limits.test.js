const test = require('node:test');
const assert = require('node:assert/strict');
const { pngPixels, pdfPages } = require('../src/limits');

test('pngPixels: a full-page PNG counts the document, not just the viewport', () => {
  const px = pngPixels({ contentSize: { width: 800, height: 20000 }, targetWidth: 794, targetHeight: 2000, single: true, dsf: 1 });
  assert.equal(px, 800 * 20000);
});

test('pngPixels: a viewport PNG counts the viewport only', () => {
  const px = pngPixels({ contentSize: { width: 800, height: 20000 }, targetWidth: 794, targetHeight: 1000, single: false, dsf: 2 });
  assert.equal(px, 1588 * 2000);
});

test('pngPixels: device scale factor applies to both axes', () => {
  const px = pngPixels({ contentSize: { width: 100, height: 100 }, targetWidth: 100, targetHeight: 100, single: true, dsf: 6.25 });
  assert.equal(px, 625 * 625);
});

test('pngPixels: a wide page with scale 2 is measured by its content width', () => {
  const px = pngPixels({ contentSize: { width: 20000, height: 100 }, targetWidth: 40000, targetHeight: 200, single: true, dsf: 1 });
  assert.equal(px, 40000 * 200);
});

test('pdfPages: scaled height over printable height, rounded up', () => {
  assert.equal(pdfPages({ contentHeight: 1000, scale: 1, availableHeightPx: 1000 }), 1);
  assert.equal(pdfPages({ contentHeight: 1001, scale: 1, availableHeightPx: 1000 }), 2);
  assert.equal(pdfPages({ contentHeight: 10000, scale: 0.5, availableHeightPx: 1000 }), 5);
});
