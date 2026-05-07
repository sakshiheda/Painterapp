import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { createApiClient } from '../services/api';
import ImageCanvas from '../components/ImageCanvas';
import { viewToImageCoords } from '../utils/coords';

export default function PolygonScreen({ route, navigation }) {
  const { capture } = route.params;
  const { settings } = useSettings();
  const [points, setPoints] = useState([]);
  const [busy, setBusy] = useState(false);

  const imageUrl = `${settings.apiBaseUrl.replace(/\/+$/, '')}${capture.imageUrl}`;

  function onTap({ viewX, viewY, view, image }) {
    const p = viewToImageCoords({ x: viewX, y: viewY }, view, image);
    setPoints((prev) => [...prev, p]);
  }

  const lines = useMemo(() => {
    if (points.length < 2) return [];
    const arr = [];
    for (let i = 0; i < points.length - 1; i++) {
      arr.push({ from: points[i], to: points[i + 1], color: '#facc15' });
    }
    return arr;
  }, [points]);

  function undo() {
    setPoints((prev) => prev.slice(0, -1));
  }

  async function onMeasure() {
    if (points.length < 3) return Alert.alert('Add more points', 'Tap at least 3 points to define an area.');
    setBusy(true);
    try {
      const client = createApiClient(settings);
      const res = await client.measure(capture.id, points);
      navigation.replace('Results', { capture, measurement: res.measurement });
    } catch (e) {
      Alert.alert('Measurement failed', e.message);
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
          polygon={points.length >= 3 ? points : []}
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.h1}>Tap around the area to measure</Text>
        <Text style={styles.help}>
          Tap each corner of the region in order. Add as many points as you need —
          the polygon closes automatically. Points: <Text style={styles.bold}>{points.length}</Text>
        </Text>

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btnGhost} onPress={() => setPoints([])}>
            <Text style={styles.btnGhostText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnGhost} onPress={undo} disabled={!points.length}>
            <Text style={[styles.btnGhostText, !points.length && { opacity: 0.3 }]}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnPrimary, (busy || points.length < 3) && styles.btnDisabled]}
            onPress={onMeasure}
            disabled={busy || points.length < 3}>
            {busy
              ? <ActivityIndicator color="#0f172a" />
              : <Text style={styles.btnPrimaryText}>Measure</Text>}
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
  btnRow: { flexDirection: 'row', alignItems: 'center' },
  btnGhost: {
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1, borderColor: '#cbd5e1', marginRight: 8,
  },
  btnGhostText: { color: '#0f172a', fontWeight: '700' },
  btnPrimary: {
    flex: 1, paddingVertical: 13, borderRadius: 10,
    backgroundColor: '#facc15', alignItems: 'center',
  },
  btnPrimaryText: { color: '#0f172a', fontSize: 16, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
});
