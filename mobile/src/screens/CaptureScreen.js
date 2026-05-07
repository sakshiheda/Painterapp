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

export default function CaptureScreen({ navigation }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [locPerm, setLocPerm] = useState(null);
  const [coords, setCoords] = useState(null);
  const [busy, setBusy] = useState(false);
  const { settings } = useSettings();

  useEffect(() => {
    (async () => {
      if (!permission?.granted) await requestPermission();
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocPerm(status);
      if (status === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          setCoords(loc.coords);
        } catch (_) { /* ignore — user can still capture without GPS */ }
      }
    })();
  }, []);

  async function onShoot() {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      // Refresh GPS just before the shot so the coords are current.
      let liveCoords = coords;
      if (locPerm === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          liveCoords = loc.coords;
          setCoords(loc.coords);
        } catch (_) { /* keep previous */ }
      }

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
      const { capture } = await client.uploadCapture({
        photoUri: resized.uri,
        latitude: liveCoords?.latitude,
        longitude: liveCoords?.longitude,
        altitude: liveCoords?.altitude,
        takenAt: new Date().toISOString(),
        deviceInfo: `${Platform.OS} ${Platform.Version}`,
      });

      navigation.replace('Calibrate', { capture });
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

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.cameraWrap}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        <View style={styles.overlay}>
          <View style={styles.gpsPill}>
            <Text style={styles.gpsLabel}>GPS</Text>
            <Text style={styles.gpsValue}>
              {coords
                ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
                : locPerm === 'granted' ? 'acquiring…' : 'permission denied'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Text style={styles.tip}>
          Tip: include something of a known size in the frame (a tape, ruler, A4 sheet) so you can
          calibrate the next step.
        </Text>
        <TouchableOpacity
          style={[styles.shoot, busy && { opacity: 0.5 }]}
          onPress={onShoot}
          disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.shootText}>Capture & Upload</Text>}
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
    backgroundColor: 'rgba(15,23,42,0.65)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  gpsLabel: { color: '#facc15', fontWeight: '800', marginRight: 8, fontSize: 12 },
  gpsValue: { color: '#f8fafc', fontSize: 13 },
  actions: { padding: 18, backgroundColor: '#0f172a' },
  tip: { color: '#cbd5e1', fontSize: 13, marginBottom: 12, textAlign: 'center', lineHeight: 18 },
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
