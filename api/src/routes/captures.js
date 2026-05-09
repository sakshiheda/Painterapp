'use strict';

const express = require('express');
const { z } = require('zod');
const path = require('path');
const fs = require('fs');

const db = require('../db');
const { upload, newId } = require('../middleware/upload');
const { readImageMetadata, deleteIfExists } = require('../services/image');
const { detectCalibrationMarker } = require('../services/marker');
const {
  intrinsicsFromExif, lensRiskFromFov, undistortPoints, undistortPoint,
  ZERO_DISTORTION,
} = require('../services/intrinsics');
const { validatePolygon } = require('../services/polygonValidation');
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

// 4-corner rectangular reference (preferred). The user identifies a
// rectangle in the same plane as the object they want to measure (a window,
// door frame, tile, taped-up A4, etc.) and gives us its real width/height.
// We solve for a perspective-correct homography — results are accurate
// even when the camera is tilted.
const calibrateRectSchema = z.object({
  tl: pointSchema,
  tr: pointSchema,
  br: pointSchema,
  bl: pointSchema,
  widthCm: z.number().finite().positive(),
  heightCm: z.number().finite().positive(),
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

// Categorical confidence label for the GPS reading.
//   green : accuracy <= MAX  and not mocked
//   amber : accuracy <= 2*MAX and not mocked  (still measurable but warn)
//   red   : missing, mocked, or accuracy > 2*MAX
function gpsConfidence(c) {
  if (!c) return 'red';
  if (c.gpsMocked === true) return 'red';
  if (c.latitude == null || c.longitude == null) return 'red';
  const acc = c.gpsAccuracyM;
  if (acc == null || !Number.isFinite(acc)) return 'amber';
  if (acc <= config.gpsMaxAccuracyM) return 'green';
  if (acc <= 2 * config.gpsMaxAccuracyM) return 'amber';
  return 'red';
}

function captureToJson(c) {
  if (!c) return null;
  let calibration = null;
  if (Array.isArray(c.homography) && c.homography.length === 9) {
    calibration = {
      method: c.calibrationMethod || 'rect',
      homography: c.homography,
      corners: c.calibrationCorners ?? null,
      widthCm: c.calibrationWidthCm ?? null,
      heightCm: c.calibrationHeightCm ?? null,
      markerSidePx: c.markerSidePx ?? null,
      markerPayload: c.markerPayload ?? null,
    };
  } else if (c.pxPerCm) {
    calibration = {
      method: 'line',
      pxPerCm: c.pxPerCm,
      p1: c.calibrationP1 ?? null,
      p2: c.calibrationP2 ?? null,
      realLengthCm: c.calibrationLengthCm ?? null,
    };
  }
  const lens = c.intrinsics
    ? {
        fx: c.intrinsics.fx,
        fy: c.intrinsics.fy,
        cx: c.intrinsics.cx,
        cy: c.intrinsics.cy,
        fovDeg: c.intrinsics.fovDeg,
        source: c.intrinsics.source,
        focalEquiv35mm: c.intrinsics.focalEquiv35mm ?? null,
        lensRisk: lensRiskFromFov(c.intrinsics.fovDeg),
        distortion: c.distortion || ZERO_DISTORTION,
        corrected: !!(c.distortion && (c.distortion.k1 || c.distortion.k2 || c.distortion.p1 || c.distortion.p2)),
      }
    : null;
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
      accuracyM: c.gpsAccuracyM ?? null,
      altitudeAccuracyM: c.gpsAltitudeAccuracyM ?? null,
      mocked: c.gpsMocked === true,
      provider: c.gpsProvider ?? null,
      fixCount: c.gpsFixCount ?? null,
      timestamp: c.gpsTimestamp ?? null,
      source: c.gpsSource ?? null,
      confidence: gpsConfidence(c),
    },
    deviceInfo: c.deviceInfo ?? null,
    takenAt: c.takenAt ?? null,
    createdAt: c.createdAt,
    calibration,
    lens,
    imageUrl: `/api/v1/captures/${c.id}/image`,
  };
}

function parseFloatOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBoolOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (/^(1|true|yes|on)$/i.test(String(v))) return true;
  if (/^(0|false|no|off)$/i.test(String(v))) return false;
  return null;
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
    const accuracyM = parseFloatOrNull(req.body.accuracyM);
    const altitudeAccuracyM = parseFloatOrNull(req.body.altitudeAccuracyM);
    const mockedRaw = parseBoolOrNull(req.body.mocked);
    const gpsTimestamp = (req.body.gpsTimestamp && String(req.body.gpsTimestamp)) || null;
    const gpsProvider = req.body.gpsProvider ? String(req.body.gpsProvider).slice(0, 32) : null;
    const gpsFixCount = parseFloatOrNull(req.body.gpsFixCount);
    const takenAt = (req.body.takenAt && String(req.body.takenAt)) || meta.takenAt || null;

    let latitude = meta.latitude;
    let longitude = meta.longitude;
    let altitude = meta.altitude;
    let gpsSource = meta.latitude != null && meta.longitude != null ? 'exif' : null;
    // Client-supplied GPS metadata is only meaningful when the client also
    // supplies a fix; EXIF GPS does not carry accuracy/mocked/provider.
    let gpsAccuracyM = null;
    let gpsAltitudeAccuracyM = null;
    let gpsMocked = false;
    let gpsProviderStored = null;
    let gpsFixCountStored = null;
    let gpsTimestampStored = null;

    if (lat != null && lng != null) {
      latitude = lat;
      longitude = lng;
      altitude = alt != null ? alt : altitude;
      gpsSource = 'client';
      gpsAccuracyM = accuracyM != null && accuracyM >= 0 ? accuracyM : null;
      gpsAltitudeAccuracyM = altitudeAccuracyM != null && altitudeAccuracyM >= 0 ? altitudeAccuracyM : null;
      gpsMocked = mockedRaw === true;
      gpsProviderStored = gpsProvider;
      gpsFixCountStored = gpsFixCount != null && gpsFixCount > 0 ? Math.round(gpsFixCount) : null;
      gpsTimestampStored = gpsTimestamp;
    }

    const id = newId();
    // ----- Camera intrinsics ---------------------------------------
    // Compute K from EXIF FocalLengthIn35mmFilm when present, fall back
    // to a typical phone FOV otherwise. Distortion coefficients are not
    // standard EXIF — we default to zeros (identity = no correction)
    // and let the response carry a `lensRisk` flag so the client can warn
    // the user if they shot with an ultra-wide lens.
    let intrinsics = null;
    try {
      intrinsics = intrinsicsFromExif({
        width: meta.width, height: meta.height,
        focalLengthIn35mmFilm: meta.focalLengthIn35mmFilm,
        focalLengthMm: meta.focalLengthMm,
      });
    } catch (_) { /* keep null — dimensions weirdness */ }
    const distortion = { ...ZERO_DISTORTION };

    const baseRow = {
      id,
      filename: path.basename(filePath),
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      width: meta.width,
      height: meta.height,
      latitude, longitude, altitude,
      gpsSource,
      gpsAccuracyM,
      gpsAltitudeAccuracyM,
      gpsMocked,
      gpsProvider: gpsProviderStored,
      gpsFixCount: gpsFixCountStored,
      gpsTimestamp: gpsTimestampStored,
      deviceInfo: req.body.deviceInfo ? String(req.body.deviceInfo) : null,
      takenAt,
      // Lens / camera profile
      intrinsics,
      distortion,
      cameraMake: meta.make,
      cameraModel: meta.model,
      lensModel: meta.lensModel,
      focalLengthMm: meta.focalLengthMm,
      focalLengthIn35mmFilm: meta.focalLengthIn35mmFilm,
    };

    // ----- QR auto-calibration ------------------------------------
    // We try to detect the printed marker in the uploaded photo. If
    // successful, we compute and store the homography immediately so
    // the user can skip the manual 4-corner step. Detection failures
    // are non-fatal — the upload still succeeds, the user will fall
    // back to manual calibration.
    let markerInfo = { found: false, reason: 'not_attempted' };
    try {
      markerInfo = await detectCalibrationMarker(filePath);
    } catch (e) {
      markerInfo = { found: false, reason: 'detector_error', error: e.message };
    }

    if (markerInfo.found) {
      const sideCm = markerInfo.sideMm / 10; // mm -> cm (homography uses cm)
      try {
        // Undistort the QR's 4 corners BEFORE solving the homography.
        // With the default zero distortion this is a no-op identity.
        const cornersUndist = intrinsics
          ? {
              tl: undistortPoint(markerInfo.corners.tl, intrinsics, distortion),
              tr: undistortPoint(markerInfo.corners.tr, intrinsics, distortion),
              br: undistortPoint(markerInfo.corners.br, intrinsics, distortion),
              bl: undistortPoint(markerInfo.corners.bl, intrinsics, distortion),
            }
          : markerInfo.corners;
        const H = geometry.homographyFromRectangle({
          tl: cornersUndist.tl,
          tr: cornersUndist.tr,
          br: cornersUndist.br,
          bl: cornersUndist.bl,
          widthCm: sideCm,
          heightCm: sideCm,
        });
        baseRow.homography = H;
        // Persist BOTH the raw image-pixel corners (for the UI overlay) and
        // the undistorted ones (used for arithmetic). Keeping both keeps
        // the data self-describing.
        baseRow.calibrationCorners = markerInfo.corners;
        baseRow.calibrationCornersUndistorted = cornersUndist;
        baseRow.calibrationWidthCm = sideCm;
        baseRow.calibrationHeightCm = sideCm;
        baseRow.calibrationMethod = 'qr-auto';
        baseRow.markerSidePx = markerInfo.sidePx;
        baseRow.markerPayload = markerInfo.payload;
      } catch (_) {
        // Degenerate corners — discard & let user calibrate manually.
        markerInfo = { found: false, reason: 'homography_failed' };
      }
    }

    const stored = db.captures.insert(baseRow);

    res.status(201).json({
      capture: captureToJson(stored),
      marker: markerInfo.found
        ? {
            found: true,
            sideMm: markerInfo.sideMm,
            sidePx: markerInfo.sidePx,
            corners: markerInfo.corners,
            payload: markerInfo.payload,
          }
        : { found: false, reason: markerInfo.reason },
    });
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

  // Switching to the simpler line scale clears any previous rect calibration
  // so the more powerful one isn't silently used by mistake.
  const updated = db.captures.update(c.id, {
    pxPerCm,
    calibrationP1: p1,
    calibrationP2: p2,
    calibrationLengthCm: realCm,
    homography: null,
    calibrationCorners: null,
    calibrationWidthCm: null,
    calibrationHeightCm: null,
  });

  res.json({
    capture: captureToJson(updated),
    pxPerCm: geometry.round(pxPerCm, 4),
  });
});

