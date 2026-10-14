# SoundLAB Studio native MIDI shells

These shells package the same built SoundLAB UI with native MIDI access. iPad Safari does not implement Web MIDI; installing the website as a PWA does not add it. The iPad/iPhone shell uses CoreMIDI, and the Android shell uses the platform MidiManager. They are source implementations; physical-device acceptance and store signing are separate release steps. No iPad, Mac, Android, or Linux hardware verification is claimed by these files.

## Build the shared UI first

From the repository root, run `npm ci`, `npm run build`, then `npm run native:sync`. The sync script copies the existing `dist/` build into `native/ios/Web/` and `native/android/app/src/main/assets/app/`. Keep Vite's relative base enabled: packaged assets must load without a development server. Native shells intentionally load only bundled resources and refuse remote navigation, remote scripts, remote networking, and frames. Files selected by the user can still be read through the shared UI's browser file picker.

## iPad and iPhone

Requirements: macOS, Xcode with the iOS SDK, and XcodeGen. Minimum deployment target is iOS/iPadOS 16. The app uses UIKit, WKWebView, CoreMIDI, CoreAudioKit and AudioToolbox. The target and scheme are `SoundLABStudio`, and the application identifier is `com.soundlab.studio`.

```sh
xcodegen generate --spec native/ios/project.yml
xcodebuild -project native/ios/SoundLABStudio.xcodeproj \
  -scheme SoundLABStudio -configuration Release -sdk iphoneos \
  -archivePath native/ios/build/SoundLABStudio.xcarchive \
  archive CODE_SIGNING_ALLOWED=NO
```

An unsigned archive can validate the build, but it is not an installable or distributable iPad app. To install, open the generated project in Xcode, select your development team, connect an iPad/iPhone, and run the app with a valid provisioning profile. App Store/TestFlight export requires the owner's Apple Developer team, signing certificate, profile, app registration, and an export configuration. Those credentials are not embedded here.

USB keyboards appear through CoreMIDI after iOS recognizes them. Use a USB data cable and an appropriate host adapter/power supply for the particular iPad. The Bluetooth control presents Apple's MIDI-specific peripheral chooser; ordinary Bluetooth Settings pairing does not replace that flow. Bluetooth access has an app purpose string. The bridge listens for CoreMIDI topology changes, closes ports when the application becomes inactive, and restores them on return. The shared UI releases notes when it receives the empty endpoint list.

The shell serves the app at `soundlab://app/index.html`. Only the main frame at that origin can call the MIDI handler. Paths are resolved inside the bundled `Web` directory; symlinks/traversal outside that directory are rejected. The native handler is installed via a weak delegate to avoid a WebView/controller retain cycle.

The bridge converts CoreMIDI's Mach host ticks with `mach_timebase_info` and `mach_absolute_time`, which are available on iOS. Its WebView/device state runs on the main actor; background MIDI callbacks copy packet bytes before dispatching to that actor. `PrivacyInfo.xcprivacy` declares system boot time reason `35F9.1` because these clocks measure elapsed time and schedule MIDI events inside the app. Host clock values are not exported to a server.

## Android

Requirements: JDK 17, Gradle **8.13**, Android SDK platform **36**, and Android SDK build tools. Set `ANDROID_HOME` to that SDK, or use a local untracked `native/android/local.properties` containing its `sdk.dir`. The project pins Android Gradle Plugin **8.13.2** and AndroidX WebKit **1.15.0**. Minimum Android API is 23; target/compile SDK is 36. Use an updated Android System WebView with `WEB_MESSAGE_LISTENER` support. The application uses Java, so no Kotlin plugin is needed.

The repository supplies installed-Gradle build scripts rather than an unverified wrapper JAR:

```sh
sh native/android/build.sh debug
# Equivalent:
gradle -p native/android :app:assembleDebug :app:lintDebug
```

On Windows:

```powershell
./native/android/build.ps1 -Configuration debug
```

The development APK is `native/android/app/build/outputs/apk/debug/app-debug.apk`; Gradle signs it with a development key. To generate an unsigned release APK use `sh native/android/build.sh release` or `gradle -p native/android :app:assembleRelease`. A production release requires the owner's secure signing key and a release signing configuration. `gradle -p native/android :app:bundleRelease` builds the unsigned app bundle; complete signing before Play upload. Device installation can use `adb install -r native/android/app/build/outputs/apk/debug/app-debug.apk` with USB debugging enabled.

The app checks `FEATURE_MIDI`. USB host support, adapters, power, manufacturer firmware, and OS MIDI implementation still govern whether a keyboard can enumerate. No raw USB driver rebinding occurs. The bridge keeps MidiDevice/MidiInputPort/MidiOutputPort handles open while active, listens for device additions/removals, and closes/reopens them across app lifecycle changes. Android device output ports are SoundLAB inputs; Android device input ports are SoundLAB outputs.

Bluetooth is an explicit action. Android 12+ asks for Nearby Devices scan/connect permission; Android 6–11 asks for location permission needed by Bluetooth LE scanning. MIDI advertisements are filtered by the standard BLE MIDI service UUID. A native dialog lists discovered keyboards, and selection opens the device using `MidiManager.openBluetoothDevice`. This is a MIDI connection rather than generic Bluetooth pairing. A scan stops after 20 seconds or when dismissed. Unavailable MIDI/BLE hardware, rejected permissions, and failed connections emit recoverable errors. USB remains independently usable.

The UI origin is `https://appassets.androidplatform.net/app/index.html`, served through WebViewAssetLoader. `WebViewCompat.addWebMessageListener` exposes `SoundLabMidi` only to that origin, and its callback also requires the main frame. This intentionally avoids unrestricted `addJavascriptInterface`. Unknown origins and resources are blocked, file/content URL access is disabled, and the bridge accepts only JSON string commands. A restrictive content policy also prevents remote scripts and sockets.

