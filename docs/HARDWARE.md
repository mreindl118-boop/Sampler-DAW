# Hardware guide — interfaces, controllers, ROLI

## Recording real instruments (XLR / ¼″)

OpenStudio records from **any input the OS exposes**. For XLR microphones and ¼″ (TS/TRS) guitar/synth
lines, use a class-compliant USB audio interface:

| Device class | Examples | Works on |
|---|---|---|
| USB-C interfaces | Focusrite Scarlett (2i2/4i4), Behringer UMC, MOTU M2, Audient iD | PC, Mac, iPad (USB-C), Android (USB-OTG) |
| Mobile-first | IK iRig Pro I/O, iRig HD X | iPad, Android, PC |
| Mixers-as-interface | Yamaha MG-XU, Behringer Flow 8 | PC, iPad |

Steps:
1. Plug the interface in **before** opening the app (or refresh after).
2. **⚙ Settings → Audio input** — pick the interface.
3. **+ Audio** track → arm it (●) → **⏺**. Recording is lossless PCM at the device sample rate.
4. The take lands on the timeline at the record position; the sample also appears in the Sampler's source list,
   so you can immediately play your recording chromatically.

Tips: disable OS "voice processing" enhancements; the app already requests raw audio
(echo cancellation/AGC/noise suppression off). Use direct-monitoring on the interface while tracking.

## MIDI controllers (USB & Bluetooth)

- **USB MIDI**: plug in and play — every class-compliant keyboard/pad works via Web MIDI (Chrome/Edge/Electron).
- **Bluetooth MIDI**:
  - *iPad*: pair via GarageBand/AUM's Bluetooth MIDI panel or Settings; it then appears as a normal MIDI input.
  - *Android/Chrome & desktop Chrome*: **⚙ Settings → Connect BLE MIDI device** connects directly over Web Bluetooth.
  - *macOS*: Audio MIDI Setup → Bluetooth → Connect.
- The **armed** (or selected) instrument track receives MIDI; play live or record takes with ⏺.

## ROLI Seaboard / BLOCKS (MPE)

OpenStudio speaks full MPE:

| ROLI dimension | MIDI | What it does here |
|---|---|---|
| **Strike** | note-on velocity | initial loudness |
| **Glide** | per-note pitch bend (±48 st) | continuous pitch per finger |
| **Slide** | CC74 per note | filter brightness per finger |
| **Press** | channel pressure | continuous loudness per finger |
| **Lift** | release velocity | (reserved) |

Setup:
1. Connect the Seaboard (USB or Bluetooth). Keep ROLI Dashboard's default **MPE mode** (lower zone, ch 2–16, ±48).
2. In **⚙ Settings**, ensure **MPE** is enabled (default).
3. Pick a synth track and load the **"MPE Expressive (ROLI)"** preset — its bend range is pre-set to ±48.
   For any other patch, set *Bend Rng* to 48 in the Instrument tab.

Every finger gets its own synth voice, so bending one note doesn't drag the rest of the chord — slides and
pressure swells behave like on Equator.

## On-screen & QWERTY

- **Keys tab**: multi-touch piano (velocity by touch height on white keys), octave/range/velocity controls.
- **QWERTY**: `Z S X D C …` = lower octave, `Q 2 W 3 E …` = upper octave; `Space` = play/stop; `Ctrl+Z` undo.