// ---------------- POST /captures/:id/calibrate-rect ----------------
//
// 4-corner perspective calibration. The user identifies a rectangle that
// lies in the same plane as the object they want to measure, taps its
// 4 corners (TL, TR, BR, BL) on the photo, and gives its real width and
// height in cm. We compute and persist a 3×3 homography that takes any
// image-pixel point to real-world cm — corrects perspective tilt.
router.post('/captures/:id/calibrate-rect', (req, res) => {
  const c = db.captures.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'Capture not found' });

  const parsed = calibrateRectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'validation', message: parsed.error.message, issues: parsed.error.issues });
  }
  const { tl, tr, br, bl, widthCm, heightCm } = parsed.data;
  for (const p of [tl, tr, br, bl]) {
    if (!withinImage(p, c)) {
      return res.status(400).json({ error: 'validation', message: 'All 4 corners must lie inside image bounds' });
    }
  }

  let H;
  let cornersUndist;
  try {
    // Manual 4-corner calibration: undistort the user's tapped corners
    // before solving the homography so the math operates in pinhole-ideal
    // pixel space.
    const D = c.distortion || ZERO_DISTORTION;
    const K = c.intrinsics;
    cornersUndist = {
      tl: K ? undistortPoint(tl, K, D) : tl,
      tr: K ? undistortPoint(tr, K, D) : tr,
      br: K ? undistortPoint(br, K, D) : br,
      bl: K ? undistortPoint(bl, K, D) : bl,
    };
    H = geometry.homographyFromRectangle({
      tl: cornersUndist.tl,
      tr: cornersUndist.tr,
      br: cornersUndist.br,
      bl: cornersUndist.bl,
      widthCm,
      heightCm,
    });
  } catch (e) {
    return res.status(400).json({ error: 'validation', message: e.message });
  }

  const updated = db.captures.update(c.id, {
    homography: H,
    calibrationCorners: { tl, tr, br, bl },
    calibrationCornersUndistorted: cornersUndist,
    calibrationWidthCm: widthCm,
    calibrationHeightCm: heightCm,
    calibrationMethod: 'rect',
    markerSidePx: null,
    markerPayload: null,
    // Clear the older line-scale fields so /measure unambiguously prefers H.
    pxPerCm: null,
    calibrationP1: null,
    calibrationP2: null,
    calibrationLengthCm: null,
  });

  res.json({
    capture: captureToJson(updated),
    homography: H,
  });
});

