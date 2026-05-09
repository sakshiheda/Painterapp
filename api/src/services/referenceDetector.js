'use strict';

/**
 * Reference object detector — Tier B.
 *
 * Scans an uploaded image for a reference object whose real-world size is
 * known from the catalog, then returns the four corners + the reference's
 * canonical dimensions. The corners feed directly into the same homography
 * pipeline that Tier C (QR) uses, so /measure cares only about *how* scale
 * was obtained, not *which* detector found it.
 *
 * Architecture:
 *
 *     detectReferences(filePath)
 *         │
 *         ├──> tries each enabled detector in priority order
 *         │       1. QR  (handled separately by services/marker.js)
 *         │       2. Paper rectangle (A4 / US Letter)        <- this file
 *         │       3. Card  (credit / debit, ID-1)            <- TODO Phase 7.2
 *         │       4. Wall plate (IN / EU outlet)             <- TODO Phase 7.3
 *         │
 *         └──> returns the highest-confidence match, or { found: false }
 *
 * Detectors are pure functions of the image bytes — no model files in this
 * shipping unit. The paper detector uses Otsu thresholding + connected
 * components, which is cheap and deterministic. ML-based detectors (YOLO
 * via onnxruntime-node) plug into the same `Detector` shape later.
 */

const sharp = require('sharp');
const { getReferenceById } = require('./referenceCatalog');

// Down-scale for speed. A 4000×3000 phone photo is overkill for this
// detector; 800-wide is plenty to localise a sheet of paper, and ~50×
// faster.
const DOWNSCALE_WIDTH = 800;

// Confidence floor below which we refuse a match — better to fall through
// to QR than silently use a poor reference.
const MIN_CONFIDENCE = 0.55;

// ---------------------------------------------------------------------------
// Otsu's method — picks an optimal binary threshold given a grayscale
// histogram. Returns a value in 0..255. Standard textbook implementation.
// ---------------------------------------------------------------------------
function otsuThreshold(hist, totalPixels) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let varMax = -1;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = totalPixels - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > varMax) {
      varMax = between;
      threshold = t;
    }
  }
  return threshold;
}

// ---------------------------------------------------------------------------
// Find the largest connected bright region using simple BFS flood-fill.
// We expect the user's paper sheet to dominate one bright blob. Returns
// the blob's pixel set as a packed Uint32Array of (y * width + x).
// ---------------------------------------------------------------------------
function largestBrightBlob(binary, width, height) {
  const visited = new Uint8Array(width * height);
  let bestSize = 0;
  let bestPixels = null;

  // Stack-based flood fill with 4-connectivity. We push integer indices
  // into a single Int32Array to avoid GC churn on huge blobs.
  const stack = new Int32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !binary[idx]) continue;

      const blob = [];
      let sp = 0;
      stack[sp++] = idx;
      visited[idx] = 1;

      while (sp > 0) {
        const p = stack[--sp];
        blob.push(p);
        const px = p % width;
        const py = (p - px) / width;

        if (px > 0) {
          const n = p - 1;
          if (!visited[n] && binary[n]) { visited[n] = 1; stack[sp++] = n; }
        }
        if (px < width - 1) {
          const n = p + 1;
          if (!visited[n] && binary[n]) { visited[n] = 1; stack[sp++] = n; }
        }
        if (py > 0) {
          const n = p - width;
          if (!visited[n] && binary[n]) { visited[n] = 1; stack[sp++] = n; }
        }
        if (py < height - 1) {
          const n = p + width;
          if (!visited[n] && binary[n]) { visited[n] = 1; stack[sp++] = n; }
        }
      }

      if (blob.length > bestSize) {
        bestSize = blob.length;
        bestPixels = new Uint32Array(blob);
      }
    }
  }

  return bestPixels;
}

