'use strict';

/**
 * Pure geometry helpers — no I/O, easy to unit-test.
 * All "px" values are image pixel coordinates (origin top-left).
 *
 * Two calibration models are supported:
 *
 *   1. "line scale" — single pxPerCm number. Only correct when the camera
 *      is perpendicular to the surface AND the calibration line is in the
 *      same plane as the measured object. Fragile in real-world photos.
 *
 *   2. "rect homography" — the user identifies a rectangle (4 corners, in
 *      order TL, TR, BR, BL) in the same plane as the object, and tells us
 *      the rectangle's real width and height in cm. We solve for a 3x3
 *      homography H that maps (px → cm in object plane). Any polygon on
 *      that plane can then be measured exactly in cm regardless of camera
 *      tilt or perspective. This is the standard photogrammetry technique.
 */

const CM_PER_FOOT = 30.48;
const SQCM_PER_SQFOOT = CM_PER_FOOT * CM_PER_FOOT; // 929.0304

function pixelDistance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute pixels-per-centimetre from a calibration line.
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @param {number} realLengthCm  the user-stated real-world length between p1 and p2 in cm
 * @returns {number} pixels per cm
 */
function pixelsPerCm(p1, p2, realLengthCm) {
  if (realLengthCm <= 0) {
    throw new Error('realLengthCm must be > 0');
  }
  const distPx = pixelDistance(p1, p2);
  if (distPx <= 0) {
    throw new Error('Calibration points must be distinct');
  }
  return distPx / realLengthCm;
}

/**
 * Shoelace polygon area in square pixels. Returns absolute value.
 * Polygon must have >=3 points; closing edge is implicit.
 */
function polygonAreaPx2(points) {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function polygonPerimeterPx(points) {
  const n = points.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += pixelDistance(points[i], points[(i + 1) % n]);
  }
  return sum;
}

