'use strict';

/**
 * End-to-end smoke test against a running API on localhost:4000.
 *
 * Scenarios:
 *   A. Good GPS  → calibrate, measure, expect 200 with the correct numbers
 *                  AND confidence: 'green'.
 *   B. Bad GPS   → upload accuracyM=120, expect /measure to refuse with
 *                  HTTP 422 and error: 'gps_accuracy_low'.
 *   C. Mocked GPS→ upload mocked=true, expect /measure to refuse with
 *                  HTTP 422 and error: 'gps_mocked'.
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

async function buildSyntheticPng() {
  return sharp({
    create: { width: 1000, height: 1000, channels: 3, background: { r: 30, g: 30, b: 30 } },
  }).png().toBuffer();
}

async function uploadCapture({ buf, gps }) {
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/png' }), 'smoke.png');
  if (gps.latitude != null) form.append('latitude', String(gps.latitude));
  if (gps.longitude != null) form.append('longitude', String(gps.longitude));
  if (gps.altitude != null) form.append('altitude', String(gps.altitude));
  if (gps.accuracyM != null) form.append('accuracyM', String(gps.accuracyM));
  if (gps.altitudeAccuracyM != null) form.append('altitudeAccuracyM', String(gps.altitudeAccuracyM));
  if (gps.mocked != null) form.append('mocked', gps.mocked ? 'true' : 'false');
  if (gps.timestamp) form.append('gpsTimestamp', gps.timestamp);
  if (gps.provider) form.append('gpsProvider', gps.provider);
  if (gps.fixCount != null) form.append('gpsFixCount', String(gps.fixCount));
  form.append('deviceInfo', 'smoke-test');

  const res = await fetch(`${BASE}/api/v1/captures`, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  const { capture } = await res.json();
  return capture;
}

async function calibrateLine(captureId) {
  const res = await fetch(`${BASE}/api/v1/captures/${captureId}/calibrate`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 },
      realLength: 100, unit: 'cm',
    }),
  });
  if (!res.ok) throw new Error(`calibrate failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function measure(captureId, polygon) {
  return fetch(`${BASE}/api/v1/captures/${captureId}/measure`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ polygon }),
  });
}

async function deleteCapture(id) {
  await fetch(`${BASE}/api/v1/captures/${id}`, { method: 'DELETE', headers });
}

const polygon = [
  { x: 100, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 400 }, { x: 100, y: 400 },
];

async function scenarioGoodGps(buf) {
  console.log('\n--- A. good GPS ---');
  const capture = await uploadCapture({
    buf,
    gps: {
      latitude: 19.0760, longitude: 72.8777, altitude: 14,
      accuracyM: 4.5, altitudeAccuracyM: 6.0,
      mocked: false, timestamp: new Date().toISOString(),
      provider: 'fused', fixCount: 3,
    },
  });
  console.log('uploaded:', capture.id, 'confidence=', capture.location.confidence,
    'accuracyM=', capture.location.accuracyM, 'fixCount=', capture.location.fixCount);
  if (capture.location.confidence !== 'green') throw new Error('expected green confidence');
  if (capture.location.accuracyM !== 4.5) throw new Error('accuracyM not round-tripped');
  if (capture.location.mocked !== false) throw new Error('mocked not round-tripped');

  const cal = await calibrateLine(capture.id);
  if (Math.abs(cal.pxPerCm - 1) > 1e-6) throw new Error('expected pxPerCm = 1');

  const mRes = await measure(capture.id, polygon);
  if (!mRes.ok) throw new Error(`measure failed: ${mRes.status} ${await mRes.text()}`);
  const { measurement } = await mRes.json();
  console.log('measured:', measurement.area.cm2, 'cm² /', measurement.area.m2,
    'm² confidence=', measurement.confidence,
    'mc ratio=', measurement.validation?.mc?.ratio?.toFixed(4));
  if (measurement.area.cm2 !== 150000) throw new Error(`expected 150000 cm², got ${measurement.area.cm2}`);
  if (measurement.area.m2 !== 15) throw new Error(`expected 15 m², got ${measurement.area.m2}`);
  if (measurement.confidence !== 'green') throw new Error('expected green measurement confidence');
  if (!measurement.gates?.gpsAccuracyOk) throw new Error('expected gpsAccuracyOk gate true');
  if (!measurement.gates?.polygonSimple) throw new Error('expected polygonSimple gate true');
  if (!measurement.gates?.polygonAreaCrossCheckOk) throw new Error('expected polygonAreaCrossCheckOk gate true');

  await deleteCapture(capture.id);
  console.log('A: OK');
}

async function scenarioBadAccuracy(buf) {
  console.log('\n--- B. accuracy too low ---');
  const capture = await uploadCapture({
    buf,
    gps: {
      latitude: 19.0760, longitude: 72.8777,
      accuracyM: 120, mocked: false, fixCount: 3,
    },
  });
  console.log('uploaded:', capture.id, 'confidence=', capture.location.confidence);
  if (capture.location.confidence !== 'red') throw new Error('expected red confidence');

  await calibrateLine(capture.id); // should still work — calibration isn't gated on GPS
  const mRes = await measure(capture.id, polygon);
  if (mRes.status !== 422) throw new Error(`expected 422, got ${mRes.status}`);
  const body = await mRes.json();
  console.log('refused:', body.error, '|', body.message);
  if (body.error !== 'gps_accuracy_low') throw new Error(`expected gps_accuracy_low, got ${body.error}`);
  if (body.gates?.gpsAccuracyOk !== false) throw new Error('expected gpsAccuracyOk=false');

  await deleteCapture(capture.id);
  console.log('B: OK');
}

async function scenarioMocked(buf) {
  console.log('\n--- C. mocked GPS ---');
  const capture = await uploadCapture({
    buf,
    gps: {
      latitude: 19.0760, longitude: 72.8777,
      accuracyM: 5, mocked: true, fixCount: 3,
    },
  });
  console.log('uploaded:', capture.id, 'mocked=', capture.location.mocked,
    'confidence=', capture.location.confidence);
  if (capture.location.mocked !== true) throw new Error('mocked not stored');
  if (capture.location.confidence !== 'red') throw new Error('expected red on mocked');

  await calibrateLine(capture.id);
  const mRes = await measure(capture.id, polygon);
  if (mRes.status !== 422) throw new Error(`expected 422, got ${mRes.status}`);
  const body = await mRes.json();
  console.log('refused:', body.error, '|', body.message);
  if (body.error !== 'gps_mocked') throw new Error(`expected gps_mocked, got ${body.error}`);

  await deleteCapture(capture.id);
  console.log('C: OK');
}

async function scenarioBowtiePolygon(buf) {
  console.log('\n--- D. self-intersecting (bowtie) polygon ---');
  const capture = await uploadCapture({
    buf,
    gps: {
      latitude: 19.0760, longitude: 72.8777, altitude: 14,
      accuracyM: 4.5, mocked: false, fixCount: 3,
    },
  });
  await calibrateLine(capture.id);
  const bowtie = [
    { x: 100, y: 100 }, { x: 600, y: 400 }, { x: 600, y: 100 }, { x: 100, y: 400 },
  ];
  const mRes = await measure(capture.id, bowtie);
  if (mRes.status !== 422) throw new Error(`expected 422, got ${mRes.status}`);
  const body = await mRes.json();
  console.log('refused:', body.error, '|', body.message);
  if (body.error !== 'polygon_self_intersecting') {
    throw new Error(`expected polygon_self_intersecting, got ${body.error}`);
  }
  if (body.gates?.polygonSimple !== false) {
    throw new Error('expected polygonSimple=false');
  }
  await deleteCapture(capture.id);
  console.log('D: OK');
}

async function main() {
  const buf = await buildSyntheticPng();
  await scenarioGoodGps(buf);
  await scenarioBadAccuracy(buf);
  await scenarioMocked(buf);
  await scenarioBowtiePolygon(buf);
  console.log('\nOK — end-to-end smoke test passed (4/4 scenarios).');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
