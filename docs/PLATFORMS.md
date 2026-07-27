# Shipping OpenStudio to every platform

The app is a static web bundle (`npm run build` → `dist/`), which makes packaging straightforward.

## 1. Web (works today)

Host `dist/` on any static host (GitHub Pages, Netlify, Cloudflare Pages). HTTPS is required for
microphone, MIDI and Bluetooth permissions. The service worker makes it work offline after first load.

## 2. iPad / Android — install as a PWA (works today)

- **iPad (Safari)**: Share → *Add to Home Screen*. Runs fullscreen in landscape; multi-touch keys work.
- **Android (Chrome)**: menu → *Install app*. Web MIDI and direct BLE-MIDI work in Chrome.

Caveats: iPadOS Safari has no Web MIDI as of iPadOS 17 — use a Capacitor build (below) or a
Bluetooth-MIDI-to-virtual bridge app. Audio-interface *recording* works in Safari via getUserMedia.

## 3. iPad / Android — store builds with Capacitor

```bash
npm install @capacitor/core @capacitor/cli
npx cap init OpenStudio com.example.openstudio --web-dir dist
npm run build
npx cap add ios && npx cap add android
npx cap open ios      # Xcode → sign → App Store
npx cap open android  # Android Studio → Play Store
```

Add to `Info.plist` (iOS): `NSMicrophoneUsageDescription`, `NSBluetoothAlwaysUsageDescription`,
`UIBackgroundModes: audio`. Android: `RECORD_AUDIO`, `BLUETOOTH_CONNECT` permissions.

For iPad MIDI (incl. ROLI over USB-C/Bluetooth), add a small Capacitor plugin bridging CoreMIDI →
the `handleMidiMessage()` entry point in `src/midi/midi.ts` (it accepts raw MIDI bytes from any source).

## 4. PC (Windows/macOS/Linux) — Electron or Tauri

Electron quickstart:

```bash
npm install --save-dev electron
# main.js: createWindow({ webPreferences: { autoplayPolicy: 'no-user-gesture-required' } })
#          win.loadFile('dist/index.html')
npx electron .
```

Chromium ships Web MIDI + Web Audio, so **everything works out of the box**, including ROLI over USB.
Tauri gives smaller binaries (uses the OS webview; on Windows check WebView2 MIDI support).

## 5. Latency notes

- Web Audio interactive latency is typically 5–15 ms on desktop Chrome, ~10–20 ms on Android, ~15 ms iPad.
- Keep buffer pressure low: close other tabs, use a wired interface for tracking.
- The roadmap moves DSP into AudioWorklets and (in native shells) real-time audio backends for tighter numbers.
