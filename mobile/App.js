import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CaptureScreen from './src/screens/CaptureScreen';
import CalibrateScreen from './src/screens/CalibrateScreen';
import PolygonScreen from './src/screens/PolygonScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import { SettingsProvider } from './src/context/SettingsContext';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerStyle: { backgroundColor: '#0f172a' },
              headerTintColor: '#f8fafc',
              headerTitleStyle: { fontWeight: '700' },
            }}>
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'PainterApp' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'API Settings' }} />
            <Stack.Screen name="Capture" component={CaptureScreen} options={{ title: 'Capture Photo' }} />
            <Stack.Screen name="Calibrate" component={CalibrateScreen} options={{ title: 'Calibrate Scale' }} />
            <Stack.Screen name="Polygon" component={PolygonScreen} options={{ title: 'Select Area' }} />
            <Stack.Screen name="Results" component={ResultsScreen} options={{ title: 'Measurement' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
