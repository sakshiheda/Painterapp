'use strict';

const path = require('path');

// Load .env from the api root regardless of where `node` was invoked from.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function int(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be an integer`);
  return n;
}

function list(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number`);
  return n;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int('PORT', 4000),
  corsOrigins: list('CORS_ORIGINS', ['*']),
  apiKeys: list('API_KEYS', []),
  maxUploadBytes: int('MAX_UPLOAD_MB', 15) * 1024 * 1024,
  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MIN', 15) * 60 * 1000,
    max: int('RATE_LIMIT_MAX', 300),
  },
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  // ---- GPS quality gate ----
  // Maximum acceptable horizontal accuracy in metres for a measurement to
  // be considered trustworthy. Captures that exceed this threshold (or are
  // flagged "mocked" by the OS) are refused by /measure with HTTP 422 when
  // gpsStrict is true. Set PAINTERAPP_GPS_STRICT=false to keep storing
  // captures but skip the refusal — useful for indoor dev/testing.
  gpsMaxAccuracyM: num('PAINTERAPP_GPS_MAX_ACCURACY_M', 15),
  gpsStrict: bool('PAINTERAPP_GPS_STRICT', true),
  // ---- Polygon validation gates (Phase 3) ----
  // Bounding-box aspect ratio above which a polygon is considered absurd
  // and rejected. 200:1 is generous — a real measurement region is
  // virtually never that elongated.
  polygonAspectMax: num('PAINTERAPP_POLYGON_ASPECT_MAX', 200),
  // Number of Monte-Carlo samples for the area cross-check. 5000 gives
  // a sampling stddev around 1 % for typical polygons — well below our
  // tolerance gate but tight enough to catch real errors.
  polygonMcSamples: int('PAINTERAPP_POLYGON_MC_SAMPLES', 5000),
  // Maximum allowed |MC area − shoelace area| / shoelace, beyond which
  // the polygon is rejected. Default 1 %.
  polygonMcTolerance: num('PAINTERAPP_POLYGON_MC_TOLERANCE', 0.01),
};

if (config.apiKeys.length === 0) {
  // Refuse to boot without auth — too easy to leak otherwise.
  throw new Error(
    'API_KEYS env var is required. Set at least one key (comma-separated for multiple).'
  );
}

module.exports = config;
