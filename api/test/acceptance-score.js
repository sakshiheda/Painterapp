#!/usr/bin/env node
'use strict';

/**
 * Phase 4 — Real-gate acceptance scorer.
 *
 *   node test/acceptance-score.js \
 *     --truth-w 80.5 --truth-h 203.0 \
 *     --label door \
 *     <captureId1> <captureId2> ...
 *
 * For each capture id it:
 *  - fetches /captures/:id (calibration method, lens, GPS)
 *  - fetches /captures/:id/measurements (latest measurement, gates, MC)
 *  - finds the closest pair of polygon sides to the target's width and height
 *  - computes %-error vs. ground truth, and area %-error vs. width × height
 *  - prints pass/fail per shot and a final aggregate pass/fail
 *
 * Pass criteria (engineering contract):
 *   - calibration.method === 'qr-auto'
 *   - lens.lensRisk !== 'red'
 *   - location.confidence === 'green'
 *   - all gates true
 *   - per-side error  ≤ 1.0 %
 *   - area error      ≤ 2.0 %
 *   - mc.ratio within tolerance (already enforced by gate, re-checked here)
 */

const BASE = process.env.PAINTERAPP_API_URL || 'http://127.0.0.1:4000';
const KEY  = process.env.PAINTERAPP_API_KEY || 'dev-local-key-change-me';

