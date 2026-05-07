'use strict';

/**
 * Pure geometry helpers — no I/O, easy to unit-test.
 * All "px" values are image pixel coordinates (origin top-left).
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

/**
 * Build the full measurement payload.
 * @param {Array<{x:number,y:number}>} polygon
 * @param {number} pxPerCm
 */
function measurePolygon(polygon, pxPerCm) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error('Polygon must have at least 3 points');
  }
  if (!(pxPerCm > 0)) {
    throw new Error('pxPerCm must be > 0 (capture is not calibrated)');
  }

  const sides = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const px = pixelDistance(a, b);
    const cm = px / pxPerCm;
    sides.push({
      index: i,
      from: a,
      to: b,
      lengthPx: round(px, 2),
      lengthCm: round(cm, 2),
      lengthFt: round(cm / CM_PER_FOOT, 3),
      lengthM: round(cm / 100, 3),
    });
  }

  const perimeterPx = polygonPerimeterPx(polygon);
  const perimeterCm = perimeterPx / pxPerCm;

  const areaPx2 = polygonAreaPx2(polygon);
  const areaCm2 = areaPx2 / (pxPerCm * pxPerCm);

  return {
    pointCount: polygon.length,
    perimeter: {
      cm: round(perimeterCm, 2),
      ft: round(perimeterCm / CM_PER_FOOT, 3),
      m: round(perimeterCm / 100, 3),
    },
    area: {
      cm2: round(areaCm2, 2),
      ft2: round(areaCm2 / SQCM_PER_SQFOOT, 3),
      m2: round(areaCm2 / 10000, 4),
    },
    sides,
  };
}

module.exports = {
  pixelDistance,
  pixelsPerCm,
  polygonAreaPx2,
  polygonPerimeterPx,
  measurePolygon,
  round,
  CM_PER_FOOT,
  SQCM_PER_SQFOOT,
};
