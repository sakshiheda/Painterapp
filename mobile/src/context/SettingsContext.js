import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@painterapp:settings';
const DEFAULTS = {
  apiBaseUrl: 'http://192.168.1.10:4000',
  apiKey: 'dev-local-key-change-me',
};

const SettingsContext = createContext({
  settings: DEFAULTS,
  ready: false,
  saveSettings: async (_) => {},
});

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
      } catch (_) {
        /* ignore */
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const saveSettings = useCallback(async (next) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, ready, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
