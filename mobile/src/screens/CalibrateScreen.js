import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { createApiClient } from '../services/api';
import ImageCanvas from '../components/ImageCanvas';
import { viewToImageCoords } from '../utils/coords';

/**
 * Perspective-correct calibration.
 *
 * The user identifies a rectangle in the photo (a window, door, tile,
 * panel — anything whose true width × height in cm is known) by tapping
 * its four corners in this order:
 *
 *     1 (TL) ─────── 2 (TR)
 *      │              │
 *     4 (BL) ─────── 3 (BR)
 *
 * After Save & continue, the server uses these 4 correspondences to solve
 * a 3×3 homography. Any polygon traced on the same plane will then be
 * measured exactly in cm² regardless of camera tilt or perspective.
 */

const CORNER_ORDER = [
  { key: 'tl', label: 'top-left',     color: '#22c55e' }, // green
  { key: 'tr', label: 'top-right',    color: '#3b82f6' }, // blue
  { key: 'br', label: 'bottom-right', color: '#f97316' }, // orange
  { key: 'bl', label: 'bottom-left',  color: '#ef4444' }, // red
];

export default function CalibrateScreen({ route, navigation }) {
  // pendingPolygon is set when the user came back here from Results
  // ("Calibrate this photo") and we want to preserve their drawing.
  const { capture, pendingPolygon } = route.params;
  const { settings } = useSettings();
  const [corners, setCorners] = useState([]); // image-px points in tap order
  const [widthText, setWidthText] = useState('');
  const [heightText, setHeightText] = useState('');
  const [busy, setBusy] = useState(false);

  const widthCm = Number(widthText);
  const heightCm = Number(heightText);
  const widthValid = Number.isFinite(widthCm) && widthCm > 0;
  const heightValid = Number.isFinite(heightCm) && heightCm > 0;
  const cornersComplete = corners.length === 4;
  const canSave = cornersComplete && widthValid && heightValid && !busy;

  const imageUrl = `${settings.apiBaseUrl.replace(/\/+$/, '')}${capture.imageUrl}`;

  function onTap({ viewX, viewY, view, image }) {
    if (corners.length >= 4) return;
    const p = viewToImageCoords({ x: viewX, y: viewY }, view, image);
    setCorners((prev) => [...prev, p]);
  }

  // Markers shown over the photo: each tap gets its corner colour & label.
  const markers = useMemo(() => corners.map((p, i) => ({
    ...p,
    color: CORNER_ORDER[i].color,
    label: String(i + 1),
  })), [corners]);

  // Outline the rectangle as it's being built.
  const lines = useMemo(() => {
    const arr = [];
    for (let i = 1; i < corners.length; i++) {
      arr.push({ from: corners[i - 1], to: corners[i], color: '#facc15' });
    }
    if (corners.length === 4) {
      arr.push({ from: corners[3], to: corners[0], color: '#facc15' });
    }
    return arr;
  }, [corners]);

  // Live sanity preview: given the typed W×H and the 4 taps, what is the
  // implied size of the *whole photo* in real-world cm? Big help to spot a
  // typo before saving.
  const preview = useMemo(() => {
    if (!cornersComplete || !widthValid || !heightValid) return null;
    // Average of opposite-edge pixel lengths
    const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    const avgWidthPx = (dist(corners[0], corners[1]) + dist(corners[3], corners[2])) / 2;
    const avgHeightPx = (dist(corners[0], corners[3]) + dist(corners[1], corners[2])) / 2;
    if (avgWidthPx <= 0 || avgHeightPx <= 0) return null;
    const pxPerCmX = avgWidthPx / widthCm;
    const pxPerCmY = avgHeightPx / heightCm;
    const photoWcm = capture.width / pxPerCmX;
    const photoHcm = capture.height / pxPerCmY;
    return {
      photoWcm,
      photoHcm,
      suspicious: photoWcm < 5 || photoWcm > 2000 || photoHcm < 5 || photoHcm > 2000,
    };
  }, [corners, cornersComplete, widthCm, heightCm, widthValid, heightValid, capture.width, capture.height]);

  function fmt(cm) {
    if (cm >= 100) return `${(cm / 100).toFixed(2)} m`;
    return `${cm.toFixed(1)} cm`;
  }

  async function doSave() {
    setBusy(true);
    try {
      const client = createApiClient(settings);
      const payload = {
        tl: corners[0],
        tr: corners[1],
        br: corners[2],
        bl: corners[3],
        widthCm,
        heightCm,
      };
      const res = await client.calibrateRect(capture.id, payload);
      navigation.replace('Polygon', { capture: res.capture, initialPoints: pendingPolygon });
    } catch (e) {
      Alert.alert('Calibration failed', e.message);
    } finally {
      setBusy(false);
    }
  }

  function onSave() {
    if (!cornersComplete) return Alert.alert('Tap all 4 corners', 'Tap the four corners of your reference rectangle in order: top-left, top-right, bottom-right, bottom-left.');
    if (!widthValid || !heightValid) return Alert.alert('Enter width & height', 'Type the rectangle\u2019s real width and height in cm.');
    if (preview && preview.suspicious) {
      return Alert.alert(
        'This scale looks wrong',
        `That would make the whole photo ${fmt(preview.photoWcm)} \u00d7 ${fmt(preview.photoHcm)} in real life. ` +
        'Did you tap the wrong corners or mistype the size?',
        [
          { text: 'Let me fix it', style: 'cancel' },
          { text: 'Save anyway', style: 'destructive', onPress: doSave },
        ],
      );
    }
    doSave();
  }

  // Step banner — guides the user through each tap.
  let stepText;
  if (corners.length < 4) {
    const next = CORNER_ORDER[corners.length];
    stepText = `Step ${corners.length + 1} of 4 \u2022 Tap the ${next.label.toUpperCase()} corner of your reference rectangle`;
  } else if (!widthValid || !heightValid) {
    stepText = 'Now type the rectangle\u2019s real width and height in cm';
  } else {
    stepText = 'Looks ready \u2014 review the size below, then Save';
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.canvas}>
        <ImageCanvas
          capture={capture}
          imageUrl={imageUrl}
          apiKey={settings.apiKey}
          onTap={onTap}
          markers={markers}
          lines={lines}
        />
        <View style={styles.stepBanner} pointerEvents="none">
          <Text style={styles.stepText}>{stepText}</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.h1}>Set the photo's scale</Text>
        <Text style={styles.help}>
          Pick any rectangular thing in the photo whose real size you know
          (door, window, tile, sheet of paper taped to the wall...). Tap its
          four corners in order, then enter how big it really is. The app uses
          this to remove perspective tilt, so measurements stay accurate.
        </Text>

        <View style={styles.cornerRow}>
          {CORNER_ORDER.map((c, i) => {
            const done = i < corners.length;
            const active = i === corners.length;
            return (
              <View
                key={c.key}
                style={[
                  styles.cornerChip,
                  done && { borderColor: c.color, backgroundColor: c.color },
                  active && styles.cornerChipActive,
                ]}>
                <Text style={[
                  styles.cornerChipText,
                  done && { color: '#fff' },
                  active && { color: '#0f172a' },
                ]}>
                  {i + 1}. {c.label}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.dimRow}>
          <View style={styles.dimField}>
            <Text style={styles.dimLabel}>Width</Text>
            <View style={styles.dimInputWrap}>
              <TextInput
                style={styles.dimInput}
                keyboardType="decimal-pad"
                value={widthText}
                onChangeText={setWidthText}
                placeholder="60"
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.dimUnit}>cm</Text>
            </View>
          </View>
          <View style={styles.dimField}>
            <Text style={styles.dimLabel}>Height</Text>
            <View style={styles.dimInputWrap}>
              <TextInput
                style={styles.dimInput}
                keyboardType="decimal-pad"
                value={heightText}
                onChangeText={setHeightText}
                placeholder="180"
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.dimUnit}>cm</Text>
            </View>
          </View>
        </View>

        {preview && (
          <View style={[styles.previewBox, preview.suspicious && styles.previewBoxBad]}>
            <Text style={[styles.previewLabel, preview.suspicious && styles.previewLabelBad]}>
              {preview.suspicious ? 'Looks wrong:' : 'Looks right:'} the whole photo would be
            </Text>
            <Text style={[styles.previewBig, preview.suspicious && styles.previewBigBad]}>
              {fmt(preview.photoWcm)} × {fmt(preview.photoHcm)}
            </Text>
          </View>
        )}

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btnGhost} onPress={() => setCorners([])}>
            <Text style={styles.btnGhostText}>Reset taps</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnPrimary, !canSave && styles.btnDisabled]}
            onPress={onSave}
            disabled={!canSave}>
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
  help: { fontSize: 12, color: '#475569', marginTop: 4, marginBottom: 12, lineHeight: 17 },
  cornerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  cornerChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginRight: 6,
    marginBottom: 6,
  },
  cornerChipActive: { borderColor: '#facc15', backgroundColor: '#fef9c3', borderWidth: 2 },
  cornerChipText: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  dimRow: { flexDirection: 'row', marginBottom: 12 },
  dimField: { flex: 1, marginRight: 8 },
  dimLabel: { fontSize: 11, fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  dimInputWrap: { flexDirection: 'row', alignItems: 'center' },
  dimInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  dimUnit: { marginLeft: 8, fontSize: 16, fontWeight: '800', color: '#0f172a' },
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
  previewBox: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  previewBoxBad: { backgroundColor: '#fef2f2', borderColor: '#dc2626' },
  previewLabel: { fontSize: 11, fontWeight: '700', color: '#065f46', textTransform: 'uppercase', letterSpacing: 0.5 },
  previewLabelBad: { color: '#7f1d1d' },
  previewBig: { fontSize: 18, fontWeight: '800', color: '#065f46', marginTop: 2 },
  previewBigBad: { color: '#7f1d1d' },
  stepBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    backgroundColor: 'rgba(15,23,42,0.85)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  stepText: { color: '#facc15', fontWeight: '800', fontSize: 13, textAlign: 'center' },
});
