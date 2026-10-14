# SoundLAB Studio platform support

SoundLAB Studio shares its DAW, instruments and keyboard connection manager across the web,
desktop and native mobile builds. Connect once, allow MIDI when requested, and tap Enable sound.
The selected keyboard is remembered and restored after hotplug; a disconnect releases held
live notes on their original tracks.

| Platform | Hardware MIDI path | Distribution |
| --- | --- | --- |
| Windows | Chrome/Edge Web MIDI or desktop app; a working Windows MIDI driver is required | PWA, NSIS installer, portable EXE |
| macOS | Chrome/Edge Web MIDI or desktop app over CoreMIDI endpoints | PWA, Intel/Apple Silicon DMG and ZIP |
| Linux | Chromium/Chrome Web MIDI or desktop app over system MIDI/ALSA endpoints | PWA, x64 AppImage and DEB |
| Android | Chrome Web MIDI or native MidiManager bridge for USB/BLE | PWA, developer APK; signing needed for Play distribution |
| iPad/iPhone | Native WKWebView plus CoreMIDI, USB and Bluetooth MIDI chooser | Apple-signed app needed for installation/TestFlight/App Store |

**Safari and iPad Home Screen PWAs do not supply Web MIDI.** Their on-screen keyboard,
DAW and supported browser audio features remain usable. Installing the PWA does not grant
hardware MIDI access. The native bridge provides it instead.

## One connection surface

The KEYBOARD strip is present on every page and in Audio & MIDI Settings. It reports the
selected input, sound activation, and the last received note. Connect keyboard requests ordinary
MIDI access. Optional advanced output permission is separate; declining it leaves working note
input intact. Disconnected endpoints never appear as usable ports.

The manager chooses a remembered input first, then a ROLI/LUMI controller, then an available
input. It restores by name when the OS changes an endpoint ID. Outputs are matched to the
selected keyboard, with manual override. System wavetable synths are not automatically selected
as a keyboard output. Track routing, clock and marker PC/CC remain available.

## USB and Bluetooth

- Use a data-capable cable; some cables only charge.
- Mobile devices need USB host support and may need a powered adapter or hub.
- Start with USB for Windows LUMI. A saved Bluetooth entry does not establish a WinMM/Web MIDI input.
- macOS BLE MIDI connects through Audio MIDI Setup's MIDI Studio Bluetooth window.
- Native iPad and Android builds provide Bluetooth MIDI choosers; audio Bluetooth pairing is different.
- Direct BLE in desktop/Android browsers varies; the app exposes controls only where supported.

## Windows Code 10

A LUMI reporting `Code 10 / STATUS_DEVICE_DATA_ERROR` cannot supply usable MIDI to browser code.
The setup panel includes the repair verified on the development Windows PC:

1. Device Manager: Sound, video and game controllers; identify the LUMI USB MIDI interface.
2. It may be named USB Audio Device. View > Show hidden devices can reveal its saved entry.
3. Update driver > Browse my computer > **Let me pick from a list** > **USBMidi2-ACX**.
4. Follow the reconnect/restart guidance if needed, then Connect keyboard.

Only change the identified MIDI keyboard, never an ordinary audio device. LUMI IDs contain
`VID_2AF4&PID_0E00`. This selects Microsoft's installed alternative MIDI class driver and is
reversible by choosing USB Audio Device in the same list. Availability and compatibility depend
on Windows and the MIDI device.

[Microsoft class-driver instructions](https://microsoft.github.io/MIDI/kb/how-to-switch-between-class-drivers/)

## Build and release

```sh
npm ci
npm run build
npm run test:midi
npm run native:verify
npm run native:sync
npm run desktop:pack
```

See [native bridge architecture](NATIVE_MIDI.md) and [release instructions](RELEASING.md).
CI builds desktop packages, an Android developer APK and an unsigned iOS archive. Unsigned Apple
artifacts cannot directly install on a consumer iPad. Production signing and store submission
require the owner's developer accounts and signing setup.

## Verification limits

Automated checks exercise connection lifecycle, permissions, parsing and bundled-origin boundaries.
A successful compile does not establish physical hardware acceptance. Test USB and BLE on actual
iPad, Android, macOS, Linux and Windows devices before a consumer release: sleep/wake, unplug
with held notes, multiple ports and denied permissions. Native shells still use Web Audio; they do
not add ASIO, unrestricted multichannel audio or a new low-latency audio backend.

## Sources

- [Chrome MIDI permission](https://developer.chrome.com/blog/web-midi-permission-prompt)
- [WebKit MIDI implementation issue](https://bugs.webkit.org/show_bug.cgi?id=107250)
- [Apple CoreMIDI](https://developer.apple.com/documentation/coremidi)
- [Android MIDI](https://developer.android.com/reference/android/media/midi/package-summary)
- [ROLI MIDI Bluetooth connection](https://support.roli.com/en/support/solutions/articles/36000582346-how-to-connect-your-roli-device-to-your-computer-via-bluetooth)
