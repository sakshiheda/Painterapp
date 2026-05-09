'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const geo = require('../src/services/geometry');

test('pixelDistance — basic 3-4-5', () => {
  assert.equal(geo.pixelDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('pixelsPerCm — 100 px line over 50 cm = 2 px/cm', () => {
  const px = geo.pixelsPerCm({ x: 0, y: 0 }, { x: 100, y: 0 }, 50);
  assert.equal(px, 2);
});

test('pixelsPerCm — rejects identical points', () => {
  assert.throws(() => geo.pixelsPerCm({ x: 1, y: 1 }, { x: 1, y: 1 }, 10));
});

test('pixelsPerCm — rejects non-positive length', () => {
  assert.throws(() => geo.pixelsPerCm({ x: 0, y: 0 }, { x: 10, y: 0 }, 0));
});

test('measurePolygon — square 100x100 px @ 1 px/cm = 100x100 cm = 1 m²', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const r = geo.measurePolygon(square, 1);
  assert.equal(r.pointCount, 4);
  assert.equal(r.area.cm2, 10000);
  assert.equal(r.area.m2, 1);
  assert.equal(r.perimeter.cm, 400);
  assert.equal(r.sides.length, 4);
  for (const s of r.sides) assert.equal(s.lengthCm, 100);
});

test('measurePolygon — triangle area via shoelace', () => {
  // right triangle, legs 6 and 8 -> area 24
  const tri = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 0, y: 8 },
  ];
  const r = geo.measurePolygon(tri, 1);
  assert.equal(r.area.cm2, 24);
  // hypotenuse should be 10
  const hyp = r.sides.find((s) => s.lengthCm === 10);
  assert.ok(hyp, 'expected one side to be 10 cm');
});

test('measurePolygon — rejects <3 points', () => {
  assert.throws(() => geo.measurePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }], 1));
});

test('measurePolygon — uncalibrated returns pixel-only metrics', () => {
  const sq = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ];
  const r = geo.measurePolygon(sq, 0);
  assert.equal(r.calibrated, false);
  assert.equal(r.area.px2, 100);
  assert.equal(r.perimeter.px, 40);
  assert.equal(r.area.cm2, undefined);
  assert.equal(r.sides[0].lengthCm, undefined);
  assert.equal(r.sides[0].lengthPx, 10);
});

test('measurePolygon — area scales by 1/(px_per_cm)^2', () => {
  const square = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];
  // 4 px/cm => 25 cm side => 625 cm²
  const r = geo.measurePolygon(square, 4);
  assert.equal(r.area.cm2, 625);
  // ft² = 625 / 929.0304 ≈ 0.673
  assert.ok(Math.abs(r.area.ft2 - 625 / geo.SQCM_PER_SQFOOT) < 0.001);
});

// ---------------------------------------------------------------------------
// Homography (4-corner perspective calibration)
// ---------------------------------------------------------------------------

test('homography — identity-ish: 100 px square maps to 50×50 cm rect', () => {
  // Image rectangle 100 px wide × 100 px tall declared as 50 cm × 50 cm
  const H = geo.homographyFromRectangle({
    tl: { x: 0,   y: 0 },
    tr: { x: 100, y: 0 },
    br: { x: 100, y: 100 },
    bl: { x: 0,   y: 100 },
    widthCm: 50,
    heightCm: 50,
  });
  // Corners must round-trip
  const tl = geo.applyHomography(H, { x: 0, y: 0 });
  const br = geo.applyHomography(H, { x: 100, y: 100 });
  assert.ok(Math.abs(tl.x) < 1e-6 && Math.abs(tl.y) < 1e-6);
  assert.ok(Math.abs(br.x - 50) < 1e-6 && Math.abs(br.y - 50) < 1e-6);
  // Mid point should map to (25, 25) cm
  const mid = geo.applyHomography(H, { x: 50, y: 50 });
  assert.ok(Math.abs(mid.x - 25) < 1e-6 && Math.abs(mid.y - 25) < 1e-6);
});

test('homography — measurePolygon on tilted-perspective rectangle gives correct cm²', () => {
  // Imagine a 60 × 180 cm gate photographed at an angle. The four corners
  // appear at these (made-up but plausible) image-pixel positions:
  const tl = { x: 100, y: 100 };
  const tr = { x: 800, y: 200 };
  const br = { x: 750, y: 1700 };
  const bl = { x: 130, y: 1600 };
  const H = geo.homographyFromRectangle({ tl, tr, br, bl, widthCm: 60, heightCm: 180 });

  // Measuring the very same rectangle as a polygon should return area = 60 × 180 = 10 800 cm²
  const r = geo.measurePolygon([tl, tr, br, bl], { homography: H });
  assert.equal(r.calibrated, true);
  assert.equal(r.method, 'rect');
  assert.ok(Math.abs(r.area.cm2 - 10800) < 1, `expected ~10800 cm², got ${r.area.cm2}`);
  // Side lengths should be near 60, 180, 60, 180
  const lens = r.sides.map((s) => s.lengthCm).sort((a, b) => a - b);
  assert.ok(Math.abs(lens[0] - 60) < 0.5 && Math.abs(lens[1] - 60) < 0.5);
  assert.ok(Math.abs(lens[2] - 180) < 0.5 && Math.abs(lens[3] - 180) < 0.5);
});

test('homography — half of the calibrated rectangle is exactly half the area', () => {
  const tl = { x: 100, y: 100 };
  const tr = { x: 800, y: 200 };
  const br = { x: 750, y: 1700 };
  const bl = { x: 130, y: 1600 };
  const H = geo.homographyFromRectangle({ tl, tr, br, bl, widthCm: 60, heightCm: 180 });

  // Build the "left half" polygon in cm-space and map it back to image px
  // via the inverse homography. This guarantees the polygon is *exactly*
  // half the rectangle in real-world coordinates.
  const Hinv = invert3x3(H);
  function fromCm(p) { return geo.applyHomography(Hinv, p); }
  const poly = [
    fromCm({ x: 0,  y: 0 }),
    fromCm({ x: 30, y: 0 }),
    fromCm({ x: 30, y: 180 }),
    fromCm({ x: 0,  y: 180 }),
  ];
  const r = geo.measurePolygon(poly, { homography: H });
  assert.ok(Math.abs(r.area.cm2 - 5400) < 1, `expected 5400 cm², got ${r.area.cm2}`);
});

// 3x3 matrix invert helper used only by the test above.
function invert3x3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A =  (e * i - f * h);
  const B = -(d * i - f * g);
  const C =  (d * h - e * g);
  const D = -(b * i - c * h);
  const E =  (a * i - c * g);
  const F = -(a * h - b * g);
  const G =  (b * f - c * e);
  const H_ = -(a * f - c * d);
  const I =  (a * e - b * d);
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('non-invertible homography');
  return [A/det, D/det, G/det, B/det, E/det, H_/det, C/det, F/det, I/det];
}

test('homography — rejects collinear / degenerate corners', () => {
  // All 4 points on a horizontal line cannot form a rectangle
  assert.throws(() => geo.homographyFromRectangle({
    tl: { x: 0,  y: 0 }, tr: { x: 10, y: 0 },
    br: { x: 20, y: 0 }, bl: { x: 30, y: 0 },
    widthCm: 10, heightCm: 10,
  }));
});
