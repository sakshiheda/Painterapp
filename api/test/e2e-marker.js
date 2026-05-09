'use strict';

/**
 * Phase 2 end-to-end live test:
 *   1. Render a real QR encoding "painterapp:marker:v1:100" onto a 1500x1500
 *      synthetic image (printed at 400 px = 100 mm side).
 *   2. Upload to the API with good GPS.
 *   3. Assert the upload response carries marker.found=true AND the capture's
 *      calibration.method === 'qr-auto' (no manual step needed).
 *   4. Re-measure the marker corners themselves — must be exactly 100 mm²
 *      (= 100 cm²) within numerical noise.
 *   5. Verify the printable PDF endpoint returns a sane PDF.
 *
 * Run with:  node test/e2e-marker.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const QRCode = require('qrcode');

const BASE = process.env.API_BASE || 'http://localhost:4000';
const KEY = process.env.API_KEY || 'dev-local-key-change-me';
const headers = { 'x-api-key': KEY };

async function buildSyntheticQrImage({ payload, qrSizePx, x, y, canvas }) {
  const qr = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'H', margin: 0, scale: 16,
  });
  const qrPng = await sharp(qr).resize(qrSizePx, qrSizePx, { kernel: 'nearest' }).png().toBuffer();
  return sharp({
    create: { width: canvas, height: canvas, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: qrPng, left: x, top: y }])
    .png()
    .toBuffer();
}

async function uploadWithGoodGps(buf) {
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/png' }), 'qr-test.png');
  form.append('latitude', '19.0760');
  form.append('longitude', '72.8777');
  form.append('accuracyM', '4.0');
  form.append('mocked', 'false');
  form.append('gpsFixCount', '3');
  form.append('deviceInfo', 'phase2-marker-test');
  const res = await fetch(`${BASE}/api/v1/captures`, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function measure(captureId, polygon) {
  const res = await fetch(`${BASE}/api/v1/captures/${captureId}/measure`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ polygon }),
  });
  if (!res.ok) throw new Error(`measure failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function deleteCapture(id) {
  await fetch(`${BASE}/api/v1/captures/${id}`, { method: 'DELETE', headers });
}

async function main() {
  // ---- 1. QR auto-detected on upload ----
  console.log('--- A. upload with QR present → auto-calibrates ---');
  const qrImg = await buildSyntheticQrImage({
    payload: 'painterapp:marker:v1:100',
    qrSizePx: 400,
    x: 300, y: 250,
    canvas: 1500,
  });
  const { capture, marker } = await uploadWithGoodGps(qrImg);
  console.log('uploaded:', capture.id, 'method=', capture.calibration?.method,
    'marker.found=', marker.found, 'sidePx=', marker.sidePx?.toFixed(1));
  if (!marker.found) throw new Error('expected marker.found=true');
  if (capture.calibration?.method !== 'qr-auto') {
    throw new Error(`expected qr-auto, got ${capture.calibration?.method}`);
  }
  // The 4 corners stored on the capture must be the QR's 4 corners.
  const c = capture.calibration.corners;
  const polygon = [c.tl, c.tr, c.br, c.bl];
  const { measurement } = await measure(capture.id, polygon);
  // Marker is 100 mm = 10 cm side → area should be 100 cm² (= 0.01 m²).
  // We allow ±2 cm² (2%) tolerance for the small sub-pixel corner noise.
  console.log('self-measure: area cm² =', measurement.area.cm2, ' m² =', measurement.area.m2,
    ' perimeter cm =', measurement.perimeter.cm, ' confidence=', measurement.confidence);
  const dev = Math.abs(measurement.area.cm2 - 100);
  if (dev > 2) throw new Error(`area ${measurement.area.cm2} cm² off by ${dev} cm² (>2)`);
  if (measurement.confidence !== 'green') throw new Error('expected green confidence');

  await deleteCapture(capture.id);
  console.log('A: OK');

  // ---- 2. No QR present → marker.found=false, capture still usable ----
  console.log('\n--- B. upload without QR → falls back to manual ---');
  const blank = await sharp({
    create: { width: 1000, height: 1000, channels: 3, background: { r: 240, g: 240, b: 240 } },
  }).png().toBuffer();
  const noMarker = await uploadWithGoodGps(blank);
  if (noMarker.marker.found !== false) throw new Error('expected marker.found=false');
  if (noMarker.capture.calibration != null) {
    throw new Error('expected no calibration on a no-marker capture');
  }
  console.log('uploaded:', noMarker.capture.id, 'marker.found=false reason=', noMarker.marker.reason);
  await deleteCapture(noMarker.capture.id);
  console.log('B: OK');

  // ---- 3. Printable PDF endpoint ----
  console.log('\n--- C. /marker.pdf returns a valid PDF ---');
  const pdfRes = await fetch(`${BASE}/api/v1/marker.pdf?sizeMm=100`, { headers });
  if (!pdfRes.ok) throw new Error(`pdf failed: ${pdfRes.status}`);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  if (pdfBuf.slice(0, 4).toString() !== '%PDF') {
    throw new Error(`expected %PDF header, got ${pdfBuf.slice(0, 8).toString()}`);
  }
  console.log('pdf bytes =', pdfBuf.length, ' header ok');
  console.log('C: OK');

  console.log('\nOK — Phase 2 marker pipeline passed (3/3 scenarios).');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
