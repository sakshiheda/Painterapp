import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as ImageManipulator from 'expo-image-manipulator';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { createApiClient } from '../services/api';

// Server-side gate is at 15 m. We warn earlier (amber at 30 m) and refuse to
// shoot below 60 m so users can't burn time with a useless capture.
const GPS_GREEN_M = 15;
const GPS_AMBER_M = 30;
const GPS_HARD_M = 60;
const FIX_COUNT = 3;

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Acquire `n` GPS fixes back-to-back at maximum accuracy.
//   - Median lat / lng / altitude   → robust to a single outlier fix
//   - Worst-of-n accuracy           → conservative (never optimistic)
//   - mocked = true if ANY fix was mocked
//   - timestamp / provider taken from the most recent fix
async function acquireGpsRobust(n = FIX_COUNT, onProgress) {
  const fixes = [];
  for (let i = 0; i < n; i++) {
    if (onProgress) onProgress(i, n);
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
        maximumAge: 0,
      });
      fixes.push(loc);
    } catch (_) {
      // skip this fix; keep going
    }
  }
  if (onProgress) onProgress(n, n);
  if (fixes.length === 0) return null;

  const lats = fixes.map((f) => f.coords.latitude);
  const lngs = fixes.map((f) => f.coords.longitude);
  const alts = fixes.map((f) => f.coords.altitude).filter((v) => v != null);
  const accs = fixes
    .map((f) => f.coords.accuracy)
    .filter((v) => v != null && Number.isFinite(v));
  const altAccs = fixes
    .map((f) => f.coords.altitudeAccuracy)
    .filter((v) => v != null && Number.isFinite(v));

  const last = fixes[fixes.length - 1];
  return {
    latitude: median(lats),
    longitude: median(lngs),
    altitude: alts.length ? median(alts) : null,
    accuracyM: accs.length ? Math.max(...accs) : null,
    altitudeAccuracyM: altAccs.length ? Math.max(...altAccs) : null,
    mocked: fixes.some((f) => f.mocked === true),
    timestamp: last.timestamp ? new Date(last.timestamp).toISOString() : null,
    provider: last.coords.provider || (Platform.OS === 'ios' ? 'corelocation' : 'fused'),
    fixCount: fixes.length,
  };
}

function gpsTier(accuracyM, mocked) {
  if (mocked) return 'red';
  if (accuracyM == null) return 'amber';
  if (accuracyM <= GPS_GREEN_M) return 'green';
  if (accuracyM <= GPS_AMBER_M) return 'amber';
  return 'red';
}

const TIER_COLOR = { green: '#22c55e', amber: '#facc15', red: '#ef4444' };

