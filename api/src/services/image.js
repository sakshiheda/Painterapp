'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const exifr = require('exifr');

/**
 * Read GPS + dimensions from an uploaded image file.
 * Returns { width, height, latitude, longitude, altitude, takenAt }.
 * Any field that cannot be read is returned as null/undefined.
 */
async function readImageMetadata(filePath) {
  const meta = await sharp(filePath).metadata();
  const result = {
    width: meta.width || 0,
    height: meta.height || 0,
    latitude: null,
    longitude: null,
    altitude: null,
    takenAt: null,
  };

  try {
    const exif = await exifr.parse(filePath, {
      gps: true,
      pick: ['GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'],
    });
    if (exif) {
      // exifr normalises GPS to .latitude / .longitude when gps:true
      if (typeof exif.latitude === 'number') result.latitude = exif.latitude;
      if (typeof exif.longitude === 'number') result.longitude = exif.longitude;
      if (typeof exif.GPSAltitude === 'number') result.altitude = exif.GPSAltitude;
      const ts = exif.DateTimeOriginal || exif.CreateDate;
      if (ts instanceof Date && !Number.isNaN(ts.getTime())) {
        result.takenAt = ts.toISOString();
      }
    }
  } catch (_) {
    // EXIF is optional — silently ignore
  }

  return result;
}

/**
 * Validate a path stays within a base directory (no traversal).
 */
function safeJoin(baseDir, name) {
  const resolved = path.resolve(baseDir, name);
  const normalisedBase = path.resolve(baseDir) + path.sep;
  if (!resolved.startsWith(normalisedBase)) {
    throw new Error('Invalid path');
  }
  return resolved;
}

function deleteIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_) {
    /* ignore */
  }
}

module.exports = { readImageMetadata, safeJoin, deleteIfExists };