// ---------------- POST /captures/:id/detect-marker ----------------
//
// On-demand QR marker detection — useful when /captures is run before
// the user knew about the marker, or when the user is retrying with a
// clearer photo. Updates the capture's calibration in place.
router.post('/captures/:id/detect-marker', async (req, res, next) => {
  const c = db.captures.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'Capture not found' });

  const file = path.resolve(config.uploadDir, c.filename);
  const baseWithSep = path.resolve(config.uploadDir) + path.sep;
  if (!file.startsWith(baseWithSep)) {
    return res.status(400).json({ error: 'bad_request', message: 'Invalid file path' });
  }
  if (!fs.existsSync(file)) {
    return res.status(410).json({ error: 'gone', message: 'Image file is no longer available' });
  }

  let info;
  try {
    info = await detectCalibrationMarker(file);
  } catch (e) {
    return next(e);
  }

  if (!info.found) {
    return res.status(200).json({
      capture: captureToJson(c),
      marker: { found: false, reason: info.reason, payload: info.payload ?? null },
    });
  }

  const sideCm = info.sideMm / 10;
  const D = c.distortion || ZERO_DISTORTION;
  const K = c.intrinsics;
  const cornersUndist = K
    ? {
        tl: undistortPoint(info.corners.tl, K, D),
        tr: undistortPoint(info.corners.tr, K, D),
        br: undistortPoint(info.corners.br, K, D),
        bl: undistortPoint(info.corners.bl, K, D),
      }
    : info.corners;
  let H;
  try {
    H = geometry.homographyFromRectangle({
      tl: cornersUndist.tl,
      tr: cornersUndist.tr,
      br: cornersUndist.br,
      bl: cornersUndist.bl,
      widthCm: sideCm,
      heightCm: sideCm,
    });
  } catch (e) {
    return res.status(422).json({ error: 'homography_failed', message: e.message });
  }

  const updated = db.captures.update(c.id, {
    homography: H,
    calibrationCorners: info.corners,
    calibrationCornersUndistorted: cornersUndist,
    calibrationWidthCm: sideCm,
    calibrationHeightCm: sideCm,
    calibrationMethod: 'qr-auto',
    markerSidePx: info.sidePx,
    markerPayload: info.payload,
    pxPerCm: null,
    calibrationP1: null,
    calibrationP2: null,
    calibrationLengthCm: null,
  });

  res.json({
    capture: captureToJson(updated),
    marker: {
      found: true,
      sideMm: info.sideMm,
      sidePx: info.sidePx,
      corners: info.corners,
      payload: info.payload,
    },
  });
});

