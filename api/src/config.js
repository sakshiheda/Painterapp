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
};

if (config.apiKeys.length === 0) {
  // Refuse to boot without auth — too easy to leak otherwise.
  throw new Error(
    'API_KEYS env var is required. Set at least one key (comma-separated for multiple).'
  );
}

module.exports = config;
