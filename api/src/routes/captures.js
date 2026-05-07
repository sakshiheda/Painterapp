'use strict';

const express = require('express');
const { z } = require('zod');
const path = require('path');
const fs = require('fs');

const db = require('../db');
const { upload, newId } = require('../middleware/upload');
const { readImageMetadata, deleteIfExists } = require('../services/image');
const geometry = require('../services/geometry');
const config = require('../config');

const router = express.Router();

// ---------------- schemas ----------------

const pointSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
});

const calibrateSchema = z.object({
  p1: pointSchema,
  p2: pointSchema,
  realLength: z.number().finite().positive(),
  unit: z.enum(['cm', 'mm', 'm', 'ft', 'in']).default('cm'),
});

const measureSchema = z.object({
  polygon: z.array(pointSchema).min(3).max(200),
});

// ---------------- helpers ----------------

function unitToCm(value, unit) {
  switch (unit) {
    case 'cm': return value;
    case 'mm': return value / 10;
    case 'm':  return value * 100;
    case 'ft': return value * 30.48;
    case 'in': return value * 2.54;
    default:   return value;
  }
}

function captureToJson(c) {
  if (!c) return null;
  return {
    id: c.id,
    filename: c.filename,
    mimeType: c.mimeType,
    sizeBytes: c.sizeBytes,
    width: c.width,
    height: c.height,
    location: {
      latitude: c.latitude ?? null,
      longitude: c.longitude ?? null,
      altitude: c.altitude ?? null,
      source: c.gpsSource ?? null,
    },
    deviceInfo: c.deviceInfo ?? null,
    takenAt: c.takenAt ?? null,
    createdAt: c.createdAt,
    calibration: c.pxPerCm
      ? {
          pxPerCm: c.pxPerCm,
          p1: c.calibrationP1 ?? null,
          p2: c.calibrationP2 ?? null,
          realLengthCm: c.calibrationLengthCm ?? null,
        }
      : null,
    imageUrl: `/api/v1/captures/${c.id}/image`,
  };
}

function parseFloatOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function withinImage(p, capture) {
  return p.x >= 0 && p.y >= 0 && p.x <= capture.width && p.y <= capture.height;
}

// ---------------- POST /captures ----------------

router.post('/captures', upload.single('image'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'bad_request', message: 'image file is required (multipart field "image")' });
  }
  const filePath = req.file.path;

  try {
    const meta = await readImageMetadata(filePath);

    const lat = parseFloatOrNull(req.body.latitude);
    const lng = parseFloatOrNull(req.body.longitude);
    const alt = parseFloatOrNull(req.body.altitude);
    const takenAt = (req.body.takenAt && String(req.body.takenAt)) || meta.takenAt || null;

    let latitude = meta.latitude;
    let longitude = meta.longitude;
    let altitude = meta.altitude;
    let gpsSource = meta.latitude != null && meta.longitude != null ? 'exif' : null;

    if (lat != null && lng != null) {
      latitude = lat;
      longitude = lng;
      altitude = alt != null ? alt : altitude;
      gpsSource = 'client';
    }

    const id = newId();
    const stored = db.captures.insert({
      id,
      filename: path.basename(filePath),
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      width: meta.width,
      height: meta.height,
      latitude, longitude, altitude,
      gpsSource,
      deviceInfo: req.body.deviceInfo ? String(req.body.deviceInfo) : null,
      takenAt,
    });

    res.status(201).json({ capture: captureToJson(stored) });
  } catch (err) {
    deleteIfExists(filePath);
    next(err);
  }
});

// ---------------- GET /captures ----------------

router.get('/captures', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json({ captures: db.captures.list({ limit }).map(captureToJson) });
});

// ---------------- GET /captures/:id ----------------

router.get('/captures/:id', (req, res) => {
  const c = db.captures.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'Capture not found' });
  res.json({ capture: captureToJson(c) });
});

// ---------------- GET /captures/:id/image ----------------

router.get('/captures/:id/image', (req, res, next) => {
  const c = db.captures.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'Capture not found' });
  // Filename is opaque (we generated it). Resolve under upload dir, then verify containment.
  const file = path.resolve(config.uploadDir, c.filename);
  const baseWithSep = path.resolve(config.uploadDir) + path.sep;
  if (!file.startsWith(baseWithSep)) {
    return res.status(400).json({ error: 'bad_request', message: 'Invalid file path' });
  }
  if (!fs.existsSync(file)) {
    return res.status(410).json({ error: 'gone', message: 'Image file is no longer available' });
  }
  res.type(c.mimeType).sendFile(file, (err) => err && next(err));
});

// ---------------- POST /captures/:id/calibrate ----------------

router.post('/captures/:id/calibrate', (req, res) => {
  const c = db.captures.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'Capture not found' });

  const parsed = calibrateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'validation', message: parsed.error.message, issues: parsed.error.issues });
  }
  const { p1, p2, realLength, unit } = parsed.data;
  if (!withinImage(p1, c) || !withinImage(p2, c)) {
    return res.status(400).json({ error: 'validation', message: 'Calibration points must lie inside image bounds' });
  }

  const realCm = unitToCm(realLength, unit);
  let pxPerCm;
  try {
    pxPerCm = geometry.pixelsPerCm(p1, p2, realCm);
  } catch (e) {
    return res.status(400).json({ error: 'validation', message: e.message });
  }

  const updated = db.captures.update(c.id, {
    pxPerCm,
    calibrationP1: p1,
    calibrationP2: p2,
    calibrationLengthCm: realCm,
  });

  res.json({
    capture: captureToJson(updated),
    pxPerCm: geometry.round(pxPerCm, 4),
  });
});

// ---------------- POST /captures/:id/measure ----------------

router.post('/captures/:id/measure', (req, res) => {
  const c = db.captures.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'Capture not found' });
  if (!c.pxPerCm) {
    return res.status(409).json({
      error: 'not_calibrated',
      message: 'Capture has no calibration. POST /captures/:id/calibrate first.',
    });
  }

  const parsed = measureSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'validation', message: parsed.error.message, issues: parsed.error.issues });
  }
  const { polygon } = parsed.data;
  for (const p of polygon) {
    if (!withinImage(p, c)) {
      return res.status(400).json({ error: 'validation', message: 'Polygon points must lie inside image bounds' });
    }
  }

  let result;
  try {
    result = geometry.measurePolygon(polygon, c.pxPerCm);
  } catch (e) {
    return res.status(400).json({ error: 'validation', message: e.message });
  }

  const id = newId();
  db.measurements.insert({
    id,
    captureId: c.id,
    polygon,
    result,
  });

  res.status(201).json({
    measurement: {
      id,
      captureId: c.id,
      location: {
        latitude: c.latitude ?? null,
        longitude: c.longitude ?? null,
        altitude: c.altitude ?? null,
        source: c.gpsSource ?? null,
      },
      polygon,
      ...result,
    },
  });
});

// ---------------- GET /captures/:id/measurements ----------------

router.get('/captures/:id/measurements', (req, res) => {
  const c = db.captures.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'Capture not found' });
  const list = db.measurements.listByCapture(c.id).map((m) => ({
    id: m.id,
    captureId: m.captureId,
    polygon: m.polygon,
    ...m.result,
    createdAt: m.createdAt,
  }));
  res.json({ measurements: list });
});

// ---------------- DELETE /captures/:id ----------------

router.delete('/captures/:id', (req, res) => {
  const c = db.captures.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'Capture not found' });
  db.captures.delete(c.id);
  deleteIfExists(path.join(config.uploadDir, c.filename));
  res.status(204).end();
});

module.exports = router;