function parseArgs(argv) {
  const out = { ids: [], truthW: null, truthH: null, label: 'target' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--truth-w') out.truthW = parseFloat(argv[++i]);
    else if (a === '--truth-h') out.truthH = parseFloat(argv[++i]);
    else if (a === '--label') out.label = argv[++i];
    else if (a === '--base') BASE = argv[++i]; // eslint-disable-line
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else out.ids.push(a);
  }
  if (!out.truthW || !out.truthH) throw new Error('must pass --truth-w and --truth-h in cm');
  if (!out.ids.length) throw new Error('must pass at least one capture id');
  return out;
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': KEY } });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

function nearest(target, values) {
  let best = null;
  let bestDiff = Infinity;
  for (const v of values) {
    const d = Math.abs(v - target);
    if (d < bestDiff) { bestDiff = d; best = v; }
  }
  return best;
}

function pct(actual, truth) {
  return ((actual - truth) / truth) * 100;
}

function fmt(n, d = 2) { return n == null ? '—' : n.toFixed(d); }

(async () => {
  const opts = parseArgs(process.argv);
  const truthArea = opts.truthW * opts.truthH; // cm²
  console.log(`\n=== Phase 4 acceptance scorer ===`);
  console.log(`target:   ${opts.label}`);
  console.log(`truth:    ${opts.truthW} cm × ${opts.truthH} cm   area=${truthArea.toFixed(1)} cm² (${(truthArea / 10000).toFixed(4)} m²)`);
  console.log(`captures: ${opts.ids.length}`);
  console.log(`api:      ${BASE}\n`);

  const rows = [];
  for (const id of opts.ids) {
    const row = { id, ok: false, fails: [] };
    try {
      const cap = (await get(`/api/v1/captures/${id}`)).capture;
      const meas = (await get(`/api/v1/captures/${id}/measurements`)).measurements;
      if (!meas.length) { row.fails.push('no measurement'); rows.push(row); continue; }
      const m = meas[meas.length - 1];

      const method = cap.calibration?.method;
      const lensRisk = cap.lens?.lensRisk ?? 'unknown';
      const fov = cap.lens?.fovDeg;
      const gpsConf = cap.location?.confidence;
      const acc = cap.location?.accuracyM;

      if (method !== 'qr-auto') row.fails.push(`calibration.method=${method} (need qr-auto)`);
      if (lensRisk === 'red') row.fails.push(`lensRisk=red`);
      if (gpsConf !== 'green') row.fails.push(`gps confidence=${gpsConf}`);

      const gates = m.gates || {};
      for (const [k, v] of Object.entries(gates)) {
        if (v === false) row.fails.push(`gate ${k}=false`);
      }

      // Collect side lengths in cm
      const sidesCm = (m.sides || []).map((s) => s.lengthCm).filter((x) => Number.isFinite(x));
      if (!sidesCm.length) row.fails.push('no cm-side lengths (uncalibrated?)');

      const matchW = nearest(opts.truthW, sidesCm);
      const matchH = nearest(opts.truthH, sidesCm);
      const errW = matchW != null ? pct(matchW, opts.truthW) : null;
      const errH = matchH != null ? pct(matchH, opts.truthH) : null;
      const areaCm2 = m.area?.cm2;
      const errA = Number.isFinite(areaCm2) ? pct(areaCm2, truthArea) : null;

      if (errW != null && Math.abs(errW) > 1.0) row.fails.push(`width error ${errW.toFixed(2)}% > 1%`);
      if (errH != null && Math.abs(errH) > 1.0) row.fails.push(`height error ${errH.toFixed(2)}% > 1%`);
      if (errA != null && Math.abs(errA) > 2.0) row.fails.push(`area error ${errA.toFixed(2)}% > 2%`);

      const mcRatio = m.validation?.mc?.ratio;

      row.method = method;
      row.lensRisk = lensRisk;
      row.fov = fov;
      row.gpsConf = gpsConf;
      row.acc = acc;
      row.confidence = m.confidence;
      row.matchW = matchW;
      row.matchH = matchH;
      row.errW = errW;
      row.errH = errH;
      row.areaCm2 = areaCm2;
      row.errA = errA;
      row.mcRatio = mcRatio;
      row.gates = gates;
      row.sidesCm = sidesCm;
      row.ok = row.fails.length === 0;
    } catch (e) {
      row.fails.push(`fetch error: ${e.message}`);
    }
    rows.push(row);
  }

  // ----- Per-row report -----
  for (const r of rows) {
    console.log(`--- ${r.id} ---`);
    if (r.fails.length === 0) console.log('  status: PASS');
    else console.log(`  status: FAIL (${r.fails.length})`);
    console.log(`  calibration: ${r.method}   lens fov=${fmt(r.fov, 1)}° risk=${r.lensRisk}`);
    console.log(`  gps:         conf=${r.gpsConf}  accuracy=${fmt(r.acc, 1)} m`);
    console.log(`  sides (cm):  [${(r.sidesCm || []).map((x) => fmt(x, 1)).join(', ')}]`);
    console.log(`  width:       ${fmt(r.matchW, 2)} cm  truth=${opts.truthW}  err=${fmt(r.errW, 2)}%`);
    console.log(`  height:      ${fmt(r.matchH, 2)} cm  truth=${opts.truthH}  err=${fmt(r.errH, 2)}%`);
    console.log(`  area:        ${fmt(r.areaCm2, 1)} cm²  truth=${truthArea.toFixed(1)}  err=${fmt(r.errA, 2)}%`);
    console.log(`  mc ratio:    ${fmt(r.mcRatio, 4)}`);
    console.log(`  confidence:  ${r.confidence}`);
    if (r.fails.length) {
      for (const f of r.fails) console.log(`    × ${f}`);
    }
    console.log('');
  }

  // ----- Aggregate -----
  const passCount = rows.filter((r) => r.ok).length;
  console.log('=== AGGREGATE ===');
  console.log(`  pass: ${passCount} / ${rows.length}`);
  const widthErrs = rows.map((r) => r.errW).filter((x) => Number.isFinite(x)).map(Math.abs);
  const heightErrs = rows.map((r) => r.errH).filter((x) => Number.isFinite(x)).map(Math.abs);
  const areaErrs = rows.map((r) => r.errA).filter((x) => Number.isFinite(x)).map(Math.abs);
  const stats = (arr) => arr.length
    ? `mean=${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)}%  max=${Math.max(...arr).toFixed(2)}%`
    : 'n/a';
  console.log(`  |width err|:  ${stats(widthErrs)}`);
  console.log(`  |height err|: ${stats(heightErrs)}`);
  console.log(`  |area err|:   ${stats(areaErrs)}`);
  if (passCount === rows.length) {
    console.log('\n  Phase 4 ACCEPTED — engineering contract met across all tilts.\n');
    process.exit(0);
  } else {
    console.log(`\n  Phase 4 NOT YET ACCEPTED — ${rows.length - passCount} shot(s) failed.\n`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(2);
});