function round(value, decimals = 2) {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

// ===========================================================================
//  Homography (4-point perspective calibration)
// ===========================================================================

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting.
 * A is square n×n (array of arrays), b is length n. Returns x of length n.
 * Throws on (near-)singular matrices.
 */
function solveLinearSystem(A, b) {
  const n = b.length;
  // Build augmented matrix [A | b]
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    // Find pivot row in column i
    let pivot = i;
    let pivotMag = Math.abs(M[i][i]);
    for (let k = i + 1; k < n; k++) {
      const mag = Math.abs(M[k][i]);
      if (mag > pivotMag) {
        pivotMag = mag;
        pivot = k;
      }
    }
    if (pivotMag < 1e-12) {
      throw new Error('Singular matrix — calibration corners are collinear or duplicated');
    }
    if (pivot !== i) {
      const tmp = M[i]; M[i] = M[pivot]; M[pivot] = tmp;
    }
    // Eliminate below
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      if (f === 0) continue;
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  // Back-substitute
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Compute the 3×3 homography H mapping image-pixel points to real-world
 * coordinates (cm in the object plane), given 4 corner correspondences.
 *
 * @param {Array<{x:number,y:number}>} srcPx  4 points in image pixel coords
 * @param {Array<{x:number,y:number}>} dstCm  4 matching real-world cm coords
 * @returns {number[]} 9-element row-major matrix [h11..h33] with h33 = 1
 */
function computeHomography(srcPx, dstCm) {
  if (srcPx.length !== 4 || dstCm.length !== 4) {
    throw new Error('computeHomography requires exactly 4 point correspondences');
  }
  // For each correspondence (x,y) -> (X,Y), DLT gives 2 equations:
  //   x·h11 + y·h12 + h13 - X·x·h31 - X·y·h32 = X
  //   x·h21 + y·h22 + h23 - Y·x·h31 - Y·y·h32 = Y
  // We fix h33 = 1 -> 8 equations, 8 unknowns.
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = srcPx[i];
    const { x: X, y: Y } = dstCm[i];
    A.push([ x, y, 1, 0, 0, 0, -X * x, -X * y ]);
    b.push(X);
    A.push([ 0, 0, 0, x, y, 1, -Y * x, -Y * y ]);
    b.push(Y);
  }
  const h = solveLinearSystem(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * Apply a 3×3 homography (row-major 9-element array) to a 2D point.
 * Returns the projected point in the destination coordinate system.
 */
function applyHomography(H, p) {
  const x = H[0] * p.x + H[1] * p.y + H[2];
  const y = H[3] * p.x + H[4] * p.y + H[5];
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (Math.abs(w) < 1e-12) {
    throw new Error('Point projects to infinity — outside calibrated plane');
  }
  return { x: x / w, y: y / w };
}

/**
 * Convenience helper that builds the homography directly from a labelled
 * rectangle reference: 4 image-px corners in TL, TR, BR, BL order plus the
 * rectangle's real width and height in cm.
 */
function homographyFromRectangle({ tl, tr, br, bl, widthCm, heightCm }) {
  if (!(widthCm > 0) || !(heightCm > 0)) {
    throw new Error('widthCm and heightCm must be > 0');
  }
  const srcPx = [tl, tr, br, bl];
  const dstCm = [
    { x: 0,        y: 0 },
    { x: widthCm,  y: 0 },
    { x: widthCm,  y: heightCm },
    { x: 0,        y: heightCm },
  ];
  return computeHomography(srcPx, dstCm);
}

/**
 * Build the full measurement payload.
 *
 * @param {Array<{x:number,y:number}>} polygon  vertices in image-px
 * @param {object} [calibration]
 * @param {number[]} [calibration.homography]  9-element 3×3 (preferred — handles
 *                                              perspective tilt correctly)
 * @param {number}   [calibration.pxPerCm]     fallback simple linear scale
 */
function measurePolygon(polygon, calibration) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error('Polygon must have at least 3 points');
  }

  // Back-compat: callers used to pass a bare number.
  let homography = null;
  let pxPerCm = 0;
  if (typeof calibration === 'number') {
    pxPerCm = calibration;
  } else if (calibration && typeof calibration === 'object') {
    if (Array.isArray(calibration.homography) && calibration.homography.length === 9) {
      homography = calibration.homography;
    } else if (Number.isFinite(calibration.pxPerCm)) {
      pxPerCm = calibration.pxPerCm;
    }
  }

  const calibrated = !!homography || (Number.isFinite(pxPerCm) && pxPerCm > 0);
  // method tells the client which calibration produced the cm numbers
  const method = homography ? 'rect' : (calibrated ? 'line' : 'none');

  // Pre-project polygon into cm-space when we have a homography. This is
  // what makes the result correct under camera tilt.
  let polyCm = null;
  if (homography) {
    polyCm = polygon.map((p) => applyHomography(homography, p));
  }

  const sides = [];
  for (let i = 0; i < polygon.length; i++) {
    const aPx = polygon[i];
    const bPx = polygon[(i + 1) % polygon.length];
    const px = pixelDistance(aPx, bPx);
    const side = {
      index: i,
      from: aPx,
      to: bPx,
      lengthPx: round(px, 2),
    };
    if (homography) {
      const aCm = polyCm[i];
      const bCm = polyCm[(i + 1) % polyCm.length];
      const cm = Math.sqrt((bCm.x - aCm.x) ** 2 + (bCm.y - aCm.y) ** 2);
      side.lengthCm = round(cm, 2);
      side.lengthFt = round(cm / CM_PER_FOOT, 3);
      side.lengthM = round(cm / 100, 3);
    } else if (calibrated) {
      const cm = px / pxPerCm;
      side.lengthCm = round(cm, 2);
      side.lengthFt = round(cm / CM_PER_FOOT, 3);
      side.lengthM = round(cm / 100, 3);
    }
    sides.push(side);
  }

  const perimeterPx = polygonPerimeterPx(polygon);
  const areaPx2 = polygonAreaPx2(polygon);

  const result = {
    pointCount: polygon.length,
    calibrated,
    method,
    perimeter: { px: round(perimeterPx, 2) },
    area: { px2: round(areaPx2, 2) },
    sides,
  };

  if (homography) {
    // Compute area / perimeter from the projected cm-space polygon.
    const areaCm2 = polygonAreaPx2(polyCm);
    let perimeterCm = 0;
    for (let i = 0; i < polyCm.length; i++) {
      perimeterCm += pixelDistance(polyCm[i], polyCm[(i + 1) % polyCm.length]);
    }
    result.perimeter.cm = round(perimeterCm, 2);
    result.perimeter.ft = round(perimeterCm / CM_PER_FOOT, 3);
    result.perimeter.m  = round(perimeterCm / 100, 3);
    result.area.cm2 = round(areaCm2, 2);
    result.area.ft2 = round(areaCm2 / SQCM_PER_SQFOOT, 3);
    result.area.m2  = round(areaCm2 / 10000, 4);
    // Expose the cm-space vertices so downstream gates (Phase 3 polygon
    // validation, Monte-Carlo cross-check) can run in real units.
    result.polygonCm = polyCm.map((p) => ({ x: round(p.x, 4), y: round(p.y, 4) }));
  } else if (calibrated) {
    const perimeterCm = perimeterPx / pxPerCm;
    const areaCm2 = areaPx2 / (pxPerCm * pxPerCm);
    result.perimeter.cm = round(perimeterCm, 2);
    result.perimeter.ft = round(perimeterCm / CM_PER_FOOT, 3);
    result.perimeter.m  = round(perimeterCm / 100, 3);
    result.area.cm2 = round(areaCm2, 2);
    result.area.ft2 = round(areaCm2 / SQCM_PER_SQFOOT, 3);
    result.area.m2  = round(areaCm2 / 10000, 4);
  }
  return result;
}

module.exports = {
  pixelDistance,
  pixelsPerCm,
  polygonAreaPx2,
  polygonPerimeterPx,
  measurePolygon,
  computeHomography,
  applyHomography,
  homographyFromRectangle,
  solveLinearSystem,
  round,
  CM_PER_FOOT,
  SQCM_PER_SQFOOT,
};
