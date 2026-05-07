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

test('measurePolygon — rejects non-positive scale', () => {
  const sq = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ];
  assert.throws(() => geo.measurePolygon(sq, 0));
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
