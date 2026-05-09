'use strict';

/**
 * Reference object catalog — the ground truth for "scale providers".
 *
 * Phase 5 architecture: a measurement may obtain its scale from any of
 * several sources. Each entry here describes one such source — its
 * canonical real-world dimensions in millimetres, plus enough metadata
 * for the tier router to pick the right one and the geometry pipeline
 * to compute a homography or distance.
 *
 * NEVER guess a dimension. Each entry is an internationally standard
 * size or one explicitly recognised in the regional catalog
 * (`region: 'IN' | 'EU' | 'US' | 'global'`).
 *
 * Tiers:
 *   S = on-device depth/LiDAR (no catalog needed; included for symmetry)
 *   A = AR plane raycast      (no catalog needed; included for symmetry)
 *   B = ML-detected reference object in the photo (uses this catalog)
 *   C = explicitly placed marker (QR; uses this catalog)
 *
 * To extend: add a new entry with a unique id, mark it `enabled: true`,
 * and ship a detector for it (jsqr for C, ONNX/TFJS YOLO for B).
 */

const REFERENCES = Object.freeze([
  // ---------------------------------------------------------------------
  // Tier C — explicit markers. These are *placed* by the user and have
  // sub-millimetre printing accuracy.
  // ---------------------------------------------------------------------
  {
    id: 'qr-100',
    tier: 'C',
    kind: 'qr-marker',
    region: 'global',
    label: 'PainterApp QR marker (100 mm)',
    widthMm: 100,
    heightMm: 100,
    accuracyClass: 'high',     // ±1 % sides / ±2 % area achievable
    aspectTolerance: 0.02,     // detected quad must be within 2 % of square
    enabled: true,
  },
  {
    id: 'qr-variable',
    tier: 'C',
    kind: 'qr-marker-payload',
    region: 'global',
    label: 'PainterApp QR marker (size from payload)',
    widthMm: null,             // parsed from the QR payload at runtime
    heightMm: null,
    accuracyClass: 'high',
    aspectTolerance: 0.02,
    enabled: true,
  },

  // ---------------------------------------------------------------------
  // Tier B — auto-detected reference objects. The user does NOT place
  // them; if they happen to be in frame the detector finds them.
  // Sizes are international standards.
  // ---------------------------------------------------------------------
  {
    id: 'a4-paper',
    tier: 'B',
    kind: 'paper-rectangle',
    region: 'global',           // ISO 216 — universal except US/CA
    label: 'A4 paper sheet',
    widthMm: 210,
    heightMm: 297,
    accuracyClass: 'medium',    // ±2-4 % typical
    aspectTolerance: 0.04,
    enabled: true,
  },
  {
    id: 'us-letter',
    tier: 'B',
    kind: 'paper-rectangle',
    region: 'US',
    label: 'US Letter paper',
    widthMm: 215.9,
    heightMm: 279.4,
    accuracyClass: 'medium',
    aspectTolerance: 0.04,
    enabled: true,
  },
  {
    id: 'credit-card',
    tier: 'B',
    kind: 'card',
    region: 'global',           // ISO/IEC 7810 ID-1
    label: 'Credit / debit card (ID-1)',
    widthMm: 85.6,
    heightMm: 53.98,
    accuracyClass: 'medium',
    aspectTolerance: 0.03,
    enabled: true,
  },
  {
    id: 'outlet-IN-86',
    tier: 'B',
    kind: 'wall-plate',
    region: 'IN',               // Indian modular plate, BIS standard
    label: 'Indian modular wall outlet plate (86×86)',
    widthMm: 86,
    heightMm: 86,
    accuracyClass: 'medium',
    aspectTolerance: 0.03,
    enabled: true,
  },
  {
    id: 'outlet-EU-80',
    tier: 'B',
    kind: 'wall-plate',
    region: 'EU',
    label: 'EU/Schuko wall outlet plate',
    widthMm: 80,
    heightMm: 80,
    accuracyClass: 'medium',
    aspectTolerance: 0.03,
    enabled: true,
  },
  {
    id: 'tile-300',
    tier: 'B',
    kind: 'floor-tile',
    region: 'global',
    label: 'Floor tile (300 mm)',
    widthMm: 300,
    heightMm: 300,
    accuracyClass: 'medium',
    aspectTolerance: 0.04,
    enabled: false,             // detector not shipped yet
  },
  {
    id: 'tile-600',
    tier: 'B',
    kind: 'floor-tile',
    region: 'global',
    label: 'Floor tile (600 mm)',
    widthMm: 600,
    heightMm: 600,
    accuracyClass: 'medium',
    aspectTolerance: 0.04,
    enabled: false,
  },
  {
    id: 'door-IN-standard',
    tier: 'B',
    kind: 'door',
    region: 'IN',
    label: 'Indian standard interior door',
    widthMm: 800,               // common Indian sizes 750/800/900; we record 800 as the modal
    heightMm: 2032,
    accuracyClass: 'low',       // door size varies — fallback only
    aspectTolerance: 0.10,
    enabled: false,
  },
  {
    id: 'plate-IN-vehicle',
    tier: 'B',
    kind: 'license-plate',
    region: 'IN',               // CMVR 1989, Rule 50
    label: 'Indian vehicle license plate (long)',
    widthMm: 520,
    heightMm: 110,
    accuracyClass: 'medium',
    aspectTolerance: 0.05,
    enabled: false,
  },
]);

// Per-tier accuracy contract — what /measure promises when this tier is used.
// Phase 5 ships these as the engineering contract; HTTP 422 if the rolled-up
// confidence falls below the tier's expected band.
const TIER_CONTRACT = Object.freeze({
  S: { maxSideErrPct: 0.01, maxAreaErrPct: 0.02, label: 'LiDAR / depth sensor' },
  A: { maxSideErrPct: 0.03, maxAreaErrPct: 0.05, label: 'AR plane (ARCore / ARKit)' },
  B: { maxSideErrPct: 0.05, maxAreaErrPct: 0.08, label: 'auto-detected reference object' },
  C: { maxSideErrPct: 0.01, maxAreaErrPct: 0.02, label: 'placed marker (QR)' },
});

/**
 * Look up a reference by id. Returns null on miss.
 */
function getReferenceById(id) {
  return REFERENCES.find((r) => r.id === id) || null;
}

/**
 * Filter the catalog to enabled entries, optionally constrained to a tier
 * and / or a region. Returns a fresh array (does not mutate REFERENCES).
 */
function listEnabledReferences({ tier, region } = {}) {
  return REFERENCES.filter((r) => {
    if (!r.enabled) return false;
    if (tier && r.tier !== tier) return false;
    if (region && r.region !== 'global' && r.region !== region) return false;
    return true;
  });
}

/**
 * Return the engineering contract for a tier, or null if unknown.
 */
function tierContract(tier) {
  return TIER_CONTRACT[tier] || null;
}

module.exports = {
  REFERENCES,
  TIER_CONTRACT,
  getReferenceById,
  listEnabledReferences,
  tierContract,
};
