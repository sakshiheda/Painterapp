'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const sharp = require('sharp');

const {
  detectReferences,
  detectPaper,
  __test__: { otsuThreshold, blobCorners, matchAspect },
} = require('../src/services/referenceDetector');

// --- helpers ------------------------------------------------------------

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'painterapp-refdet-'));

/**
 * Build a synthetic photo: dark background + bright rectangle of a given
 * size, optionally rotated. Returns the file path.
 */
async function makeSyntheticPhoto({
  imgW = 1600, imgH = 1200, rectW, rectH, rectX, rectY,
  bg = 50, fg = 240, name,
}) {
  // Build the SVG so sharp rasterises it for us.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">
      <rect width="${imgW}" height="${imgH}" fill="rgb(${bg},${bg},${bg})"/>
      <rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" fill="rgb(${fg},${fg},${fg})"/>
    </svg>`;
  const out = path.join(TMP_DIR, name);
  await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(out);
  return out;
}

// --- unit tests on internals -------------------------------------------

test('otsuThreshold separates a clear bimodal histogram', () => {
  const hist = new Uint32Array(256);
  // 1000 dark pixels at 30, 1000 bright at 220
  hist[30] = 1000;
  hist[220] = 1000;
  const t = otsuThreshold(hist, 2000);
  // Otsu returns the smallest t in the optimal-variance plateau, which for
  // this bimodal histogram is t=30 (any t in [30, 219] yields identical
  // between-class variance). What we care about is that pixels at 30 are
  // classified as dark and pixels at 220 as bright using `value > t`.
  assert.ok(t >= 30 && t < 220, `threshold ${t} must be in [30, 219]`);
  assert.ok(!(30 > t),  '30 must NOT be classified bright');
  assert.ok(220 > t,    '220 must be classified bright');
});

test('blobCorners extracts the 4 extremes of a square', () => {
  // 10×10 square at origin.
  const W = 20;
  const px = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      px.push(y * W + x);
    }
  }
  const c = blobCorners(new Uint32Array(px), W);
  assert.deepEqual(c.tl, { x: 0, y: 0 });
  assert.deepEqual(c.tr, { x: 9, y: 0 });
  assert.deepEqual(c.br, { x: 9, y: 9 });
  assert.deepEqual(c.bl, { x: 0, y: 9 });
});

test('matchAspect picks A4 over Letter for a √2 rectangle', () => {
  const a4 = { id: 'a4-paper',  widthMm: 210, heightMm: 297, aspectTolerance: 0.04 };
  const lt = { id: 'us-letter', widthMm: 215.9, heightMm: 279.4, aspectTolerance: 0.04 };
  // 100×141.4 → aspect 1.414
  const corners = {
    tl: { x: 0, y: 0 }, tr: { x: 100, y: 0 },
    br: { x: 100, y: 141.4 }, bl: { x: 0, y: 141.4 },
  };
  const m = matchAspect(corners, [a4, lt]);
  assert.equal(m.ref.id, 'a4-paper');
});

test('matchAspect returns null when nothing fits', () => {
  const a4 = { id: 'a4-paper', widthMm: 210, heightMm: 297, aspectTolerance: 0.04 };
  const corners = {
    tl: { x: 0, y: 0 }, tr: { x: 100, y: 0 },
    br: { x: 100, y: 50 }, bl: { x: 0, y: 50 }, // aspect 2:1 — too wide
  };
  const m = matchAspect(corners, [a4]);
  assert.equal(m, null);
});

// --- end-to-end on synthetic images ------------------------------------

test('detectPaper finds an A4-shaped bright rectangle', async () => {
  // 1600×1200 frame, A4 sheet 400×566 px (aspect 1.415, ≈ A4).
  const file = await makeSyntheticPhoto({
    rectX: 600, rectY: 300, rectW: 400, rectH: 566, name: 'a4.jpg',
  });
  const r = await detectPaper(file);
  assert.equal(r.found, true, JSON.stringify(r));
  assert.equal(r.referenceId, 'a4-paper');
  assert.equal(r.widthMm, 210);
  assert.equal(r.heightMm, 297);
  assert.ok(r.confidence >= 0.55, `confidence too low: ${r.confidence}`);
  // Corners should reproduce the synthetic rectangle within a few pixels.
  assert.ok(Math.abs(r.corners.tl.x - 600) < 5);
  assert.ok(Math.abs(r.corners.tl.y - 300) < 5);
  assert.ok(Math.abs(r.corners.br.x - 1000) < 5);
  assert.ok(Math.abs(r.corners.br.y - 866) < 5);
});

test('detectPaper distinguishes Letter from A4', async () => {
  // Letter ≈ 215.9×279.4 mm (aspect 1.294). 400×518 px ≈ 1.295.
  const file = await makeSyntheticPhoto({
    rectX: 600, rectY: 300, rectW: 400, rectH: 518, name: 'letter.jpg',
  });
  const r = await detectPaper(file);
  assert.equal(r.found, true, JSON.stringify(r));
  assert.equal(r.referenceId, 'us-letter');
});

test('detectPaper rejects a scene with no paper', async () => {
  // Solid dark frame.
  const file = path.join(TMP_DIR, 'empty.jpg');
  await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 30, b: 30 } },
  }).jpeg().toFile(file);
  const r = await detectPaper(file);
  assert.equal(r.found, false);
});

test('detectPaper rejects a wrong-aspect bright rectangle', async () => {
  // 800×100 px → aspect 8:1 — clearly not paper.
  const file = await makeSyntheticPhoto({
    rectX: 400, rectY: 550, rectW: 800, rectH: 100, name: 'banner.jpg',
  });
  const r = await detectPaper(file);
  assert.equal(r.found, false);
  assert.equal(r.reason, 'aspect_mismatch');
});

test('detectReferences returns the best match across detectors', async () => {
  const file = await makeSyntheticPhoto({
    rectX: 600, rectY: 300, rectW: 400, rectH: 566, name: 'multi.jpg',
  });
  const r = await detectReferences(file);
  assert.equal(r.found, true);
  assert.equal(r.match.referenceId, 'a4-paper');
  assert.ok(Array.isArray(r.tried));
  assert.ok(r.tried.length >= 1);
});

test('detectReferences handles a no-match scene without throwing', async () => {
  const file = path.join(TMP_DIR, 'empty2.jpg');
  await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 30, b: 30 } },
  }).jpeg().toFile(file);
  const r = await detectReferences(file);
  assert.equal(r.found, false);
  assert.ok(Array.isArray(r.tried));
});