export default function CaptureScreen({ navigation }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [locPerm, setLocPerm] = useState(null);
  const [gps, setGps] = useState(null);                 // hardened GPS bundle
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsProgress, setGpsProgress] = useState(null); // "1/3"
  const [busy, setBusy] = useState(false);
  const { settings } = useSettings();

  async function refreshGps() {
    setGpsBusy(true);
    setGpsProgress(`0/${FIX_COUNT}`);
    try {
      const bundle = await acquireGpsRobust(FIX_COUNT, (done, total) => {
        setGpsProgress(`${done}/${total}`);
      });
      setGps(bundle);
    } finally {
      setGpsBusy(false);
      setGpsProgress(null);
    }
  }

  useEffect(() => {
    (async () => {
      if (!permission?.granted) await requestPermission();
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocPerm(status);
      if (status === 'granted') {
        await refreshGps();
      }
    })();
  }, []);

  async function onShoot() {
    if (!cameraRef.current || busy || gpsBusy) return;

    // Refresh GPS just before the shot so the fix is current.
    let liveGps = gps;
    if (locPerm === 'granted') {
      setGpsBusy(true);
      try {
        liveGps = await acquireGpsRobust(FIX_COUNT, (done, total) => {
          setGpsProgress(`${done}/${total}`);
        });
        setGps(liveGps);
      } catch (_) { /* keep previous */ }
      setGpsBusy(false);
      setGpsProgress(null);
    }

    // Hard refusal — don't waste an upload on a clearly useless GPS fix.
    if (locPerm === 'granted') {
      const tier = gpsTier(liveGps?.accuracyM, liveGps?.mocked);
      if (!liveGps || tier === 'red') {
        const reason = liveGps?.mocked
          ? 'GPS is reporting a mocked / fake location. Disable mock locations in developer options.'
          : liveGps?.accuracyM == null
            ? 'No GPS fix available. Move outdoors or wait for a fix before capturing.'
            : `GPS accuracy ±${Math.round(liveGps.accuracyM)} m is too poor (max ±${GPS_HARD_M} m). Move outdoors and try again.`;
        Alert.alert('GPS quality too low', reason);
        return;
      }
    }

    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
        exif: true,
      });

      // Down-scale for upload speed, keep enough resolution for accurate measurement.
      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 2048 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );

      const client = createApiClient(settings);
      const { capture, marker } = await client.uploadCapture({
        photoUri: resized.uri,
        latitude: liveGps?.latitude,
        longitude: liveGps?.longitude,
        altitude: liveGps?.altitude,
        accuracyM: liveGps?.accuracyM,
        altitudeAccuracyM: liveGps?.altitudeAccuracyM,
        mocked: liveGps?.mocked,
        gpsTimestamp: liveGps?.timestamp,
        gpsProvider: liveGps?.provider,
        gpsFixCount: liveGps?.fixCount,
        takenAt: new Date().toISOString(),
        deviceInfo: `${Platform.OS} ${Platform.Version}`,
      });

      // QR auto-detected → calibration is already done server-side.
      // Skip the manual Calibrate step entirely and go to polygon drawing.
      if (marker?.found && capture?.calibration?.method === 'qr-auto') {
        navigation.replace('Polygon', { capture, autoCalibrated: true });
      } else {
        navigation.replace('Calibrate', { capture, marker: marker || null });
      }
    } catch (e) {
      Alert.alert('Capture failed', e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Camera permission is required to capture a photo.</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tier = gps ? gpsTier(gps.accuracyM, gps.mocked) : 'red';
  const tierColor = TIER_COLOR[tier];
  const accuracyLabel = gps?.accuracyM != null ? `±${Math.round(gps.accuracyM)} m` : '—';
  const coordsLabel = gps
    ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`
    : locPerm === 'granted' ? (gpsBusy ? `acquiring ${gpsProgress || ''}` : 'no fix') : 'permission denied';
  const shootDisabled = busy || gpsBusy || (locPerm === 'granted' && tier === 'red');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.cameraWrap}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        <View style={styles.overlay}>
          <View style={[styles.gpsPill, { borderColor: tierColor }]}>
            <View style={[styles.gpsDot, { backgroundColor: tierColor }]} />
            <Text style={styles.gpsLabel}>GPS</Text>
            <Text style={styles.gpsValue}>{coordsLabel}</Text>
            <Text style={[styles.gpsAcc, { color: tierColor }]}>{accuracyLabel}</Text>
          </View>
          {gps?.mocked ? (
            <View style={styles.mockedPill}>
              <Text style={styles.mockedText}>MOCKED LOCATION — disable mock GPS</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={refreshGps}
            disabled={gpsBusy || locPerm !== 'granted'}>
            <Text style={styles.refreshText}>
              {gpsBusy ? `Acquiring ${gpsProgress}` : 'Re-acquire GPS'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.actions}>
        <Text style={styles.tip}>
          Hold steady. The app takes {FIX_COUNT} GPS fixes and uses the median for robustness.
          Server requires accuracy ≤ {GPS_GREEN_M} m for an accepted measurement.
        </Text>
        <TouchableOpacity
          style={[styles.shoot, shootDisabled && { opacity: 0.5 }]}
          onPress={onShoot}
          disabled={shootDisabled}>
          {busy ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.shootText}>Capture & Upload</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f1f5f9' },
  msg: { fontSize: 15, color: '#0f172a', marginBottom: 16, textAlign: 'center' },
  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  overlay: { position: 'absolute', top: 12, left: 12, right: 12, alignItems: 'flex-start' },
  gpsPill: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15,23,42,0.75)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  gpsDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  gpsLabel: { color: '#facc15', fontWeight: '800', marginRight: 8, fontSize: 12 },
  gpsValue: { color: '#f8fafc', fontSize: 13 },
  gpsAcc: { fontSize: 13, fontWeight: '800', marginLeft: 8 },
  mockedPill: {
    marginTop: 8,
    backgroundColor: 'rgba(239,68,68,0.92)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  mockedText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  refreshBtn: {
    marginTop: 8,
    backgroundColor: 'rgba(15,23,42,0.65)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  refreshText: { color: '#f8fafc', fontSize: 12, fontWeight: '700' },
  actions: { padding: 18, backgroundColor: '#0f172a' },
  tip: { color: '#cbd5e1', fontSize: 12, marginBottom: 12, textAlign: 'center', lineHeight: 17 },
  shoot: {
    backgroundColor: '#facc15',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  shootText: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  btn: { backgroundColor: '#0f172a', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10 },
  btnText: { color: '#f8fafc', fontWeight: '700' },
});