// ---------------- POST /captures/:id/measure ----------------

router.post('/captures/:id/measure', (req, res) => {
  const c = db.captures.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found', message: 'Capture not found' });

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

  // ---------- Build the unified gates object ----------
  // Each gate is a boolean. We compute them all, then refuse if any
  // hard-required gate fails. This makes the response self-describing
  // and gives the client an exact reason on every failure.
  const gpsConf = gpsConfidence(c);
  const lensRisk = c.intrinsics ? lensRiskFromFov(c.intrinsics.fovDeg) : 'amber';

  const gates = {
    gpsPresent: c.latitude != null && c.longitude != null,
    gpsNotMocked: c.gpsMocked !== true,
    gpsAccuracyOk:
      c.gpsAccuracyM != null &&
      Number.isFinite(c.gpsAccuracyM) &&
      c.gpsAccuracyM <= config.gpsMaxAccuracyM,
    calibrated: Array.isArray(c.homography) && c.homography.length === 9,
    lensRiskOk: lensRisk !== 'red', // red = ultra-wide, refuse
    polygonSimple: false,
    polygonAspectOk: false,
    polygonAreaCrossCheckOk: false,
  };

  // ----- GPS first (cheapest gate to fail fast) -----
  if (config.gpsStrict) {
    let reason = null;
    let message = 'GPS quality is insufficient for an accurate measurement.';
    if (!gates.gpsPresent) {
      reason = 'gps_missing';
      message = 'No GPS fix attached to this capture. Re-take the photo with location enabled.';
    } else if (!gates.gpsNotMocked) {
      reason = 'gps_mocked';
      message = 'GPS provider is reporting a mocked / fake location. Disable mock locations.';
    } else if (!gates.gpsAccuracyOk) {
      reason = 'gps_accuracy_low';
      const got = c.gpsAccuracyM == null ? 'unknown' : `${c.gpsAccuracyM}m`;
      message = `GPS accuracy ${got} exceeds the ${config.gpsMaxAccuracyM}m threshold. Move outdoors or wait for a better fix.`;
    }
    if (reason) {
      return res.status(422).json({
        error: reason,
        message,
        gates,
        confidence: 'red',
        gpsAccuracyM: c.gpsAccuracyM ?? null,
        gpsMaxAccuracyM: config.gpsMaxAccuracyM,
      });
    }
  }

  // ----- Calibration must exist (Phase 0/2 gate) -----
  if (!gates.calibrated && !c.pxPerCm) {
    return res.status(422).json({
      error: 'not_calibrated',
      message: 'Capture has no calibration. Place a printed marker in frame, or run /calibrate-rect.',
      gates,
      confidence: 'red',
    });
  }

  // ----- Lens risk (refuse ultra-wide where uncorrected error > 2 %) -----
  if (!gates.lensRiskOk) {
    return res.status(422).json({
      error: 'lens_risk_high',
      message: `Lens FOV ${Math.round(c.intrinsics?.fovDeg || 0)}° is ultra-wide; uncorrected lens distortion can exceed 2 %. Switch to the main camera.`,
      gates,
      confidence: 'red',
      lensRisk,
    });
  }

  // ----- Compute the measurement (this also undistorts internally) -----
  let result;
  try {
    const D = c.distortion || ZERO_DISTORTION;
    const K = c.intrinsics;
    const polygonUndist = K ? undistortPoints(polygon, K, D) : polygon;
    const calibration = Array.isArray(c.homography) && c.homography.length === 9
      ? { homography: c.homography }
      : c.pxPerCm
        ? { pxPerCm: c.pxPerCm }
        : null;
    result = geometry.measurePolygon(polygonUndist, calibration);
  } catch (e) {
    return res.status(400).json({ error: 'validation', message: e.message });
  }

  // ----- Polygon validation (cm-space when we have a homography) -----
  // If we don't have polygonCm (line-scale fallback), fall back to image-px
  // — the ratios still tell us about self-intersection / aspect / shoelace
  // cross-check. The numbers won't be in real-world units but the gates
  // are unit-agnostic.
  const validationPts = Array.isArray(result.polygonCm) && result.polygonCm.length === polygon.length
    ? result.polygonCm
    : polygon;
  const validation = validatePolygon(validationPts, {
    aspectMax: config.polygonAspectMax,
    mcSamples: config.polygonMcSamples,
    mcTolerance: config.polygonMcTolerance,
  });
  gates.polygonSimple = validation.simple.ok;
  gates.polygonAspectOk = validation.aspect.ok;
  gates.polygonAreaCrossCheckOk = validation.mc.ok;

  if (!validation.ok) {
    let message = 'Polygon failed validation gates.';
    if (validation.firstFailure === 'polygon_self_intersecting') {
      message = `Polygon edges cross each other (between vertices ${validation.simple.intersectionAt?.[0]} and ${validation.simple.intersectionAt?.[1]}). Re-draw without crossing lines.`;
    } else if (validation.firstFailure === 'polygon_aspect_extreme') {
      message = `Polygon is too elongated (bbox ratio ${validation.aspect.ratio.toFixed(0)}:1). Re-draw with a sensible shape.`;
    } else if (validation.firstFailure === 'polygon_area_mc_disagrees') {
      message = `Shoelace area and Monte-Carlo area disagree by ${(Math.abs(validation.mc.ratio - 1) * 100).toFixed(2)} %. The polygon may be malformed.`;
    }
    return res.status(422).json({
      error: validation.firstFailure || 'polygon_invalid',
      message,
      gates,
      confidence: 'red',
      validation,
    });
  }

  // ----- Roll up to a single confidence ----------
  // green : every gate passes & GPS conf green & lens green
  // amber : every gate passes but GPS amber OR lens amber
  // red   : any gate failed (already returned 422 above)
  let confidence = 'green';
  if (gpsConf === 'amber' || lensRisk === 'amber') confidence = 'amber';

  // ----- Persist -----
  const id = newId();
  // Strip the (potentially large) intermediate polygonCm out of the persisted
  // result — we keep it for the response only.
  const { polygonCm: _polygonCm, ...persistedResult } = result;
  db.measurements.insert({
    id,
    captureId: c.id,
    polygon,
    result: { ...persistedResult, confidence, gates: { ...gates } },
  });

  // ----- Respond -----
  res.status(201).json({
    measurement: {
      id,
      captureId: c.id,
      location: {
        latitude: c.latitude ?? null,
        longitude: c.longitude ?? null,
        altitude: c.altitude ?? null,
        accuracyM: c.gpsAccuracyM ?? null,
        mocked: c.gpsMocked === true,
        provider: c.gpsProvider ?? null,
        source: c.gpsSource ?? null,
        confidence: gpsConf,
      },
      lens: {
        fovDeg: c.intrinsics?.fovDeg ?? null,
        risk: lensRisk,
      },
      polygon,
      ...result,
      gates,
      validation: {
        firstFailure: null,
        mc: {
          shoelaceArea: validation.mc.shoelaceArea,
          mcArea: validation.mc.mcArea,
          ratio: validation.mc.ratio,
          tolerance: validation.mc.tolerance,
          samples: validation.mc.samples,
        },
        aspectRatio: validation.aspect.ratio,
      },
      confidence,
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