// ---------------------------------------------------------------------------
// Given a blob, find its 4 extreme corners (top-left, top-right, bottom-right,
// bottom-left) using the projection on diagonal axes — robust for axis-aligned
// AND moderately rotated rectangles.
// ---------------------------------------------------------------------------
function blobCorners(pixels, width) {
  let minSum = Infinity, maxSum = -Infinity;
  let minDiff = Infinity, maxDiff = -Infinity;
  let pTL = 0, pBR = 0, pTR = 0, pBL = 0;

  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const x = p % width;
    const y = (p - x) / width;
    const sum = x + y;
    const diff = x - y;
    if (sum < minSum)  { minSum = sum;  pTL = p; }   // smallest x+y → top-left
    if (sum > maxSum)  { maxSum = sum;  pBR = p; }   // largest x+y → bottom-right
    if (diff > maxDiff){ maxDiff = diff; pTR = p; }  // largest x-y → top-right
    if (diff < minDiff){ minDiff = diff; pBL = p; }  // smallest x-y → bottom-left
  }

  function unpack(p) {
    const x = p % width;
    const y = (p - x) / width;
    return { x, y };
  }

  return {
    tl: unpack(pTL),
    tr: unpack(pTR),
    br: unpack(pBR),
    bl: unpack(pBL),
  };
}

