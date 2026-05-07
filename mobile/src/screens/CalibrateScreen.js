import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { createApiClient } from '../services/api';
import ImageCanvas from '../components/ImageCanvas';
import { viewToImageCoords } from '../utils/coords';

const UNITS = ['cm', 'mm', 'm', 'in', 'ft'];

export default function CalibrateScreen({ route, navigation }) {
  const { capture } = route.params;
  const { settings } = useSettings();
  const [points, setPoints] = useState([]);    // up to two image-space points
  const [length, setLength] = useState('100');
  const [unit, setUnit] = useState('cm');
  const [busy, setBusy] = useState(false);

  const imageUrl = `${settings.apiBaseUrl.replace(/\/+$/, '')}${capture.imageUrl}`;

  function onTap({ viewX, viewY, view, image }) {
    const p = viewToImageCoords({ x: viewX, y: viewY }, view, image);
    setPoints((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
  }

  const lines = useMemo(() => {
    if (points.length === 2) return [{ from: points[0], to: points[1], color: '#22d3ee' }];
    return [];
  }, [points]);

  async function onSave() {
    if (points.length !== 2) return Alert.alert('Need two points', 'Tap two ends of a known reference (e.g. ruler/tape).');
    const realLength = Number(length);
    if (!Number.isFinite(realLength) || realLength <= 0) {
      return Alert.alert('Invalid length', 'Enter a positive number.');
    }
    setBusy(true);
    try {
      const client = createApiClient(settings);
      const res = await client.calibrate(capture.id, {
        p1: points[0], p2: points[1], realLength, unit,
      });
      navigation.replace('Polygon', { capture: res.capture });
    } catch (e) {
      Alert.alert('Calibration failed', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.canvas}>
        <ImageCanvas
          capture={capture}
          imageUrl={imageUrl}
          apiKey={settings.apiKey}
          onTap={onTap}
          markers={points.map((p, i) => ({ ...p, color: i === 0 ? '#22c55e' : '#ef4444' }))}
          lines={lines}
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.h1}>Calibrate the scale</Text>
        <Text style={styles.help}>
          Tap two ends of a known length in the photo (a ruler, tape measure, A4 sheet, etc.),
          then enter how long it really is.  Points: <Text style={styles.bold}>{points.length}/2</Text>
        </Text>

        <View style={styles.row}>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={length}
            onChangeText={setLength}
            placeholder="length"
          />
          <View style={styles.unitRow}>
            {UNITS.map((u) => (
              <TouchableOpacity
                key={u}
                style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                onPress={() => setUnit(u)}>
                <Text style={[styles.unitText, unit === u && styles.unitTextActive]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btnGhost} onPress={() => setPoints([])}>
            <Text style={styles.btnGhostText}>Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnPrimary, (busy || points.length !== 2) && styles.btnDisabled]}
            onPress={onSave}
            disabled={busy || points.length !== 2}>
            {busy
              ? <ActivityIndicator color="#0f172a" />
              : <Text style={styles.btnPrimaryText}>Save & continue</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  canvas: { flex: 1 },
  panel: { backgroundColor: '#fff', padding: 16, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  h1: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  help: { fontSize: 13, color: '#475569', marginTop: 4, marginBottom: 12, lineHeight: 18 },
  bold: { fontWeight: '700', color: '#0f172a' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  input: {
    width: 110,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    fontSize: 16,
    marginRight: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap' },
  unitBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: '#cbd5e1', marginRight: 6, marginBottom: 6,
  },
  unitBtnActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  unitText: { color: '#0f172a', fontWeight: '600' },
  unitTextActive: { color: '#facc15' },
  btnRow: { flexDirection: 'row', justifyContent: 'space-between' },
  btnGhost: {
    paddingVertical: 13, paddingHorizontal: 18, borderRadius: 10,
    borderWidth: 1, borderColor: '#cbd5e1',
  },
  btnGhostText: { color: '#0f172a', fontWeight: '700' },
  btnPrimary: {
    flex: 1, marginLeft: 12, paddingVertical: 13, borderRadius: 10,
    backgroundColor: '#facc15', alignItems: 'center',
  },
  btnPrimaryText: { color: '#0f172a', fontSize: 16, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
});
