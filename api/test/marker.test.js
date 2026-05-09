'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sharp = require('sharp');
const QRCode = require('qrcode');

const { detectCalibrationMarker, parseMarkerPayload, MARKER_PREFIX } =
  require('../src/services/marker');

// Compose a real QR code (rendered as a PNG buffer) onto a 1500x1500
// white background at a known location, write the result to a temp
// file. The detector should find the QR and return corners that match
// the placement to within a couple of pixels.
async function makeImageWithQr({ payload, qrSizePx = 400, x = 200, y = 200, canvas = 1500 }) {
  const qr = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'H',
    margin: 0,
    scale: 16,
  });
  // Resize the QR so the printed pixel size matches what we want
  const qrPng = await sharp(qr).resize(qrSizePx, qrSizePx, { kernel: 'nearest' }).png().toBuffer();

  const composed = await sharp({
    create: { width: canvas, height: canvas, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: qrPng, left: x, top: y }])
    .png()
    .toBuffer();

  const tmp = path.join(os.tmpdir(), `marker-test-${Date.now()}-${Math.random()}.png`);
  fs.writeFileSync(tmp, composed);
  return { filePath: tmp, expected: { x, y, qrSizePx, canvas } };
}

test('parseMarkerPayload — accepts well-formed payload', () => {
  assert.equal(parseMarkerPayload(`${MARKER_PREFIX}100`), 100);
  assert.equal(parseMarkerPayload(`${MARKER_PREFIX}50.5`), 50.5);
});

test('parseMarkerPayload — rejects unrelated QR payloads', () => {
  assert.equal(parseMarkerPayload('https://example.com'), null);
  assert.equal(parseMarkerPayload('just-some-text'), null);
  assert.equal(parseMarkerPayload(`${MARKER_PREFIX}NaN`), null);
  assert.equal(parseMarkerPayload(`${MARKER_PREFIX}-1`), null);
  assert.equal(parseMarkerPayload(`${MARKER_PREFIX}99999`), null);
});

test('detectCalibrationMarker — finds the QR and returns 4 corners', async () => {
  const { filePath, expected } = await makeImageWithQr({
    payload: `${MARKER_PREFIX}100`,
    qrSizePx: 400,
    x: 300,
    y: 250,
    canvas: 1500,
  });
  try {
    const out = await detectCalibrationMarker(filePath);
    assert.equal(out.found, true, `expected found=true, got: ${JSON.stringify(out)}`);
    assert.equal(out.sideMm, 100);
    assert.equal(out.imageWidth, expected.canvas);
    assert.equal(out.imageHeight, expected.canvas);
    // Corner positions should be within ~3 px of the placement (jsqr is
    // pixel-accurate; we resize with nearest-neighbor to keep edges crisp).
    const tol = 5;
    assert.ok(Math.abs(out.corners.tl.x - expected.x) < tol, `tl.x off: ${out.corners.tl.x}`);
    assert.ok(Math.abs(out.corners.tl.y - expected.y) < tol, `tl.y off: ${out.corners.tl.y}`);
    assert.ok(Math.abs(out.corners.br.x - (expected.x + expected.qrSizePx)) < tol, `br.x off: ${out.corners.br.x}`);
    assert.ok(Math.abs(out.corners.br.y - (expected.y + expected.qrSizePx)) < tol, `br.y off: ${out.corners.br.y}`);
    // Average side length matches the printed pixel size.
    assert.ok(Math.abs(out.sidePx - expected.qrSizePx) < tol, `sidePx off: ${out.sidePx}`);
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('detectCalibrationMarker — refuses non-painterapp QRs', async () => {
  const { filePath } = await makeImageWithQr({
    payload: 'https://example.com',
    qrSizePx: 400,
    x: 300, y: 250, canvas: 1500,
  });
  try {
    const out = await detectCalibrationMarker(filePath);
    assert.equal(out.found, false);
    assert.equal(out.reason, 'qr_payload_not_painterapp_marker');
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('detectCalibrationMarker — refuses tiny QRs (low accuracy)', async () => {
  const { filePath } = await makeImageWithQr({
    payload: `${MARKER_PREFIX}100`,
    qrSizePx: 60, // below MIN_QR_SIDE_PX = 80
    x: 100, y: 100, canvas: 800,
  });
  try {
    const out = await detectCalibrationMarker(filePath);
    assert.equal(out.found, false);
    assert.equal(out.reason, 'qr_too_small');
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('detectCalibrationMarker — returns false when no QR present', async () => {
  const tmp = path.join(os.tmpdir(), `marker-test-blank-${Date.now()}.png`);
  const blank = await sharp({
    create: { width: 800, height: 800, channels: 3, background: { r: 200, g: 200, b: 200 } },
  }).png().toBuffer();
  fs.writeFileSync(tmp, blank);
  try {
    const out = await detectCalibrationMarker(tmp);
    assert.equal(out.found, false);
    assert.equal(out.reason, 'no_qr_in_image');
  } finally {
    fs.unlinkSync(tmp);
  }
});
