# SoundLAB Studio native releases

The web application remains the shared UI and audio engine. Desktop packages bundle the built web assets inside Electron; iPad/iPhone use a WKWebView with CoreMIDI, and Android uses a WebView with Android MIDI. Native packages work from their bundled assets without a hosted page or a development server.

## Developer build commands

Use Node 22 and the checked-in npm lockfile:

```sh
npm ci
npm run build
npm run test:midi
npm run native:verify
npm run native:sync
node scripts/package-native.mjs --check
node scripts/electron-smoke.mjs
```

`native:sync` replaces only generated `native/ios/Web` and `native/android/app/src/main/assets/app` folders. It never overwrites Swift or Java source. These generated assets and `release/` must remain ignored in Git. Run it after every web build before building a mobile app.

The Electron smoke check launches this app in a hidden, muted window with a disposable profile and a fake microphone. It verifies the real sandbox, bundled secure origin, MIDI/SysEx permission handling, audio gesture requirement, recording permission path and recorded waveform. It does not install the application, use an existing browser profile or record a physical microphone.

Desktop development and packaging:

```sh
npm run desktop:dev
npm run desktop:pack
```

Packages go to `release/desktop/`: Windows x64 NSIS installer and portable executable; macOS Intel and Apple Silicon DMG/ZIP; Linux x64 AppImage/DEB. Build each platform on its corresponding operating system. The desktop renderer has no Node access, uses a sandbox, and loads only the bundled `soundlab://app` origin. MIDI and SysEx are available to that bundled main frame. Microphone access requires the app's Allow/Deny dialog and the operating system's permission where applicable; camera and screen capture are denied. Audio still starts after a user gesture.

Android requires JDK 17, Gradle 8.13, SDK platform 36 and build tools 36.0.0:

```sh
gradle -p native/android :app:assembleDebug :app:lintDebug
```

The result is `native/android/app/build/outputs/apk/debug/app-debug.apk`. This is an installable developer build, signed by the local debug key. CI debug keys can change between builds, so these artifacts do not provide a stable update channel.

iPad/iPhone compilation requires macOS, Xcode, and XcodeGen:

```sh
xcodegen generate --spec native/ios/project.yml
xcodebuild -project native/ios/SoundLABStudio.xcodeproj -scheme SoundLABStudio \
  -sdk iphoneos -configuration Release -archivePath release/SoundLABStudio-unsigned.xcarchive \
  archive CODE_SIGNING_ALLOWED=NO
```

The generated archive compiles the native app but is unsigned. An unsigned IPA cannot be installed directly on an ordinary iPad. Open the generated project in Xcode, select an authorized signing team, and run it on the device, or export a signed archive for the selected distribution route.

## CI and publishing

`.github/workflows/native-release.yml` checks the shared app, builds desktop packages on Windows/macOS/Linux, lints and builds the Android developer APK, and compiles an unsigned iOS archive/IPA. Pull requests and ordinary manual runs upload developer artifacts to the workflow run. Existing `.github/workflows/deploy.yml` continues to deploy the web app independently.

As authorized for this shipping workflow, a push to `main` or the repository's configured default branch publishes a GitHub **developer prerelease** only after every native build succeeds. Its tag is derived from `package.json` version, initially `soundlab-v0.2.0`, and points to the exact tested commit. Existing tags are never moved: increment the version before shipping another commit. A deliberately pushed matching `soundlab-v*` tag also publishes; a manual run can publish only when started on that tag with `publish_release` enabled. The release notes identify unsigned desktop packages, the debug Android key, and the unsigned iOS artifact. CI does not upload to App Store, TestFlight, Google Play or a desktop store. Physical hardware acceptance below remains required before calling a developer build production ready.

## Signing inputs still needed for production distribution

No production signing credentials are included in this repository or developer workflow. Configure a separate protected signing/distribution job after the following inputs are supplied:

