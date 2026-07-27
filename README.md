# OpenStudio DAW 🎛

An open, cross-platform **synthesizer + sampler + DAW** in the spirit of FL Studio and Logic —
built web-first so one codebase runs on **iPad, Android, the web, and PC**.

```bash
npm install
npm run dev      # develop at http://localhost:5173
npm run build    # production bundle in dist/
```

No accounts, no server: everything runs locally in the browser (or a wrapped native shell), and
projects autosave to local storage with samples in IndexedDB.

## What's in the box today

| Area | Features |
|---|---|
| **Engine** | Web Audio, sample-accurate lookahead scheduler, loop region, metronome, tempo/time-signature, master limiter |
| **Synthesizer** | Polyphonic subtractive synth: 2 oscillators (+octave/detune), noise, LP/HP/BP filter with envelope, amp + filter ADSR, LFO (vibrato/wah/tremolo), unison up to 4×, glide, 8 presets |
| **Sampler** | Import any audio file (or record your own), root note, start/end trim, loop mode, ADSR |
| **Drums** | Synthesized 8-lane kit (kick/snare/clap/hats/toms/crash) with tune/decay/level per lane — no sample pack needed |
| **Sequencing** | Multi-track arranger with draggable/resizable MIDI + audio clips, piano roll (draw, drag, resize, right-click delete, scale highlighting), 16th-note step sequencer for drums |
| **Mixer & FX** | Per-track volume/pan/mute/solo, FX chains: reverb, delay, chorus, distortion, 3-band EQ, compressor, filter, bitcrusher |
| **Chord tools** | Key + scale selection, diatonic chord pads with roman numerals, 23 chord qualities, 10 classic progressions with audition, insert-to-clip |
| **Recording** | Multi-channel lossless capture from any interface — **XLR / ¼″ via USB interfaces**, per-track input channel/pair selection, dual-signal takes (processed + dry DI simultaneously), latency-compensated; MIDI recording from any controller |
| **Outboard / Helix Stadium** | Device profile with auto-detect, hot-plug fallback & restore, output-pair routing, software monitoring with double-monitor warning, **re-amp workflow** with round-trip compensation, loopback latency measurement, diagnostics runner |
| **ROLI / MPE** | Full MPE input: per-note pitch bend (glide, ±48 st), CC74 slide → filter brightness, channel pressure → loudness |
| **Controllers** | Web MIDI in/out, **MIDI-learn** (footswitch → transport), marker-driven Program Change/CC to hardware (Helix presets/snapshots), **MIDI clock out** at session tempo, Bluetooth MIDI, multi-touch on-screen piano, QWERTY playing |
| **Editing** | Waveforms on clips, trim both edges, split/duplicate/copy/paste, per-clip gain + fades, snap toggle, quantize, velocity editing, **volume/pan automation lanes** (live + in export) |
| **Metering** | Master peak/clip meter + per-track meters |
| **I/O** | WAV mixdown export (offline render honoring fades/automation), project save/open as portable JSON (samples embedded), autosave with unload flush |
| **Platform** | Installable PWA (offline-capable), landscape-first layout, touch-friendly hit targets |

Feature-by-feature audit status (with browser-platform caveats): [docs/AUDIT.md](docs/AUDIT.md).
Automated regression: `npm run build && npx vite preview & npm run qa` (21 headless checks).

## Quick tour

1. Press **▶** — the demo project plays a synth melody over a drum groove.
2. **Keys** tab: play the on-screen piano (multi-touch on tablets) or your QWERTY keyboard (Z–M / Q–U rows).
3. Double-click an empty lane to create a clip; double-click a clip to edit it (piano roll or step grid).
4. **Chords** tab: tap pads to hear chords in your key; right-click/long-press to insert them into the selected clip.
5. Arm a track (● on the track head), press **⏺**, and play — MIDI is captured into a take clip. Arm an **Audio** track to record from your interface/mic.
6. **Export WAV** renders the whole arrangement offline to a 16-bit stereo file.

## Hardware setup

See [docs/HARDWARE.md](docs/HARDWARE.md) for:
- recording guitars, mics and synths over **XLR / ¼″** through USB-C audio interfaces (works on iPad and Android too),
- pairing **Bluetooth MIDI** controllers on each platform,
- getting the most from a **ROLI Seaboard / BLOCKS** (MPE) — the "MPE Expressive" synth preset is tuned for it.

## Shipping to each platform

See [docs/PLATFORMS.md](docs/PLATFORMS.md). Short version: the web build is already installable as a PWA on
iPad/Android/desktop; wrap with **Capacitor** for App Store / Play Store builds and with **Electron/Tauri** for
desktop, all from this same codebase.

## Roadmap

The full product vision (the "maximize features at launch" spec this repo is building toward) lives in
[docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md): audio warping, automation lanes, plugin hosting (WAM/CLAP-web),
AudioWorklet DSP, MIDI export, cloud sync, collaboration, and more.

## Tech notes

- React 18 + TypeScript + Vite; zero runtime dependencies beyond React.
- Custom store on `useSyncExternalStore` with snapshot undo/redo.
- All instruments/FX are parameterized by `BaseAudioContext`, so the same code renders live and offline (WAV export).
- Recording uses raw PCM capture (no lossy MediaRecorder detour).

## License

MIT — use it, fork it, make music with it.