## Bridge contract

The shared adapter must install its `soundlab-midi` listener **before** sending `start`.

Web to iOS:

```js
window.webkit.messageHandlers.soundlabMidi.postMessage({ action: 'start' });
```

Web to Android:

```js
window.SoundLabMidi.postMessage(JSON.stringify({ action: 'start' }));
```

Supported command objects:

```js
{ action: 'start' }
{ action: 'stop' }
{ action: 'bluetooth' }
{ action: 'send', id: 'native-output-id', data: [0x90, 60, 100], timestamp: performance.now() }
```

`send` requires a current native output endpoint and 1–65535 integer bytes in the range 0–255. Optional timestamps are finite nonnegative values in the web document's `performance.now()` time base. The bridge converts them to host monotonic scheduling time, sends past timestamps immediately, and caps scheduling at five seconds ahead. Sending without a timestamp is immediate. Native MIDI 1 bytes, including pressure, MPE channels and SysEx, are passed unchanged. Neither shell claims MIDI 2 UMP support.

Native to web:

```js
window.dispatchEvent(new CustomEvent('soundlab-midi', { detail: {
  type: 'ports',
  inputs: [{ id: '...', name: 'Keyboard', manufacturer: '...', state: 'connected' }],
  outputs: [{ id: '...', name: 'Keyboard', manufacturer: '...', state: 'connected' }]
} }));
// type: 'message', inputId: '...', data: [/* bytes */], timestamp: performanceMs
// type: 'error', message: '...', recoverable: true
```

Messages can contain multiple MIDI messages or partial messages/SysEx; parse them as a byte stream per input. Endpoint lists contain only currently opened receive ports and available output ports. An empty list means no endpoints, including during suspend/stop. Native callback timestamps are converted to approximate `performance.now()` values; WebView dispatch introduces some latency, so do not advertise sample-accurate audio scheduling from this bridge. iOS IDs use CoreMIDI unique endpoint IDs. Android device IDs can change on reconnect, so remembered selection should match manufacturer/name when the exact ID no longer exists.

## Release acceptance

Before claiming plug-and-play hardware support, perform the following on physical iPad/iPhone and Android devices: startup with USB attached, hotplug/unplug while notes are held, reconnect, suspend/resume, denied then granted Bluetooth permission, BLE discovery/cancel/connect, note-off/velocity/pressure/bend, multi-message chunks, running status, SysEx fragmentation and LED output, rapid key input, and host power/cable changes. Verify notes release on disconnect and that LED permission/control failures leave playing usable. Build/lint results do not substitute for those tests.

## Microphone and audio-input recording limits

The shared DAW's existing audio recorder opens input using `navigator.mediaDevices.getUserMedia({ audio: ... })`. These MIDI shells add keyboard transport, not a separate native audio recorder. The iOS project includes `NSMicrophoneUsageDescription` because access to the microphone or connected audio input requires a purpose string. That declaration prepares the permission request; it does not prove that recording works.

The iOS shell loads its bundled UI through `soundlab://app`, so recording acceptance must explicitly check `window.isSecureContext`, `navigator.mediaDevices?.getUserMedia`, the microphone permission flow, input selection, captured audio, and saving the resulting recording on a physical iPad/iPhone. Some WebKit versions support capture from bundled custom schemes, but the installed OS/WebView behavior and app permissions must be verified together. No native iOS microphone, external audio interface, or multichannel recording test is claimed. Synthesizer playback and MIDI note capture do not establish audio-input recording support.

The Android shell forwards the existing recorder's WebView audio-capture request through Android's `RECORD_AUDIO` runtime permission. It accepts only the bundled `https://appassets.androidplatform.net` origin while its trusted app page is in the foreground, and grants only `PermissionRequest.RESOURCE_AUDIO_CAPTURE`. Camera requests, mixed or unknown resource requests, and other origins are denied. Each request is checked independently; no broad or persistent WebView grant is stored. Canceled requests and navigation/background/destruction clear the pending request, and a later OS result cannot grant a replacement request. Denied microphone permission leaves MIDI and sample-file import usable.

This permission integration preserves the shared DAW's browser recorder; it does not establish physical Android microphone, external-interface, input-channel, or recording-save verification. Those remain acceptance tests on actual devices. The HTTPS browser/PWA version uses the browser's capture permission flow where supported, with the same device-testing limits. Sample-file import remains independent of microphone capture.

## Official references

- [WebKit Web MIDI implementation issue](https://bugs.webkit.org/show_bug.cgi?id=107250)
- [CoreMIDI](https://developer.apple.com/documentation/coremidi)
- [Apple Bluetooth MIDI chooser](https://developer.apple.com/documentation/coreaudiokit/cabtmidicentralviewcontroller)
- [WKScriptMessageHandler](https://developer.apple.com/documentation/webkit/wkscriptmessagehandler)
- [Apple microphone purpose string](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)
- [WebKit bundled-content media capture issue](https://bugs.webkit.org/show_bug.cgi?id=220184)
- [Android MIDI APIs](https://developer.android.com/reference/android/media/midi/package-summary)
- [Android Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)
- [Android WebView permission requests](https://developer.android.com/reference/android/webkit/PermissionRequest)
- [Android runtime permissions](https://developer.android.com/training/permissions/requesting)
- [Android WebView local content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)
- [Android Gradle/SDK compatibility](https://developer.android.com/build/releases/about-agp)
- [AndroidX WebKit releases](https://developer.android.com/jetpack/androidx/releases/webkit)
- [ROLI MIDI Bluetooth connection process](https://support.roli.com/en/support/solutions/articles/36000582346-how-to-connect-your-roli-device-to-your-computer-via-bluetooth)
