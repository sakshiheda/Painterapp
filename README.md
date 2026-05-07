# PainterApp — Photo Measurement Platform

Capture a photo on a phone, tag it with GPS, calibrate a real-world scale, draw a polygon over any region, and get back **side dimensions (cm/ft/m)** and **area (cm² / ft² / m²)** via a clean REST API.

Built as two deployable units:

| Folder | What it is | Stack |
| --- | --- | --- |
| [api/](api/) | The cloud-deployable REST service | Node.js · Express · JSON store · Sharp · exifr |
| [mobile/](mobile/) | A test client for your phone | Expo · React Native · expo-camera · expo-location |

## What the system does

1. **Capture** — the phone takes a photo and sends it to the API along with the device's latitude / longitude / altitude.
2. **Calibrate** — the user taps two points on a known reference (a 1 m tape, a 30 cm ruler, an A4 sheet) and tells the API the real-world length between them. The API stores the resulting *pixels-per-centimetre* factor for that photo.
3. **Select area** — the user draws a polygon by tapping points around the region of interest (e.g. a wall, a floor tile, a window).
4. **Measure** — the API returns:
   - GPS lat/long where the photo was taken
   - Each side length in **cm, feet, metres**
   - Total perimeter
   - Total area in **cm², ft², m²**

## Quick start

```powershell
# 1. Start the API
cd api
npm install
copy .env.example .env
npm run dev          # http://localhost:4000

# 2. In a second terminal, start the mobile app
cd mobile
npm install
npx expo start       # scan QR with Expo Go on your phone
```

Set the API base URL and API key inside the mobile app on the **Settings** screen, then run through the on-screen flow: *Capture → Calibrate → Draw polygon → Results*.

See [api/README.md](api/README.md) for the full endpoint reference and cloud-deployment guide.

## Why a "reference-scale" approach?

To get real-world dimensions from a 2-D photo you need *one* of three things: LiDAR/depth, camera intrinsics + distance to subject, or a **known reference length in the frame**. Only the third option works on every phone and every project, so that is what the API is built around. The mobile app makes calibration a 2-tap step.

## License

MIT — re-use the API in any of your downstream projects.
