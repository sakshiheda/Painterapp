import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { createApiClient } from '../services/api';

export default function SettingsScreen({ navigation }) {
  const { settings, saveSettings } = useSettings();
  const [apiBaseUrl, setBase] = useState(settings.apiBaseUrl);
  const [apiKey, setKey] = useState(settings.apiKey);
  const [busy, setBusy] = useState(false);

  async function onSave() {
    const trimmed = apiBaseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmed)) {
      return Alert.alert('Invalid URL', 'Base URL must start with http:// or https://');
    }
    if (!apiKey.trim()) {
      return Alert.alert('Missing key', 'Please enter your API key.');
    }
    await saveSettings({ apiBaseUrl: trimmed, apiKey: apiKey.trim() });
    navigation.goBack();
  }

  async function onTest() {
    setBusy(true);
    try {
      const client = createApiClient({ apiBaseUrl: apiBaseUrl.trim(), apiKey: apiKey.trim() });
      const res = await client.ping();
      Alert.alert('Connected', `Status: ${res.status}\nUptime: ${res.uptimeSec}s`);
    } catch (e) {
      Alert.alert('Connection failed', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          <Text style={styles.label}>API base URL</Text>
          <TextInput
            style={styles.input}
            value={apiBaseUrl}
            onChangeText={setBase}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://192.168.1.10:4000"
            keyboardType="url"
          />
          <Text style={styles.hint}>
            On a phone, "localhost" means the phone itself. Use your computer's LAN IP (e.g.
            <Text style={styles.code}> 192.168.1.10</Text>) when testing locally, or the public
            URL of your deployed API.
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

          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onSave}>
            <Text style={[styles.btnText, styles.btnTextPrimary]}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, busy && { opacity: 0.6 }]}
            onPress={onTest}
            disabled={busy}>
            <Text style={styles.btnText}>{busy ? 'Testing…' : 'Test connection'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },
  container: { padding: 20 },
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
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#0f172a' },
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
});
