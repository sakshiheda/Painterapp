'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  REFERENCES,
  TIER_CONTRACT,
  getReferenceById,
  listEnabledReferences,
  tierContract,
} = require('../src/services/referenceCatalog');

test('catalog is non-empty and frozen', () => {
  assert.ok(Array.isArray(REFERENCES));
  assert.ok(REFERENCES.length >= 6);
  assert.ok(Object.isFrozen(REFERENCES));
  assert.ok(Object.isFrozen(TIER_CONTRACT));
});

test('every entry has required fields', () => {
  for (const r of REFERENCES) {
    assert.equal(typeof r.id, 'string', `id missing on ${JSON.stringify(r)}`);
    // ids are slug-like: lowercase letters, digits, dashes; uppercase region
    // codes (IN/EU/US) are allowed because they're standard identifiers.
    assert.match(r.id, /^[a-zA-Z0-9-]+$/);
    assert.ok(['S', 'A', 'B', 'C'].includes(r.tier), `bad tier on ${r.id}`);
    assert.equal(typeof r.kind, 'string');
    assert.equal(typeof r.label, 'string');
    assert.ok(['global', 'IN', 'EU', 'US'].includes(r.region));
    // widthMm / heightMm allowed to be null only when payload provides them.
    if (r.widthMm !== null) {
      assert.ok(Number.isFinite(r.widthMm) && r.widthMm > 0, `bad width on ${r.id}`);
    }
    if (r.heightMm !== null) {
      assert.ok(Number.isFinite(r.heightMm) && r.heightMm > 0, `bad height on ${r.id}`);
    }
    assert.ok(['high', 'medium', 'low'].includes(r.accuracyClass));
    assert.equal(typeof r.aspectTolerance, 'number');
    assert.equal(typeof r.enabled, 'boolean');
  }
});

test('ids are unique', () => {
  const ids = REFERENCES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('getReferenceById returns the right entry', () => {
  const qr = getReferenceById('qr-100');
  assert.ok(qr);
  assert.equal(qr.widthMm, 100);
  assert.equal(qr.tier, 'C');
  assert.equal(getReferenceById('does-not-exist'), null);
});

test('listEnabledReferences filters by tier and region', () => {
  const all = listEnabledReferences();
  assert.ok(all.every((r) => r.enabled));

  const tierC = listEnabledReferences({ tier: 'C' });
  assert.ok(tierC.length >= 2);
  assert.ok(tierC.every((r) => r.tier === 'C'));

  // Region filter: an IN-only consumer still gets 'global' entries.
  const inOnly = listEnabledReferences({ region: 'IN' });
  assert.ok(inOnly.some((r) => r.region === 'global'));
  assert.ok(inOnly.some((r) => r.region === 'IN'));
  assert.ok(!inOnly.some((r) => r.region === 'EU'));
});

test('tierContract returns a valid contract for every tier', () => {
  for (const t of ['S', 'A', 'B', 'C']) {
    const c = tierContract(t);
    assert.ok(c, `missing contract for ${t}`);
    assert.ok(c.maxSideErrPct > 0 && c.maxSideErrPct < 1);
    assert.ok(c.maxAreaErrPct > 0 && c.maxAreaErrPct < 1);
    // Area tolerance must be at least as loose as side tolerance.
    assert.ok(c.maxAreaErrPct >= c.maxSideErrPct);
  }
  assert.equal(tierContract('Z'), null);
});

test('tier ordering: S and C are the highest accuracy', () => {
  // S = LiDAR, C = printed marker — both deliver the same ±1% / ±2% target.
  assert.equal(TIER_CONTRACT.S.maxSideErrPct, 0.01);
  assert.equal(TIER_CONTRACT.C.maxSideErrPct, 0.01);
  // A (AR) is loose
  assert.ok(TIER_CONTRACT.A.maxSideErrPct > TIER_CONTRACT.S.maxSideErrPct);
  // B (ML) is the loosest
  assert.ok(TIER_CONTRACT.B.maxSideErrPct >= TIER_CONTRACT.A.maxSideErrPct);
});
