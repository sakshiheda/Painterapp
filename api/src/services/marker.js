'use strict';

/**
 * Marker detection — pure-JS QR-code-as-fiducial.
 *
 * Why QR (not ArUco):
 *   - jsqr is pure JavaScript, runs anywhere Node runs, no native build.
 *   - QR finder pattern + alignment pattern give us 4 sub-pixel-good corners
 *     and an exact known physical size (the printed square).
 *   - Identical accuracy properties to an ArUco marker for our purpose:
 *     compute a homography from those 4 corners to a known X×Y mm square.
 *
 * Workflow:
 *   1. Decode image with sharp -> raw RGBA buffer
 *   2. jsqr -> location with 4 outer corners of the QR
 *   3. Refuse if the QR is too small (low pixel count = poor accuracy)
 *   4. Refuse if the decoded payload doesn't start with our prefix
 *      (so we never treat a random QR poster as a calibration target)
 *   5. Return the 4 corner points in image pixel coords + the encoded
 *      side-length-in-mm parsed from the payload.
 *
 * Payload format (encoded into the QR by /api/v1/marker.pdf):
 *
 *     painterapp:marker:v1:<sideMm>
 *
 * e.g. "painterapp:marker:v1:100" for a 100 mm square.
 */

const sharp = require('sharp');
const jsQR = require('jsqr');

// Below this side length the corner positions are not accurate enough
// to give us our ±1% dimension target. 80 px is a conservative gate
// (typical phone photo of a 100 mm marker from 1-2 m away → 200-400 px side).
const MIN_QR_SIDE_PX = 80;
const MARKER_PREFIX = 'painterapp:marker:v1:';

/**
 * Pixel distance between two {x,y} points.
 */
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Parse a payload like "painterapp:marker:v1:100" into a side-length
 * in millimetres. Returns null on any malformed input.
 */
function parseMarkerPayload(payload) {
  if (typeof payload !== 'string') return null;
  if (!payload.startsWith(MARKER_PREFIX)) return null;
  const rest = payload.slice(MARKER_PREFIX.length).trim();
  const n = Number(rest);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return null;
  return n;
}

/**
 * Detect a calibration QR marker in the given image file.
 *
 * @param {string} filePath absolute path to a JPEG/PNG/WebP file
 * @returns {Promise<
 *   | { found: true, corners: { tl, tr, br, bl }, sideMm: number, sidePx: number, payload: string, imageWidth: number, imageHeight: number }
 *   | { found: false, reason: string, payload?: string }
 * >}
 */
async function detectCalibrationMarker(filePath) {
  // Decode to raw RGBA pixels at full resolution.
  // jsqr accepts a Uint8ClampedArray with 4 bytes per pixel.
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const code = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
    { inversionAttempts: 'attemptBoth' }
  );

  if (!code) {
    return { found: false, reason: 'no_qr_in_image' };
  }

  const sideMm = parseMarkerPayload(code.data);
  if (sideMm == null) {
    return {
      found: false,
      reason: 'qr_payload_not_painterapp_marker',
      payload: code.data,
    };
  }

  // jsqr.location names the four outer corners.
  // We rename to TL/TR/BR/BL so the rest of the codebase has a
  // single consistent vocabulary. Note: which corner of the QR is
  // actually "top-left in the world" depends on the photo's
  // orientation — that does NOT matter here, because the homography
  // only needs the same labelling on both sides (image plane and
  // marker-mm plane), and our marker is square.
  const tl = code.location.topLeftCorner;
  const tr = code.location.topRightCorner;
  const br = code.location.bottomRightCorner;
  const bl = code.location.bottomLeftCorner;
  if (!tl || !tr || !br || !bl) {
    return { found: false, reason: 'qr_corners_missing', payload: code.data };
  }

  const corners = {
    tl: { x: tl.x, y: tl.y },
    tr: { x: tr.x, y: tr.y },
    br: { x: br.x, y: br.y },
    bl: { x: bl.x, y: bl.y },
  };

  // Average of the 4 sides — used both as a quality gate and for
  // a "marker too small / too far" warning.
  const sidePx = (
    dist(corners.tl, corners.tr) +
    dist(corners.tr, corners.br) +
    dist(corners.br, corners.bl) +
    dist(corners.bl, corners.tl)
  ) / 4;

  if (sidePx < MIN_QR_SIDE_PX) {
    return {
      found: false,
      reason: 'qr_too_small',
      payload: code.data,
    };
  }

  return {
    found: true,
    corners,
    sideMm,
    sidePx,
    payload: code.data,
    imageWidth: info.width,
    imageHeight: info.height,
  };
}

module.exports = {
  detectCalibrationMarker,
  parseMarkerPayload,
  MARKER_PREFIX,
  MIN_QR_SIDE_PX,
};
