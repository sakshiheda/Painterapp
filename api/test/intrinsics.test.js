'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  intrinsicsFromExif,
  fovDegFrom35mm,
  lensRiskFromFov,
  distortNormalised,
  undistortNormalised,
  undistortPoint,
  undistortPoints,
  ZERO_DISTORTION,
} = require('../src/services/intrinsics');

test('fovDegFrom35mm — 28mm-equivalent ≈ 65.5° (typical phone main camera)', () => {
  const fov = fovDegFrom35mm(28);
  // 2·atan(36/(2·28)) = 65.47°
  assert.ok(Math.abs(fov - 65.47) < 0.1, `got ${fov}`);
});

test('fovDegFrom35mm — 13mm-equivalent ≈ 108° (ultrawide)', () => {
  const fov = fovDegFrom35mm(13);
  // 2·atan(36/(2·13)) ≈ 108.3°
  assert.ok(Math.abs(fov - 108.3) < 0.2, `got ${fov}`);
});

test('fovDegFrom35mm — invalid input returns null', () => {
  assert.equal(fovDegFrom35mm(0), null);
  assert.equal(fovDegFrom35mm(-1), null);
  assert.equal(fovDegFrom35mm(NaN), null);
  assert.equal(fovDegFrom35mm(undefined), null);
});

test('intrinsicsFromExif — uses FocalLengthIn35mmFilm when present', () => {
  const K = intrinsicsFromExif({
    width: 4000, height: 3000, focalLengthIn35mmFilm: 28,
  });
  assert.equal(K.source, 'exif35');
  assert.equal(K.focalEquiv35mm, 28);
  assert.equal(K.cx, 2000);
  assert.equal(K.cy, 1500);
  assert.ok(Math.abs(K.fovDeg - 65.47) < 0.1);
  // fx = (W/2) / tan(fovDeg/2)
  const expectedFx = 2000 / Math.tan((65.47 * Math.PI) / 360);
  assert.ok(Math.abs(K.fx - expectedFx) < 1, `fx ${K.fx} vs ${expectedFx}`);
  // Square pixels assumption
  assert.equal(K.fx, K.fy);
});

test('intrinsicsFromExif — falls back to 70° FOV when no EXIF', () => {
  const K = intrinsicsFromExif({ width: 2048, height: 1536 });
  assert.equal(K.source, 'fallback');
  assert.equal(K.fovDeg, 70);
  assert.equal(K.focalEquiv35mm, null);
});

test('intrinsicsFromExif — throws without dimensions', () => {
  assert.throws(() => intrinsicsFromExif({ width: 0, height: 0 }));
});

test('lensRiskFromFov — green / amber / red bands', () => {
  assert.equal(lensRiskFromFov(60), 'green');
  assert.equal(lensRiskFromFov(80), 'green');
  assert.equal(lensRiskFromFov(85), 'amber');
  assert.equal(lensRiskFromFov(95), 'amber');
  assert.equal(lensRiskFromFov(100), 'red');
});

test('undistortPoint — zero distortion is identity', () => {
  const K = { fx: 1000, fy: 1000, cx: 500, cy: 400 };
  const p = { x: 123.4, y: 678.9 };
  const u = undistortPoint(p, K, ZERO_DISTORTION);
  assert.equal(u.x, p.x);
  assert.equal(u.y, p.y);
});

test('undistortPoint — non-zero distortion changes off-centre points', () => {
  const K = { fx: 1000, fy: 1000, cx: 500, cy: 500 };
  const D = { k1: -0.1, k2: 0, p1: 0, p2: 0 };
  // Centre point — no displacement (r = 0)
  const centre = undistortPoint({ x: 500, y: 500 }, K, D);
  assert.ok(Math.abs(centre.x - 500) < 1e-6);
  assert.ok(Math.abs(centre.y - 500) < 1e-6);
  // Off-centre point — must move
  const off = undistortPoint({ x: 800, y: 800 }, K, D);
  assert.notEqual(off.x, 800);
  assert.notEqual(off.y, 800);
});

test('undistortNormalised — round-trip distort→undistort recovers original', () => {
  const D = { k1: -0.15, k2: 0.04, p1: 0.001, p2: -0.002 };
  // Pick a representative off-centre point in normalised coords (within
  // a typical phone's effective image circle, |x| < 1, |y| < 1).
  const x0 = 0.4, y0 = -0.3;
  // forward: pinhole-ideal -> distorted
  const dist = distortNormalised(x0, y0, D);
  // inverse: distorted -> pinhole-ideal
  const back = undistortNormalised(dist.x, dist.y, D);
  assert.ok(Math.abs(back.x - x0) < 1e-8, `x ${back.x} vs ${x0}`);
  assert.ok(Math.abs(back.y - y0) < 1e-8, `y ${back.y} vs ${y0}`);
});

test('undistortPoints — preserves array length and works element-wise', () => {
  const K = { fx: 1000, fy: 1000, cx: 500, cy: 500 };
  const D = { k1: -0.1, k2: 0, p1: 0, p2: 0 };
  const pts = [
    { x: 500, y: 500 }, // centre — should be itself
    { x: 700, y: 500 }, // pure-x off
    { x: 500, y: 800 }, // pure-y off
  ];
  const out = undistortPoints(pts, K, D);
  assert.equal(out.length, 3);
  assert.ok(Math.abs(out[0].x - 500) < 1e-6);
  assert.notEqual(out[1].x, 700);
  assert.equal(out[1].y, 500); // pure-x point stays on y = cy
});
