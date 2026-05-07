# PainterApp Mobile (Expo)

A test-bed React Native app — built with Expo so you can scan a QR code on your phone and run it without setting up Xcode / Android Studio.

## Run it

```powershell
cd mobile
npm install
npx expo start
```

Then either:

- Install **Expo Go** from the App Store / Play Store and scan the QR shown in the terminal, or
- Press `a` / `i` in the Expo CLI to launch an Android emulator / iOS simulator.

## First-time setup

1. Make sure the API is running and reachable from your phone (same Wi-Fi as your computer for local dev).
2. Open the app, tap **API Settings**, and enter:
   - **API base URL** — e.g. `http://192.168.1.10:4000` (your computer's LAN IP) or your deployed URL.
   - **API key** — must match one of the entries in the API's `API_KEYS` env var.
3. Tap **Test connection** — should show "Connected".
4. Tap **Capture new photo** to start the flow.

## The flow

1. **Capture** — grants camera + location permission, then takes a photo. The phone's GPS is sent with the upload.
2. **Calibrate** — tap two ends of a known reference in the photo (a tape measure, ruler, or any object of known size), then enter how long it really is and pick the unit.
3. **Select Area** — tap each corner of the region you want to measure. The polygon closes automatically when you have ≥ 3 points.
4. **Results** — area in cm² / ft² / m², perimeter, individual side lengths, and the GPS coordinates of the capture.

## Why localhost doesn't work from the phone

`localhost` on your phone refers to the phone itself, not your computer. Use your computer's LAN IP address instead. Find it on Windows with:

```powershell
ipconfig | Select-String "IPv4"
```

## Project layout

```
mobile/
├── App.js                       # navigation root
├── app.json                     # Expo config + permissions
├── babel.config.js
├── src/
│   ├── context/SettingsContext.js   # persists API URL + key on device
│   ├── services/api.js              # tiny fetch wrapper around the API
│   ├── utils/coords.js              # screen <-> image-pixel mapping
│   ├── components/ImageCanvas.js    # tap-to-add-point image canvas
│   └── screens/
│       ├── HomeScreen.js
│       ├── SettingsScreen.js
│       ├── CaptureScreen.js
│       ├── CalibrateScreen.js
│       ├── PolygonScreen.js
│       └── ResultsScreen.js
```

## Building a stand-alone APK / IPA

For your own internal distribution, use [EAS Build](https://docs.expo.dev/build/setup/):

```powershell
npm install -g eas-cli
eas login
eas build -p android --profile preview     # produces an APK you can side-load
```

The Expo Go workflow is enough for testing on your own phone; you only need EAS when you want to share with others.
