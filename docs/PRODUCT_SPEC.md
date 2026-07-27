# OpenStudio — Product Specification

*This is the refined, expanded version of the original product brief ("improve this prompt as necessary
to maximize output feature at launch"). It defines the target product; the repo tracks progress toward it.*

## Vision

A single music-production app that is a **synthesizer, sampler, and full DAW**, combining FL Studio's
pattern/step workflow with Logic's track/take workflow, running on **iPad, Android, web, and PC** from one
codebase. It should let a musician go from idea → chords → beat → recording real instruments → mixdown
without leaving the app, using open-source building blocks wherever possible.

## Pillars

1. **Compose fast** — chord library, scale-aware piano roll, progressions, step sequencer.
2. **Play expressively** — first-class MPE (ROLI Seaboard), MIDI controllers, Bluetooth MIDI, on-screen keys.
3. **Record for real** — XLR/¼″ instruments and mics through class-compliant audio interfaces, lossless.
4. **Open by default** — open formats (WAV, MIDI, JSON projects), open plugin standards, MIT license.
5. **Runs anywhere** — web-first engine; PWA install; Capacitor (iPad/Android) and Electron/Tauri (PC) shells.

## Feature matrix

### ✅ Shipped (v0.1)

- Multi-track arranger (MIDI + audio clips), loop region, snap grid, zoom
- Polysynth (2 osc, noise, filter + env, 2×ADSR, LFO, unison, glide, presets, MPE per-note expression)
- Sampler (import/record, root note, trim, loop, ADSR)
- Synthesized drum kit + 16th step sequencer
- Piano roll with scale highlighting
- Chord library: diatonic pads, 23 qualities, progressions, insert-to-clip
- Mixer: volume/pan/mute/solo/arm, 8 FX types per track, master limiter
- Audio recording (device selection, lossless PCM), MIDI recording
- Web MIDI + MPE (pitch bend/slide/press), BLE-MIDI direct connect (Chrome/Android)
- WAV export (offline render), project save/open with embedded samples, autosave, undo/redo
- PWA: installable, offline shell

### 🔜 Next (v0.2–v0.4)

- **Automation lanes** (volume/pan/FX params/synth params, drawable curves)
- **Audio editing**: clip gain/fade handles, slicing, reverse, normalize; waveform rendering in clips
- **Time-stretch / warping** (phase vocoder in AudioWorklet) and recording comping (takes lanes)
- **MIDI file import/export**; MusicXML chord export
- **AudioWorklet DSP migration** (lower latency, custom filters — Moog ladder, formant)
- **More instruments**: wavetable synth, FM synth (6-op), granular sampler, slicer (FL-style)
- **Arpeggiator + strum humanizer** on chord pads; scale-lock and chord-track (Logic-style)
- **Song sections** (pattern/playlist model à la FL) and per-clip launch (Live-style performance grid)

### 🔭 Later (v1.0 "launch-max")

- **Plugin hosting**: Web Audio Modules 2.0 (WAM) so open-source plugin ecosystems load in-app;
  investigate CLAP-to-WASM bridges for native shells
- **Sound content**: bundled open sample packs (CC0), SoundFont (.sf2) and SFZ player
- **Mixer routing**: buses/sends, sidechain compression, per-track EQ visualizer, spectrum/loudness meters
- **Video sync** for scoring; Ableton Link tempo sync over Wi-Fi
- **Cloud sync & collaboration** (optional server; CRDT project merge)
- **Native audio backends** in shells: CoreAudio/AUv3 hosting on iPad, AAudio/Oboe on Android, ASIO on Windows
- **Accessibility**: full keyboard operation, screen-reader labels, color-blind-safe themes

## Platform targets

| Platform | Path | Audio backend |
|---|---|---|
| Web (all) | this repo, PWA | Web Audio / AudioWorklet |
| iPad / iPhone | Capacitor shell | WKWebView Web Audio (→ AUv3 host later) |
| Android | Capacitor shell or TWA | Chrome Web Audio (→ Oboe later) |
| Windows / macOS / Linux | Electron or Tauri shell | Chromium Web Audio (→ native drivers later) |

## Non-goals (for now)

- Hosting legacy desktop VST2/VST3 binaries in the web build (impossible in-browser; native shells may bridge later)
- Notation engraving (export MusicXML instead)
- Built-in social network / marketplace

## Design language

Dark, high-contrast, touch-first: 30 px+ hit targets, landscape-optimized, FL-style bottom editors with a
Logic-style linear arranger up top. Every panel usable with one finger on a 11″ tablet.
