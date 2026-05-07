'use strict';

/**
 * End-to-end smoke test against a running API on localhost:4000.
 * Generates a synthetic 1000x1000 PNG, uploads it with fake GPS, calibrates
 * to 1 px/cm, measures a 500x300 px rectangle, and asserts the result.
 *
 * Run with the server already running:  node test/e2e-smoke.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const BASE = process.env.API_BASE || 'http://localhost:4000';
const KEY = process.env.API_KEY || 'dev-local-key-change-me';

const headers = { 'x-api-key': KEY };

async function main() {
  // 1. build a synthetic 1000x1000 black PNG
  const buf = await sharp({
    create: { width: 1000, height: 1000, channels: 3, background: { r: 30, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();

  const tmp = path.join(os.tmpdir(), `painterapp-smoke-${Date.now()}.png`);
  fs.writeFileSync(tmp, buf);

  // 2. upload
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/png' }), 'smoke.png');
  form.append('latitude', '19.0760');
  form.append('longitude', '72.8777');
  form.append('altitude', '14');
  form.append('deviceInfo', 'smoke-test');

  const uploadRes = await fetch(`${BASE}/api/v1/captures`, { method: 'POST', headers, body: form });
  if (!uploadRes.ok) throw new Error(`upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  const { capture } = await uploadRes.json();
  console.log('[1/3] uploaded:', capture.id, capture.width, 'x', capture.height,
    'gps:', capture.location.latitude, capture.location.longitude, 'src:', capture.location.source);

  // 3. calibrate — 100 px line → declare it 100 cm → pxPerCm = 1
  const calRes = await fetch(`${BASE}/api/v1/captures/${capture.id}/calibrate`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 },
      realLength: 100, unit: 'cm',
    }),
  });
  if (!calRes.ok) throw new Error(`calibrate failed: ${calRes.status} ${await calRes.text()}`);
  const cal = await calRes.json();
  console.log('[2/3] calibrated: pxPerCm =', cal.pxPerCm);
  if (Math.abs(cal.pxPerCm - 1) > 1e-6) throw new Error('expected pxPerCm = 1');

  // 4. measure — 500x300 rectangle = 150_000 cm² = 15 m²
  const polygon = [
    { x: 100, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 400 }, { x: 100, y: 400 },
  ];
  const mRes = await fetch(`${BASE}/api/v1/captures/${capture.id}/measure`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ polygon }),
  });
  if (!mRes.ok) throw new Error(`measure failed: ${mRes.status} ${await mRes.text()}`);
  const { measurement } = await mRes.json();
  console.log('[3/3] measured: area cm² =', measurement.area.cm2, 'm² =', measurement.area.m2,
    '   perimeter cm =', measurement.perimeter.cm);

  if (measurement.area.cm2 !== 150000) throw new Error(`expected 150000 cm², got ${measurement.area.cm2}`);
  if (measurement.area.m2 !== 15) throw new Error(`expected 15 m², got ${measurement.area.m2}`);
  if (measurement.perimeter.cm !== 1600) throw new Error(`expected 1600 cm, got ${measurement.perimeter.cm}`);
  if (measurement.location.latitude !== 19.076) throw new Error('lat mismatch');

  // 5. cleanup
  await fetch(`${BASE}/api/v1/captures/${capture.id}`, { method: 'DELETE', headers });
  fs.unlinkSync(tmp);

  console.log('\nOK — end-to-end smoke test passed.');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
