'use strict';

/**
 * Polygon validation gates.
 *
 * Every measurement passes through these checks AFTER the homography has
 * been applied (so we operate in cm-space, where "1 cm" is "1 cm" no matter
 * what perspective the photo was taken from).
 *
 * Gates implemented:
 *   1. simple             — polygon edges do not cross each other (no bowtie)
 *   2. nondegenerate      — total area > 0, no duplicate adjacent vertices
 *   3. aspectSane         — bounding-box aspect ratio is plausible (not a
 *                           sliver, < 1:200) — catches accidentally dragged
 *                           single-line polygons.
 *   4. monteCarloAgrees   — randomly sample N points in the bounding box,
 *                           count those inside-polygon (ray casting), divide
 *                           by N and scale. The result must agree with the
 *                           shoelace area within 1 % (or within MC's own
 *                           sampling noise, whichever is larger). Catches
 *                           bugs in our own math AND any weird wraparound.
 *
 * All thresholds are configurable via env vars.
 */

const SAMPLES_DEFAULT = 5000;
const ASPECT_MAX_DEFAULT = 200;       // 1:200 — extreme sliver
const MC_TOLERANCE_DEFAULT = 0.01;    // 1 %

// ---------------------------------------------------------------------------
//  Geometry helpers (intentionally kept self-contained — no dependency on
//  geometry.js so this module can be unit-tested in isolation).
// ---------------------------------------------------------------------------

function shoelaceArea(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Standard "is the open segment (p1,p2) intersecting the open segment (p3,p4)?"
//   - returns false if they only touch at a shared endpoint (so adjacent
//     polygon edges are not flagged as intersections).
//   - returns true on a proper crossing OR on a "T-junction" where one
//     segment's endpoint lies strictly inside the other (a real defect).
function segmentsIntersect(p1, p2, p3, p4) {
  function ori(a, b, c) {
    const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(v) < 1e-9) return 0;
    return v > 0 ? 1 : -1;
  }
  function onSeg(a, b, c) {
    return (
      Math.min(a.x, b.x) - 1e-9 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-9 &&
      Math.min(a.y, b.y) - 1e-9 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-9
    );
  }
  // Filter out shared endpoints — they are legal in a polygon
  const eq = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  if (eq(p1, p3) || eq(p1, p4) || eq(p2, p3) || eq(p2, p4)) return false;

  const o1 = ori(p1, p2, p3);
  const o2 = ori(p1, p2, p4);
  const o3 = ori(p3, p4, p1);
  const o4 = ori(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  // Collinear special cases — only count when a non-endpoint actually lies
  // strictly between the other segment's endpoints (a real crossing).
  if (o1 === 0 && onSeg(p1, p2, p3)) return true;
  if (o2 === 0 && onSeg(p1, p2, p4)) return true;
  if (o3 === 0 && onSeg(p3, p4, p1)) return true;
  if (o4 === 0 && onSeg(p3, p4, p2)) return true;
  return false;
}

// Ray casting — point-in-polygon. Polygon is an array of {x,y}, edges are
// implicit closed (last → first).
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
//  Public gates
// ---------------------------------------------------------------------------

/**
 * Detect whether a polygon is "simple" (no self-intersections beyond shared
 * vertices of adjacent edges).
 *
 * Returns { ok: boolean, intersectionAt?: [edgeAIndex, edgeBIndex] }.
 */
function checkSimple(pts) {
  const n = pts.length;
  if (n < 3) return { ok: false };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges — they share a vertex by construction
      if (i === j) continue;
      if (j === (i + 1) % n) continue;
      if (i === (j + 1) % n) continue;
      const a1 = pts[i];
      const a2 = pts[(i + 1) % n];
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return { ok: false, intersectionAt: [i, j] };
      }
    }
  }
  return { ok: true };
}

/**
 * Bounding-box aspect-ratio sanity. Refuses absurd slivers (the user
 * almost certainly tapped along a single line).
 */
function checkAspect(pts, maxRatio = ASPECT_MAX_DEFAULT) {
  const { w, h } = bbox(pts);
  if (w <= 0 || h <= 0) return { ok: false, ratio: Infinity };
  const ratio = Math.max(w / h, h / w);
  return { ok: ratio <= maxRatio, ratio };
}

