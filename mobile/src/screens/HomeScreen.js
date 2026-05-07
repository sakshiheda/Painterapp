import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { createApiClient } from '../services/api';

export default function HomeScreen({ navigation }) {
  const { settings, ready } = useSettings();

  async function testConnection() {
    try {
      const client = createApiClient(settings);
      const res = await client.ping();
      Alert.alert('API reachable', `Status: ${res.status}\nUptime: ${res.uptimeSec}s`);
    } catch (e) {
      Alert.alert('Connection failed', e.message);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Photo → Measurement</Text>
        <Text style={styles.subtitle}>
          Snap a photo, calibrate the scale on a known reference, draw a polygon, and get back
          dimensions and area in cm, feet and metres — straight from your API.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>API base</Text>
          <Text style={styles.cardValue} numberOfLines={1}>{settings.apiBaseUrl}</Text>
          <Text style={styles.cardLabel}>API key</Text>
          <Text style={styles.cardValue} numberOfLines={1}>
            {settings.apiKey ? '•'.repeat(Math.min(12, settings.apiKey.length)) : '— not set —'}
          </Text>
        </View>

        <Btn label="1. Capture new photo" onPress={() => navigation.navigate('Capture')} primary disabled={!ready} />
        <Btn label="Test API connection" onPress={testConnection} />
        <Btn label="API settings" onPress={() => navigation.navigate('Settings')} />

        <Text style={styles.flow}>
          Flow: <Text style={styles.flowBold}>Capture → Calibrate → Select Area → Results</Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Btn({ label, onPress, primary, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.btn, primary && styles.btnPrimary, disabled && styles.btnDisabled]}
      onPress={onPress}
      disabled={disabled}>
      <Text style={[styles.btnText, primary && styles.btnTextPrimary]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },
  container: { padding: 20 },
  title: { fontSize: 26, fontWeight: '800', color: '#0f172a', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#475569', marginBottom: 22, lineHeight: 21 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginTop: 6 },
  cardValue: { fontSize: 14, color: '#0f172a', marginTop: 2 },
  btn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  btnPrimary: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: 16, fontWeight: '600', color: '#0f172a', textAlign: 'center' },
  btnTextPrimary: { color: '#f8fafc' },
  flow: { marginTop: 28, color: '#64748b', textAlign: 'center', fontSize: 13 },
  flowBold: { color: '#0f172a', fontWeight: '700' },
});