// ---------------------------------------------------------------------------
// Match the detected quad against the catalog by aspect ratio. Returns the
// reference id whose aspect best matches, or null if none is within
// tolerance. Aspect is computed as longSide / shortSide so orientation
// doesn't matter.
// ---------------------------------------------------------------------------
function matchAspect(corners, candidates) {
  const dx1 = corners.tr.x - corners.tl.x;
  const dy1 = corners.tr.y - corners.tl.y;
  const dx2 = corners.bl.x - corners.tl.x;
  const dy2 = corners.bl.y - corners.tl.y;
  const sideA = Math.hypot(dx1, dy1);
  const sideB = Math.hypot(dx2, dy2);
  if (sideA === 0 || sideB === 0) return null;

  const observed = Math.max(sideA, sideB) / Math.min(sideA, sideB);

  let best = null;
  for (const ref of candidates) {
    if (ref.widthMm == null || ref.heightMm == null) continue;
    const expected = Math.max(ref.widthMm, ref.heightMm) /
                     Math.min(ref.widthMm, ref.heightMm);
    const err = Math.abs(observed - expected) / expected;
    if (err > ref.aspectTolerance) continue;
    if (!best || err < best.err) best = { ref, err, observed, expected };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Top-level paper detector. Looks for one large bright rectangle that
// matches A4 (or, for `region: 'US'`, US Letter).
// ---------------------------------------------------------------------------
async function detectPaper(filePath) {
  const meta = await sharp(filePath).metadata();
  if (!meta.width || !meta.height) {
    return { found: false, reason: 'no_dimensions' };
  }

  const targetW = Math.min(DOWNSCALE_WIDTH, meta.width);
  const scale = meta.width / targetW;

  // Grayscale + downscale in one pass.
  const { data, info } = await sharp(filePath)
    .resize({ width: targetW })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const N = W * H;

  // Build histogram → Otsu threshold.
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) hist[data[i]]++;
  const t = otsuThreshold(hist, N);

  // Threshold to binary; keep only the *brighter* class (paper, not background).
  // Mean of >threshold class tells us if the bright pixels are actually bright
  // (avoid e.g. a light grey wall fooling us into a sky-coloured "paper").
  const binary = new Uint8Array(N);
  let brightCount = 0;
  let brightSum = 0;
  for (let i = 0; i < N; i++) {
    if (data[i] > t) {
      binary[i] = 1;
      brightCount++;
      brightSum += data[i];
    }
  }
  if (brightCount === 0) return { found: false, reason: 'no_bright_pixels' };
  const brightMean = brightSum / brightCount;

  // Reject scenes where the "bright" class is itself dim — typical of
  // overexposed background, no paper present.
  if (brightMean < 180) {
    return { found: false, reason: 'bright_class_too_dim', brightMean: Math.round(brightMean) };
  }

  // Largest bright blob — should be the paper.
  const blob = largestBrightBlob(binary, W, H);
  if (!blob) return { found: false, reason: 'no_blob' };

  // A real piece of paper occupies a meaningful chunk of the frame. We
  // require ≥1.5 % of pixels (a credit-card-sized paper at arm's length
  // is roughly that). Anything smaller is probably a light glint.
  const fraction = blob.length / N;
  if (fraction < 0.015) {
    return { found: false, reason: 'blob_too_small', fraction: Number(fraction.toFixed(4)) };
  }

  const corners = blobCorners(blob, W);

  // Aspect ratio check — A4 is √2 ≈ 1.414, Letter ≈ 1.294.
  // We accept any catalog 'paper-rectangle' whose aspect tolerance covers
  // the observation. ISO/US picked by best fit, not by region (a US user
  // can still place an A4 sheet in frame).
  const candidates = [
    getReferenceById('a4-paper'),
    getReferenceById('us-letter'),
  ].filter(Boolean);
  const matched = matchAspect(corners, candidates);
  if (!matched) {
    return { found: false, reason: 'aspect_mismatch', corners };
  }

  // Confidence: combine aspect agreement (1 - err / tolerance) with
  // blob fill ratio (rectangular blobs fill their bbox; squiggly blobs
  // don't). Both are in [0, 1].
  const aspectScore = Math.max(0, 1 - matched.err / matched.ref.aspectTolerance);
  // Bbox fill — paper rectangles fill ~95-98 % of their bbox in a clean shot.
  const minX = Math.min(corners.tl.x, corners.bl.x);
  const maxX = Math.max(corners.tr.x, corners.br.x);
  const minY = Math.min(corners.tl.y, corners.tr.y);
  const maxY = Math.max(corners.bl.y, corners.br.y);
  const bboxArea = Math.max(1, (maxX - minX) * (maxY - minY));
  const fillScore = Math.min(1, blob.length / bboxArea);
  const confidence = 0.6 * aspectScore + 0.4 * fillScore;

  if (confidence < MIN_CONFIDENCE) {
    return {
      found: false,
      reason: 'low_confidence',
      confidence: Number(confidence.toFixed(3)),
      aspectScore: Number(aspectScore.toFixed(3)),
      fillScore: Number(fillScore.toFixed(3)),
    };
  }

  // Scale corners back up to original image coordinates for downstream
  // homography solving.
  function up(p) { return { x: p.x * scale, y: p.y * scale }; }

  return {
    found: true,
    referenceId: matched.ref.id,
    tier: matched.ref.tier,
    kind: matched.ref.kind,
    label: matched.ref.label,
    widthMm: matched.ref.widthMm,
    heightMm: matched.ref.heightMm,
    corners: { tl: up(corners.tl), tr: up(corners.tr), br: up(corners.br), bl: up(corners.bl) },
    confidence: Number(confidence.toFixed(3)),
    detectorVersion: 'paper-otsu-v1',
    threshold: t,
    brightMean: Math.round(brightMean),
    fillRatio: Number(fillScore.toFixed(3)),
    aspectError: Number(matched.err.toFixed(4)),
    imageWidth: meta.width,
    imageHeight: meta.height,
  };
}

/**
 * Run all enabled Tier B detectors and return the best match.
 *
 * Order matters: paper is the most reliable geometric detector, so we try
 * it first. Future detectors (cards, outlets, plates) are added here in
 * decreasing priority. Caller can also pass `{ skip: ['paper'] }` to opt
 * out of specific detectors during testing.
 */
async function detectReferences(filePath, opts = {}) {
  const skip = new Set(opts.skip || []);
  const tried = [];

  if (!skip.has('paper')) {
    const r = await detectPaper(filePath);
    tried.push({ detector: 'paper', ...r });
    if (r.found) return { found: true, match: r, tried };
  }

  // Phase 7.2 / 7.3 — when YOLO-backed detectors land, try them here.

  return { found: false, tried };
}

module.exports = {
  detectReferences,
  detectPaper,
  // exported for unit tests
  __test__: { otsuThreshold, largestBrightBlob, blobCorners, matchAspect },
};
