import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@painterapp:settings';

// Cloud / build-time configuration.
//
// Expo lets you ship a production-bound URL into the app via env vars
// prefixed with EXPO_PUBLIC_*. That gives us:
//
//    Dev (LAN):      EXPO_PUBLIC_API_BASE_URL=http://10.134.128.195:4000
//    Staging:        EXPO_PUBLIC_API_BASE_URL=https://painterapp-staging.onrender.com
//    Production:     EXPO_PUBLIC_API_BASE_URL=https://api.painterapp.example.com
//
// If neither env nor saved settings provide a URL, the user must enter one
// in Settings before any API call works. We do NOT ship a hard-coded LAN
// IP — that would break every cloud build.
const ENV_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();
const ENV_API_KEY  = (process.env.EXPO_PUBLIC_API_KEY      || '').trim();

const DEFAULTS = {
  apiBaseUrl: ENV_BASE_URL,
  apiKey: ENV_API_KEY,
};

// Any saved URL that points at a private LAN range counts as "legacy
// dev URL" — when the app is later re-built with a production env, we
// replace it so the user picks up the new cloud URL automatically.
function isPrivateLanUrl(u) {
  if (!u) return false;
  return /^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost)/i.test(u);
}

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
        if (raw) {
          const parsed = { ...DEFAULTS, ...JSON.parse(raw) };
          // Migration: if this build has a cloud URL baked in but the
          // saved value is still a LAN URL, replace it.
          if (ENV_BASE_URL && !isPrivateLanUrl(ENV_BASE_URL) && isPrivateLanUrl(parsed.apiBaseUrl)) {
            parsed.apiBaseUrl = ENV_BASE_URL;
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          }
          setSettings(parsed);
        }
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
