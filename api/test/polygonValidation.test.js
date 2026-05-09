'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePolygon,
  checkSimple,
  checkAspect,
  checkMonteCarlo,
  shoelaceArea,
  pointInPolygon,
  segmentsIntersect,
} = require('../src/services/polygonValidation');

// --- helpers ---
const square = [
  { x: 0,   y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0,   y: 100 },
];
const bowtie = [
  { x: 0,   y: 0 },
  { x: 100, y: 100 },
  { x: 100, y: 0 },
  { x: 0,   y: 100 },
]; // crosses itself

test('shoelaceArea — unit square = 100·100 = 10_000', () => {
  assert.equal(shoelaceArea(square), 10000);
});

test('pointInPolygon — interior is inside, exterior is outside', () => {
  assert.equal(pointInPolygon({ x: 50, y: 50 }, square), true);
  assert.equal(pointInPolygon({ x: -1, y: -1 }, square), false);
  assert.equal(pointInPolygon({ x: 200, y: 50 }, square), false);
});

test('segmentsIntersect — proper crossing detected', () => {
  assert.equal(
    segmentsIntersect({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }),
    true
  );
});

test('segmentsIntersect — shared endpoint is NOT a crossing', () => {
  assert.equal(
    segmentsIntersect({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }),
    false
  );
});

test('checkSimple — square is simple', () => {
  const r = checkSimple(square);
  assert.equal(r.ok, true);
});

test('checkSimple — bowtie is non-simple', () => {
  const r = checkSimple(bowtie);
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.intersectionAt));
});

test('checkAspect — square is fine', () => {
  const r = checkAspect(square, 200);
  assert.equal(r.ok, true);
  assert.equal(r.ratio, 1);
});

test('checkAspect — degenerate sliver is rejected', () => {
  const sliver = [
    { x: 0,    y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 1 },
    { x: 0,    y: 1 },
  ]; // 1000:1 ratio
  const r = checkAspect(sliver, 200);
  assert.equal(r.ok, false);
  assert.ok(r.ratio >= 1000 - 1e-6);
});

test('checkMonteCarlo — well-formed polygon agrees within 1 %', () => {
  const r = checkMonteCarlo(square, { samples: 5000, tolerance: 0.01 });
  assert.equal(r.ok, true);
  assert.equal(r.shoelaceArea, 10000);
  assert.ok(Math.abs(r.ratio - 1) < 0.05, `MC ratio ${r.ratio} off`);
});

test('validatePolygon — clean square: ok=true, all gates green', () => {
  const r = validatePolygon(square);
  assert.equal(r.ok, true);
  assert.equal(r.firstFailure, null);
  assert.equal(r.simple.ok, true);
  assert.equal(r.aspect.ok, true);
  assert.equal(r.mc.ok, true);
});

test('validatePolygon — bowtie: ok=false, firstFailure=self_intersecting', () => {
  const r = validatePolygon(bowtie);
  assert.equal(r.ok, false);
  assert.equal(r.firstFailure, 'polygon_self_intersecting');
});

test('validatePolygon — extreme sliver: ok=false, firstFailure=aspect_extreme', () => {
  const sliver = [
    { x: 0,    y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 1 },
    { x: 0,    y: 1 },
  ];
  const r = validatePolygon(sliver, { aspectMax: 200 });
  assert.equal(r.ok, false);
  // Sliver is simple but extreme — aspect gate should be the first failure
  assert.equal(r.firstFailure, 'polygon_aspect_extreme');
});

test('validatePolygon — too few points: ok=false', () => {
  const r = validatePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  assert.equal(r.ok, false);
});

test('validatePolygon — non-square rectangle still passes', () => {
  const rect = [
    { x: 0,   y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 80 },
    { x: 0,   y: 80 },
  ]; // 3.75:1 — within budget
  const r = validatePolygon(rect);
  assert.equal(r.ok, true);
  // shoelace = 24_000, MC should be very close
  assert.equal(r.mc.shoelaceArea, 24000);
  assert.ok(Math.abs(r.mc.ratio - 1) < 0.05);
});
