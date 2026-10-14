# Standalone iPad installation from Windows

Use the native `SoundLAB-Studio-ios-unsigned.ipa` from the developer release. It contains the shared SoundLAB interface, instruments, samples and a CoreMIDI connection for LUMI. Safari / Add to Home Screen does not provide direct hardware MIDI access.

An App Store submission and a Mac are not required for this route. The IPA must still be signed for your device. AltStore Classic can perform that signing with your Apple ID from Windows; this exact SoundLAB IPA still needs a physical-device installation and LUMI acceptance test.

1. Follow [AltStore's official Windows setup](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows), including its Apple software prerequisites, USB pairing and device setup.
2. Complete Apple ID authentication yourself in the installer. Keep credentials outside SoundLAB and its source files.
3. Import the SoundLAB IPA into AltStore Classic and install it with your account. Retain the same signing account and bundle identity when updating so local projects can remain in the app.
4. Open SoundLAB, attach LUMI using a USB data cable and suitable iPad adapter, then tap **Connect keyboard**. For wireless use, choose **Bluetooth MIDI** inside SoundLAB.
5. Confirm notes, note release, disconnect/reconnect and sound. A powered USB adapter may be needed.

The computer is used for installation and signing renewal, not for playing. With a free Apple ID, AltStore apps expire after seven days; use its refresh flow before expiry. See [AltStore's renewal guidance](https://faq.altstore.io/altstore-classic/your-altstore). Export important projects before changing installations.

The native iPad build has compiled in CI. Signing, device installation, USB/Bluetooth LUMI and native recording have not been verified on a physical iPad in this workspace.