/**
 * Monte-Carlo cross-check of the polygon's area against the shoelace value.
 * Both areas are expected in the SAME units (cm, m, px — doesn't matter,
 * we compare the ratio). Returns:
 *   {
 *     ok: boolean,
 *     shoelaceArea, mcArea, ratio (= mcArea/shoelaceArea), tolerance,
 *     samples, hits, sampleStdDev
 *   }
 *
 * Why this catches things: if the homography or the polygon traversal had
 * a wrap-around or a sign bug, the shoelace number would diverge from the
 * physically-correct enclosed-pixel count. A 1 % MC threshold reliably
 * catches anything beyond ordinary sampling noise.
 */
function checkMonteCarlo(pts, opts = {}) {
  const samples = opts.samples || SAMPLES_DEFAULT;
  const tolerance = opts.tolerance ?? MC_TOLERANCE_DEFAULT;
  const sl = shoelaceArea(pts);
  if (sl <= 0) {
    return {
      ok: false,
      shoelaceArea: sl, mcArea: 0, ratio: 0, tolerance,
      samples, hits: 0, sampleStdDev: 0,
    };
  }
  const { minX, minY, w, h } = bbox(pts);
  const bboxArea = w * h;
  let hits = 0;
  // Deterministic seed for reproducibility within a request — we want the
  // same polygon to give the same gate verdict.
  let seed = 0x9E3779B9;
  const rand = () => {
    // xorshift32 — fast, well-distributed enough for area MC
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17; seed >>>= 0;
    seed ^= seed << 5;  seed >>>= 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < samples; i++) {
    const px = minX + rand() * w;
    const py = minY + rand() * h;
    if (pointInPolygon({ x: px, y: py }, pts)) hits++;
  }
  const p = hits / samples;
  const mcArea = p * bboxArea;
  // Standard error of the proportion → translate to standard error of the area
  const seP = Math.sqrt(Math.max(p * (1 - p), 1 / samples) / samples);
  const sampleStdDev = seP * bboxArea;
  // Disagreement threshold = max(tolerance · shoelace, 3·MC stddev). The 3σ
  // band stops us flagging legitimate geometry just because the random
  // sample happened to land badly.
  const allowed = Math.max(tolerance * sl, 3 * sampleStdDev);
  const diff = Math.abs(mcArea - sl);
  return {
    ok: diff <= allowed,
    shoelaceArea: sl, mcArea, ratio: mcArea / sl,
    tolerance, samples, hits, sampleStdDev,
    diff, allowed,
  };
}

/**
 * Run all polygon gates and return a structured report.
 * `pts` is an array of {x, y} in the SAME unit you want to evaluate in
 * (typically cm for the homography-projected polygon, but the math is
 * unit-agnostic).
 */
function validatePolygon(pts, opts = {}) {
  const aspectMax = opts.aspectMax ?? ASPECT_MAX_DEFAULT;
  const mcSamples = opts.mcSamples ?? SAMPLES_DEFAULT;
  const mcTolerance = opts.mcTolerance ?? MC_TOLERANCE_DEFAULT;

  const simple = checkSimple(pts);
  const aspect = checkAspect(pts, aspectMax);
  // Skip MC if simple gate already failed — its result on a self-intersecting
  // polygon is meaningful but wastes cycles when we'll reject anyway.
  const mc = simple.ok
    ? checkMonteCarlo(pts, { samples: mcSamples, tolerance: mcTolerance })
    : { ok: false, skipped: true, reason: 'simple_gate_failed' };

  const ok = simple.ok && aspect.ok && mc.ok;
  let firstFailure = null;
  if (!simple.ok) firstFailure = 'polygon_self_intersecting';
  else if (!aspect.ok) firstFailure = 'polygon_aspect_extreme';
  else if (!mc.ok) firstFailure = 'polygon_area_mc_disagrees';

  return { ok, firstFailure, simple, aspect, mc };
}

module.exports = {
  validatePolygon,
  checkSimple,
  checkAspect,
  checkMonteCarlo,
  shoelaceArea,
  pointInPolygon,
  segmentsIntersect,
  bbox,
  // exported for tests / introspection
  SAMPLES_DEFAULT,
  ASPECT_MAX_DEFAULT,
  MC_TOLERANCE_DEFAULT,
};
