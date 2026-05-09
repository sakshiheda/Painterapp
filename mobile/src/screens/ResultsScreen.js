import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ResultsScreen({ route, navigation }) {
  const { measurement, capture, points } = route.params;
  const { area, perimeter, sides, location, pointCount, calibrated } = measurement;
  // The API returns calibrated=true with cm/ft/m; calibrated=false ships only px / px².
  const isCalibrated = calibrated !== false && area && area.cm2 != null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        {!isCalibrated && (
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>Pixel-only preview</Text>
            <Text style={styles.warnBody}>
              This photo wasn't calibrated, so results are in image pixels — not real-world units.
              Tap “Calibrate this photo” below: pick a reference (credit card, A4, coin…)
              and your polygon will be re-measured in cm/m/ft — no need to redraw.
            </Text>
            <TouchableOpacity
              style={styles.calibBtn}
              onPress={() => navigation.replace('Calibrate', {
                capture,
                pendingPolygon: Array.isArray(points) ? points : undefined,
              })}>
              <Text style={styles.calibBtnText}>Calibrate this photo</Text>
            </TouchableOpacity>
          </View>
        )}

        {isCalibrated ? (
          <>
            <Stat label="Area" big={`${area.cm2.toLocaleString()} cm²`} sub={`${area.ft2} ft²  •  ${area.m2} m²`} accent />
            <Stat label="Perimeter" big={`${perimeter.cm} cm`} sub={`${perimeter.ft} ft  •  ${perimeter.m} m`} />
          </>
        ) : (
          <>
            <Stat label="Area" big={`${area.px2.toLocaleString()} px²`} sub="uncalibrated" accent />
            <Stat label="Perimeter" big={`${perimeter.px} px`} sub="uncalibrated" />
          </>
        )}

        <View style={styles.gpsCard}>
          <Text style={styles.gpsTitle}>Captured at</Text>
          {location.latitude != null ? (
            <>
              <Text style={styles.gpsCoord}>
                {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
              </Text>
              <Text style={styles.gpsMeta}>
                source: {location.source || 'unknown'}
                {location.altitude != null ? `   •   altitude ${Math.round(location.altitude)} m` : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.gpsCoord}>No GPS data</Text>
          )}
        </View>

        <Text style={styles.h2}>Sides ({pointCount})</Text>
        {sides.map((s) => (
          <View key={s.index} style={styles.sideRow}>
            <Text style={styles.sideIdx}>#{s.index + 1}</Text>
            <View style={{ flex: 1 }}>
              {isCalibrated ? (
                <>
                  <Text style={styles.sideMain}>{s.lengthCm} cm</Text>
                  <Text style={styles.sideSub}>{s.lengthFt} ft  •  {s.lengthM} m</Text>
                </>
              ) : (
                <Text style={styles.sideMain}>{s.lengthPx} px</Text>
              )}
            </View>
          </View>
        ))}

        <View style={{ height: 12 }} />
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => navigation.popToTop()}>
          <Text style={styles.btnPrimaryText}>Done</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnGhost}
          onPress={() => navigation.replace('Polygon', { capture })}>
          <Text style={styles.btnGhostText}>Re-draw on same photo</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, big, sub, accent }) {
  return (
    <View style={[styles.stat, accent && styles.statAccent]}>
      <Text style={[styles.statLabel, accent && { color: '#0f172a' }]}>{label}</Text>
      <Text style={[styles.statBig, accent && { color: '#0f172a' }]}>{big}</Text>
      <Text style={[styles.statSub, accent && { color: '#0f172a' }]}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },
  container: { padding: 18 },
  stat: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statAccent: { backgroundColor: '#facc15', borderColor: '#facc15' },
  statLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: '#64748b', textTransform: 'uppercase' },
  statBig: { fontSize: 28, fontWeight: '800', color: '#0f172a', marginTop: 4 },
  statSub: { fontSize: 13, color: '#475569', marginTop: 2 },
  gpsCard: {
    backgroundColor: '#0f172a',
    padding: 16,
    borderRadius: 14,
    marginBottom: 18,
  },
  gpsTitle: { color: '#facc15', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  gpsCoord: { color: '#f8fafc', fontSize: 16, fontWeight: '700', marginTop: 4 },
  gpsMeta: { color: '#cbd5e1', fontSize: 12, marginTop: 2 },
  h2: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 8, textTransform: 'uppercase' },
  sideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sideIdx: { fontWeight: '800', color: '#64748b', width: 36 },
  sideMain: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  sideSub: { fontSize: 12, color: '#64748b' },
  btnPrimary: {
    backgroundColor: '#0f172a',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  btnPrimaryText: { color: '#facc15', fontWeight: '800', fontSize: 16 },
  btnGhost: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  btnGhostText: { color: '#0f172a', fontWeight: '700' },
  warnCard: {
    backgroundColor: '#fef9c3',
    borderColor: '#facc15',
    borderWidth: 1,
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  warnTitle: { fontWeight: '800', color: '#854d0e', fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' },
  warnBody: { color: '#713f12', fontSize: 13, marginTop: 4, lineHeight: 18 },
  calibBtn: {
    marginTop: 10,
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  calibBtnText: { color: '#facc15', fontWeight: '800', fontSize: 14 },
});
