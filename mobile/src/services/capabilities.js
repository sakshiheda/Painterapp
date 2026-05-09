/**
 * Capability probe — figures out the highest measurement tier this device
 * can deliver, *without* requiring any user input.
 *
 *   Tier S  Depth/LiDAR sensor (iPhone Pro, iPad Pro, ToF Android)
 *   Tier A  ARCore / ARKit plane raycast
 *   Tier B  Server-side ML reference-object detection (works on every phone)
 *   Tier C  Explicitly placed QR marker (last resort, requires print)
 *
 * The probe runs once on app launch and caches its result. It is purely
 * native-capability detection — no server round-trip, no permissions
 * requested.
 *
 * Tier S/A detection requires a native AR module (Phase 6); until that
 * lands, this probe always returns the best of {B, C} which both work
 * inside Expo Go today.
 */

import { Platform } from 'react-native';

// expo-device is optional. If installed it gives us the precise model
// identifier needed for LiDAR detection. If not, we degrade gracefully —
// the probe still returns a valid (slightly less precise) verdict.
let Device = null;
try {
  // eslint-disable-next-line global-require
  Device = require('expo-device');
} catch (_) {
  Device = null;
}

// Devices known to ship LiDAR (Apple) or industrial ToF (select Android).
// Names per Apple/manufacturer reporting; matched against `Device.modelName`.
const LIDAR_DEVICES = [
  // iOS — Pro line and iPad Pro 2020+
  /iPhone1[2-9],\d/,             // iPhone 12 Pro and later identifiers
  /iPad8,1[12]/,                 // iPad Pro 11" 2020 / 12.9" 2020
  /iPad13,(4|5|6|7|8|9|10|11)/,  // iPad Pro 2021 / 2022
  /iPad14,(3|4|5|6)/,            // iPad Pro 2024
  // Android — devices with industrial ToF (rare in consumer fleet)
  /SM-G97[345]/,                 // Samsung S10 5G (ToF)
  /SM-N97[56]/,                  // Note 10+ (ToF)
];

function hasLidarHardware() {
  if (!Device) return false; // expo-device not installed; can't tell — assume no
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  const id = Device.modelId || Device.modelName || '';
  return LIDAR_DEVICES.some((re) => re.test(id));
}

/**
 * Are AR plane primitives reachable?
 *
 * Phase 5.3 ships only the structure — until the AR native module is wired
 * (Phase 6) we always return false. The detector exists so the rest of the
 * app can branch on the capability flag from day one.
 */
function hasArSupport() {
  // Future: dynamically `require('expo-ar')` or check `ViroAR.isARSupportedOnDevice()`
  // and resolve. We deliberately do NOT attempt require() here so the app
  // keeps working in Expo Go.
  return false;
}

/**
 * The probe's verdict. Returned object is stable and JSON-safe so it
 * can be persisted in async storage and reported to the server.
 */
export function probeCapabilities() {
  const lidar = hasLidarHardware();
  const ar = hasArSupport();

  // Pick the highest available tier.
  let tier;
  if (lidar) tier = 'S';
  else if (ar) tier = 'A';
  else tier = 'B'; // Tier B always works (it's pure server-side ML on uploaded photo)

  return {
    tier,            // best tier available right now
    fallbacks: ['B', 'C'], // Tier B (auto-ref ML) + Tier C (QR) are always usable as fallback
    lidar,
    ar,
    platform: Platform.OS,
    osVersion: Platform.Version,
    deviceBrand: (Device && Device.brand) || null,
    deviceModel: (Device && Device.modelName) || null,
    deviceModelId: (Device && Device.modelId) || null,
    probedAt: new Date().toISOString(),
  };
}

/**
 * Human-readable label for a tier — used in the capture UI to tell the
 * user how the measurement will be obtained.
 */
export function tierLabel(tier) {
  switch (tier) {
    case 'S': return 'depth sensor';
    case 'A': return 'AR plane';
    case 'B': return 'auto-detected reference object';
    case 'C': return 'placed QR marker';
    default:  return 'unknown';
  }
}
