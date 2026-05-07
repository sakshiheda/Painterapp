'use strict';

/**
 * Tiny zero-dependency JSON store.
 * - Atomic writes (write to .tmp, then rename) so corruption-free on crashes.
 * - Synchronous API — startup loads everything once into memory and persists on each mutation.
 * - Fine for tens of thousands of captures; swap for Postgres/Mongo later if you outgrow it.
 *
 * Public API:
 *   db.init(dataDir)
 *   db.captures.insert(row)
 *   db.captures.get(id)
 *   db.captures.list({ limit })
 *   db.captures.update(id, patch)
 *   db.captures.delete(id)
 *   db.measurements.insert(row)
 *   db.measurements.listByCapture(captureId)
 */

const fs = require('fs');
const path = require('path');

let state = null;
let dbFile = null;

function loadState(file) {
  if (!fs.existsSync(file)) {
    return { captures: {}, measurements: {} };
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return { captures: {}, measurements: {} };
    const parsed = JSON.parse(raw);
    if (!parsed.captures) parsed.captures = {};
    if (!parsed.measurements) parsed.measurements = {};
    return parsed;
  } catch (e) {
    throw new Error(`Failed to read database file ${file}: ${e.message}`);
  }
}

function persist() {
  const tmp = `${dbFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dbFile);
}

function nowIso() {
  return new Date().toISOString();
}

function init(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  dbFile = path.join(dataDir, 'painterapp.json');
  state = loadState(dbFile);
  return module.exports;
}

const captures = {
  insert(row) {
    if (!row || !row.id) throw new Error('capture.id required');
    if (state.captures[row.id]) throw new Error('capture id collision');
    const stored = { ...row, createdAt: row.createdAt || nowIso() };
    state.captures[row.id] = stored;
    persist();
    return stored;
  },
  get(id) {
    return state.captures[id] || null;
  },
  list({ limit = 50 } = {}) {
    const all = Object.values(state.captures);
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return all.slice(0, Math.max(0, limit));
  },
  update(id, patch) {
    const existing = state.captures[id];
    if (!existing) return null;
    const next = { ...existing, ...patch };
    state.captures[id] = next;
    persist();
    return next;
  },
  delete(id) {
    if (!state.captures[id]) return false;
    delete state.captures[id];
    for (const [mid, m] of Object.entries(state.measurements)) {
      if (m.captureId === id) delete state.measurements[mid];
    }
    persist();
    return true;
  },
};

const measurements = {
  insert(row) {
    if (!row || !row.id) throw new Error('measurement.id required');
    const stored = { ...row, createdAt: row.createdAt || nowIso() };
    state.measurements[row.id] = stored;
    persist();
    return stored;
  },
  listByCapture(captureId) {
    return Object.values(state.measurements)
      .filter((m) => m.captureId === captureId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },
};

module.exports = { init, captures, measurements };
