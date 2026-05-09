'use strict';

/**
 * Camera intrinsics & lens undistortion.
 *
 * Pinhole camera model:
 *
 *     [u]   [fx  0  cx] [X/Z]
 *     [v] = [ 0 fy  cy] [Y/Z]
 *     [1]   [ 0  0   1] [ 1 ]
 *
 * Distortion (Brown–Conrady, radial + tangential):
 *
 *   x'  =  x · (1 + k1 r² + k2 r⁴ + k3 r⁶) + 2 p1 x y + p2 (r² + 2 x²)
 *   y'  =  y · (1 + k1 r² + k2 r⁴ + k3 r⁶) + p1 (r² + 2 y²) + 2 p2 x y
 *
 * where (x, y) are normalised image coords  x = (u − cx)/fx ,  y = (v − cy)/fy
 * and (x', y') is the distorted normalised coord that the camera actually
 * records on the sensor.
 *
 * To MEASURE accurately we need the inverse: given a pixel that the camera
 * recorded (distorted), recover the pinhole-ideal pixel that geometric math
 * (homography, line distances) assumes. There is no closed-form inverse for
 * Brown–Conrady, so we use fixed-point iteration — converges in 5–10 steps
 * for any sane camera.
 *
 * IMPORTANT — honest defaults:
 *
 *   We do NOT have distortion coefficients in EXIF (they are not standard
 *   EXIF tags). Modern phone main cameras already apply lens correction in
 *   the ISP, so residual distortion is typically < 0.3 % — well below our
 *   ±1 % accuracy goal. We therefore default k1 = k2 = p1 = p2 = 0 (identity
 *   undistortion = no change) and ONLY warn when the FOV puts us in the
 *   high-risk zone (ultra-wide lens, FOV > 95°). This is intentional: a
 *   guessed correction can be worse than no correction at all.
 */

// 35 mm film "Full Frame" sensor width — the reference for FocalLengthIn35mmFilm
const FILM_35MM_WIDTH = 36; // mm

const ZERO_DISTORTION = { k1: 0, k2: 0, p1: 0, p2: 0, k3: 0 };

function deg(rad) { return (rad * 180) / Math.PI; }

/**
 * Derive a horizontal field-of-view in degrees from a 35mm-equivalent
 * focal length. Uses the standard pinhole formula: FOV = 2·atan(W / (2f)).
 */
function fovDegFrom35mm(focalEquiv35mm) {
  if (!Number.isFinite(focalEquiv35mm) || focalEquiv35mm <= 0) return null;
  return 2 * deg(Math.atan(FILM_35MM_WIDTH / (2 * focalEquiv35mm)));
}

/**
 * Build a camera intrinsics matrix K from image dimensions + EXIF.
 *
 * Strategy:
 *   1. If FocalLengthIn35mmFilm is present (most reliable cross-device):
 *        FOV_x = 2·atan(36 / (2·f35))
 *        fx = (W/2) / tan(FOV_x/2)
 *   2. Otherwise fall back to a typical phone FOV of 70° as a last resort
 *      (better than nothing — square pixels assumption).
 *   3. cx, cy = principal point at image centre (good enough; off-centre
 *      principal point is usually < 1 % of the image and within our budget).
 *
 * @param {{
 *   width: number, height: number,
 *   focalLengthIn35mmFilm?: number|null,
 *   focalLengthMm?: number|null,
 * }} meta
 * @returns {{
 *   fx: number, fy: number, cx: number, cy: number,
 *   fovDeg: number, source: 'exif35'|'fallback', focalEquiv35mm: number|null,
 * }}
 */