| Platform | Required owner/account and signing inputs |
| --- | --- |
| Windows | A code-signing certificate/private key or authorized cloud signing service. For electron-builder certificate signing: secret `CSC_LINK` containing the certificate file/link and `CSC_KEY_PASSWORD`. A trusted certificate reduces installer identity warnings; it does not guarantee SmartScreen reputation. |
| macOS | Apple Developer team; Developer ID Application certificate/private key exported as a `.p12`, certificate password (`CSC_LINK`, `CSC_KEY_PASSWORD`), and notarization credentials. Use either Apple ID with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, or an App Store Connect API key/ID/issuer. Enable the builder's notarization configuration for that job and verify the resulting package. |
| iPad/iPhone | Authorized Apple signing team ID; registered `com.soundlab.studio` App ID; distribution or development certificate/private key `.p12` plus password; and the matching provisioning profile. Direct development installation needs a suitable device/profile. TestFlight/App Store upload additionally needs an App Store Connect app record and authorized upload credentials/API key. |
| Android | Stable release keystore, keystore password, key alias and key password. Store submission additionally needs the Play Console app record, enrollment in the selected signing route, and an authorized upload account/service account if automated. Configure release signing and build an AAB for Play or an APK for direct installation. |

Keep private keys and passwords in protected CI secrets, never in assets, repository source or build logs. Reuse the same Android signing identity for updates, increment platform build/version codes, and record the signing identity with release provenance.

Official references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron permissions](https://www.electronjs.org/docs/latest/api/session), [electron-builder signing](https://www.electron.build/code-signing), [Apple distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases), [Android signing](https://developer.android.com/studio/publish/app-signing).

## Hardware acceptance before a release tag

The automated tests verify service behavior and packaging policy; they cannot certify a physical controller on every operating system. Record device model, OS version, app build, connection type and result for each platform before tagging:

1. Install the packaged application, disconnect from the internet, and confirm bundled UI and audio work.
2. Plug a class-compliant USB MIDI keyboard directly into the device using a data-capable cable/adapter. Confirm it appears automatically, note-on/off plays correctly, and unplugging silences held notes.
3. Reconnect without restarting the app. Confirm the prior device is selected and playing resumes. Test two attached controllers and manually selecting each.
4. Test channel pressure, pitch bend, and MPE/per-channel expression where the controller supports them. Confirm a zero-velocity note-on releases the note.
5. Test LED/SysEx output only on hardware whose protocol is supported. Confirm switching/disconnecting the output clears lights and does not send unrelated proprietary commands.
6. Pair BLE MIDI through the platform's supported system/native pairing path. Confirm input, disconnect, reconnect, and USB/BLE switching. Plain Bluetooth pairing alone does not establish a MIDI endpoint on every OS.
7. Confirm recording permission can be denied and granted without preventing MIDI playback. Confirm export/import dialogs and saved sessions work.
8. On Windows, confirm Device Manager reports the MIDI device working before app acceptance. A controller with Code 10 is an OS/driver problem that the web service cannot repair. Use the targeted driver guidance below rather than replacing drivers for unrelated devices.

For Windows LUMI Code 10, the Microsoft MIDI class-driver choice can differ by Windows build and installed MIDI Services rollout. Where **USBMidi2-ACX** is offered for the matching controller, the manual Device Manager route is **Update driver → Browse my computer → Let me pick**. Do not promise the new driver exists on every Windows machine. [Microsoft class-driver switching guidance](https://microsoft.github.io/MIDI/kb/how-to-switch-between-class-drivers/).

Linux additionally needs the OS MIDI endpoint exposed to the user account. macOS BLE pairing uses Audio MIDI Setup's Bluetooth MIDI configuration; the native iOS app provides its system pairing view. Android USB/BLE permissions and first pairing remain user/OS actions. Plug and play means automatic discovery and reconnect after these required platform permissions, not silent bypass of them.
