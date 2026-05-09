import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { createApiClient } from '../services/api';

const DEFAULT_URL = 'http://10.160.24.195:4000';
const DEFAULT_KEY = 'dev-local-key-change-me';
const STORAGE_KEY = '@painterapp:settings';

export default function SettingsScreen({ navigation }) {
  const { settings, saveSettings } = useSettings();
  const [apiBaseUrl, setBase] = useState(settings.apiBaseUrl);
  const [apiKey, setKey] = useState(settings.apiKey);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function onSave() {
    const trimmed = apiBaseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmed)) {
      return Alert.alert('Invalid URL', 'Base URL must start with http:// or https://');
    }
    if (!apiKey.trim()) {
      return Alert.alert('Missing key', 'Please enter your API key.');
    }
    await saveSettings({ apiBaseUrl: trimmed, apiKey: apiKey.trim() });
    Alert.alert('Saved', `Will now talk to:\n${trimmed}`);
  }

  async function onTest() {
    setBusy(true);
    setLastResult(null);
    const url = apiBaseUrl.trim();
    try {
      const client = createApiClient({ apiBaseUrl: url, apiKey: apiKey.trim() });
      const res = await client.ping();
      const msg = `OK\nstatus: ${res.status}\nuptime: ${res.uptimeSec}s\nURL: ${url}`;
      setLastResult({ ok: true, msg });
      Alert.alert('Connected', msg);
    } catch (e) {
      const msg = `URL: ${url}\n\n${e.message}`;
      setLastResult({ ok: false, msg });
      Alert.alert('Connection failed', msg);
    } finally {
      setBusy(false);
    }
  }

  async function onResetDefaults() {
    Alert.alert(
      'Reset settings?',
      `This will overwrite the saved URL and key with the dev defaults:\n\n${DEFAULT_URL}\n${DEFAULT_KEY}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem(STORAGE_KEY);
            await saveSettings({ apiBaseUrl: DEFAULT_URL, apiKey: DEFAULT_KEY });
            setBase(DEFAULT_URL);
            setKey(DEFAULT_KEY);
            setLastResult(null);
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.activeCard}>
            <Text style={styles.activeLabel}>Currently saved</Text>
            <Text style={styles.activeUrl}>{settings.apiBaseUrl}</Text>
          </View>

          <Text style={styles.label}>API base URL</Text>
          <TextInput
            style={styles.input}
            value={apiBaseUrl}
            onChangeText={setBase}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={DEFAULT_URL}
            keyboardType="url"
          />
          <Text style={styles.hint}>
            On a phone, "localhost" means the phone itself. Use your computer's LAN IP
            (this machine: <Text style={styles.code}>10.160.24.195</Text>) when testing locally,
            or the public URL of your deployed API.
          </Text>

          <Text style={[styles.label, { marginTop: 18 }]}>API key</Text>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="your-api-key"
          />

          {lastResult && (
            <View style={[styles.resultCard, lastResult.ok ? styles.resultOk : styles.resultBad]}>
              <Text style={styles.resultLabel}>{lastResult.ok ? 'Last test: OK' : 'Last test: FAILED'}</Text>
              <Text style={styles.resultBody}>{lastResult.msg}</Text>
            </View>
          )}

          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onSave}>
            <Text style={[styles.btnText, styles.btnTextPrimary]}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, busy && { opacity: 0.6 }]}
            onPress={onTest}
            disabled={busy}>
            <Text style={styles.btnText}>{busy ? 'Testing…' : 'Test connection'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnReset} onPress={onResetDefaults}>
            <Text style={styles.btnResetText}>Reset to dev defaults</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },
  container: { padding: 20 },
  activeCard: {
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 12,
    marginBottom: 18,
  },
  activeLabel: { color: '#facc15', fontWeight: '800', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  activeUrl: { color: '#f8fafc', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, marginTop: 4 },
  label: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  hint: { fontSize: 12, color: '#64748b', marginTop: 6, lineHeight: 18 },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#0f172a', fontWeight: '700' },
  btn: {
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  btnPrimary: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  btnText: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  btnTextPrimary: { color: '#f8fafc' },
  btnReset: { marginTop: 16, paddingVertical: 10, alignItems: 'center' },
  btnResetText: { color: '#dc2626', fontWeight: '700', textDecorationLine: 'underline' },
  resultCard: { marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1 },
  resultOk: { backgroundColor: '#dcfce7', borderColor: '#22c55e' },
  resultBad: { backgroundColor: '#fee2e2', borderColor: '#ef4444' },
  resultLabel: { fontWeight: '800', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: '#0f172a' },
  resultBody: { marginTop: 4, color: '#0f172a', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
});