function intrinsicsFromExif(meta) {
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error('intrinsicsFromExif: width/height required');

  let fovDeg;
  let source;
  let f35 = meta.focalLengthIn35mmFilm ?? null;

  if (f35 != null && Number.isFinite(f35) && f35 > 0) {
    fovDeg = fovDegFrom35mm(f35);
    source = 'exif35';
  } else {
    // Conservative default: 70° horizontal FOV is the typical "main" camera
    // on phones from 2018+. Wider lenses will report f35 in EXIF and hit the
    // accurate branch above.
    fovDeg = 70;
    source = 'fallback';
  }

  const fx = (W / 2) / Math.tan((fovDeg / 2) * Math.PI / 180);
  // Phone sensors have square pixels — fy = fx is correct to within 0.1 %.
  const fy = fx;
  const cx = W / 2;
  const cy = H / 2;

  return { fx, fy, cx, cy, fovDeg, source, focalEquiv35mm: f35 };
}

/**
 * Risk classification for lens-induced error, given the intrinsics' FOV.
 *   green  : FOV ≤ 80°      (typical main camera, ISP-corrected, residual < 0.5 %)
 *   amber  : 80 < FOV ≤ 95° (wide lens — caution near image edges)
 *   red    : FOV > 95°       (ultra-wide — uncorrected residual can exceed 2 %)
 */
function lensRiskFromFov(fovDeg) {
  if (!Number.isFinite(fovDeg)) return 'amber';
  if (fovDeg <= 80) return 'green';
  if (fovDeg <= 95) return 'amber';
  return 'red';
}

/**
 * Forward Brown–Conrady: pinhole-ideal normalised (x, y) → distorted (x', y').
 */
function distortNormalised(x, y, d) {
  const k1 = d.k1 || 0;
  const k2 = d.k2 || 0;
  const k3 = d.k3 || 0;
  const p1 = d.p1 || 0;
  const p2 = d.p2 || 0;
  const r2 = x * x + y * y;
  const r4 = r2 * r2;
  const r6 = r4 * r2;
  const radial = 1 + k1 * r2 + k2 * r4 + k3 * r6;
  const dx = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
  const dy = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
  return { x: x * radial + dx, y: y * radial + dy };
}

/**
 * Inverse Brown–Conrady via fixed-point iteration.
 * Given a distorted normalised coord, find the pinhole-ideal one.
 * Converges in 5–10 iterations for k1 in [-0.5, 0.5].
 */
function undistortNormalised(xd, yd, d, maxIter = 12) {
  // Identity short-circuit when no distortion is configured.
  if (!d || (d.k1 === 0 && d.k2 === 0 && d.k3 === 0 && d.p1 === 0 && d.p2 === 0)) {
    return { x: xd, y: yd };
  }
  let x = xd;
  let y = yd;
  for (let i = 0; i < maxIter; i++) {
    const { x: xt, y: yt } = distortNormalised(x, y, d);
    const ex = xd - xt;
    const ey = yd - yt;
    x += ex;
    y += ey;
    if (Math.abs(ex) + Math.abs(ey) < 1e-10) break;
  }
  return { x, y };
}

/**
 * Undistort a single pixel point.
 *   K = { fx, fy, cx, cy }
 *   D = { k1, k2, k3, p1, p2 } (any missing keys default to 0)
 */
function undistortPoint(p, K, D) {
  // Identity short-circuit. Saves lots of work when D is the default.
  if (!D || (D.k1 === 0 && D.k2 === 0 && D.k3 === 0 && D.p1 === 0 && D.p2 === 0)) {
    return { x: p.x, y: p.y };
  }
  const xd = (p.x - K.cx) / K.fx;
  const yd = (p.y - K.cy) / K.fy;
  const { x, y } = undistortNormalised(xd, yd, D);
  return { x: x * K.fx + K.cx, y: y * K.fy + K.cy };
}

/**
 * Map an array of pixel points through the undistortion. Returns a fresh
 * array — never mutates input.
 */
function undistortPoints(points, K, D) {
  return points.map((p) => undistortPoint(p, K, D));
}

module.exports = {
  intrinsicsFromExif,
  lensRiskFromFov,
  fovDegFrom35mm,
  distortNormalised,
  undistortNormalised,
  undistortPoint,
  undistortPoints,
  ZERO_DISTORTION,
  FILM_35MM_WIDTH,
};
