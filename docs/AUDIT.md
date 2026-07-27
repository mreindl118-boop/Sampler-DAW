# Feature Audit — Essential DAW Checklist

Status after the v0.2 audit/implementation pass. Legend: ✅ complete · 🟡 complete with browser-platform limits · ❌ out of scope for the web build (documented).

Automated regression: `npm run build && npx vite preview` then `npm run qa` — 21 headless-browser checks
covering boot, transport, recording, clip ops, automation, persistence, export, and diagnostics (21/21 passing).

## Core audio engine

| Item | Status | Notes / where |
|---|---|---|
| Play / pause / stop / record / RTZ | ✅ | Space = play/pause (keeps position); ⏹ returns to play-start, again → zero; ⏮ = RTZ (`engine.stopReturn`) |
| Loop with definable region | ✅ | Drag on ruler defines region; scheduler wraps sample-accurately with origin rebase (`transport.ts`) |
| Sample-accurate scheduling, no drift | ✅ | Single AudioContext clock, 120 ms lookahead scheduler; all tracks share one timebase |
| Smooth playhead | ✅ | rAF-driven transform, no React re-render per frame |
| Tempo / time signature / metronome | ✅ | Tempo rebases mid-playback without position jump; accented downbeat click |
| Master bus, volume, peak/clip metering | ✅ | Master fader + limiter; peak meter with clip indicator in transport bar, per-strip meters in mixer |
| Context lifecycle | ✅ | Lazy create + resume on gesture; voices reaped; sources stopped and params reset on stop; unload flushes autosave |

## Outboard interface — Line 6 Helix Stadium XL

Device-agnostic layer: `src/audio/audioIO.ts`; Stadium profile (`HELIX_STADIUM`) on top; everything degrades to the system default device.

| Item | Status | Notes |
|---|---|---|
| Device enumeration, independent in/out selection, persistence, Stadium auto-detect | ✅ | Settings → Audio devices; selection persisted in localStorage; name-regex auto-detect with one-click "use for input & output" and auto-select on hot-plug |
| Hot-plug: fallback + restore | ✅ | `devicechange` listener; falls back to default with a toast, remembers the wanted device by label and restores it on reconnect; graph never goes dead (output rewires via `rewireOutputs`) |
| Multi-channel I/O, per-track input source, output pair routing | 🟡 | Input requested at 8 ch (EC/NS/AGC off); per-track source = any mono channel or stereo pair (mixer strip); per-track + master routing to any available output pair via ChannelMerger. **Browser limit:** Chrome commonly delivers only 2 input channels for class-compliant interfaces and >2-channel output only where the OS exposes it; actual counts are surfaced in Settings/diagnostics, never silently assumed |
| Native sample rate, resample imports, surface mismatch | ✅ | Engine runs at device rate; WAV headers parsed for true source rate with a toast when resampled; input stream rate mismatches toasted. 24-bit arrives as float32 — no truncation |
| Platform layer (browser path) | ✅ | echoCancellation/noiseSuppression/autoGainControl explicitly false, channelCount ideal 8, `AudioContext.setSinkId` for output, latencyHint control, limits documented in-app + here. ASIO/Core Audio native backends are the documented path for a wrapped build (docs/PLATFORMS.md) |
| Dual-signal recording (USB 1/2 + USB 7 DI in one take) | ✅ | One shared multichannel capture; every armed audio track slices its own channels — arm two tracks with sources In 1/2 and In 7 and record once |
| Re-amping with round-trip compensation | ✅ | Settings → Re-amp: dry track → chosen out pair, records the return, new track aligned using the measured offset |
| Monitoring | ✅ | Per-track 👂 software-monitor toggle on audio strips (active while armed); double-monitoring warning when a Stadium profile is active (hardware monitors USB 1/2 itself) |
| Latency: adjustable, reported, compensated | 🟡 | latencyHint selector (browser's buffer control), base/output latency reported live, loopback round-trip measurement, recording offset (auto-set from measurement, user-editable) applied to all recordings and re-amps. Exact sample buffer sizes are not user-settable in browsers — native-build territory |
| MIDI in (learn → transport) | ✅ | MIDI-learn for play/stop, record, loop, RTZ, marker prev/next, undo; CC and PC both learnable; mappings persist |
| MIDI out (PC/CC per section, clock) | ✅ | Timeline markers carry Program Change + CC (e.g. Helix snapshot CC69) sent as playback passes them; MIDI clock 24 PPQN at project tempo with Start/Continue/Stop; per-track note output to any hardware MIDI port |
| Verification pass | ✅ | Settings → Diagnostics: enumeration, input open, 2 s per-channel peak/RMS capture, output layout, latency status, hot-plug guidance; plus `npm run qa` automated suite |

## Tracks & mixing

| Item | Status |
|---|---|
| Create / delete / rename (double-click) / reorder (↑↓) | ✅ |
| Fader, pan, mute, solo — solo silences in the audio graph (gate gain per channel) | ✅ |
| Per-track level metering | ✅ |
| Record-arm, input monitoring, input source selection via IO layer | ✅ |
| Tracks sum to master without clipping (limiter + clip LED) | ✅ |

## Clips & timeline

| Item | Status |
|---|---|
| Import via file picker + drag-and-drop (WAV/MP3/OGG/FLAC) | ✅ |
| Waveform rendering on clips | ✅ (canvas peaks) |
| Move, trim start, trim end, split at playhead, duplicate, delete, copy/paste | ✅ |
| Fade in/out per clip (live + export) | ✅ (clip inspector in Mixer) |
| Snap on/off toggle + resolution | ✅ |
| Bars/beats ruler, zoom, horizontal scroll | ✅ |

## MIDI

| Item | Status |
|---|---|
| Piano roll: add/move/resize/delete, velocity editing (Alt+drag) | ✅ |
| Built-in synth driven by MIDI clips | ✅ (3 instruments) |
| Quantize to grid | ✅ (piano-roll toolbar) |
| MIDI tracks → external hardware ports (incl. Stadium) | ✅ (per-strip MIDI destination) |

## Effects

| Item | Status |
|---|---|
| Insert chain with EQ, compressor, reverb, delay (+ chorus, distortion, filter, bitcrush) | ✅ |
| Bypass toggle + adjustable params, real-time | ✅ |

## Recording

| Item | Status |
|---|---|
| Records to armed track at timeline position with selected channels + offset compensation | ✅ |
| Recorded audio is a normal editable clip (trim/split/fade/move) | ✅ |

## Automation

| Item | Status |
|---|---|
| Volume + pan lanes per track | ✅ (A button on track head) |
| Draw / drag / right-click-delete points; applies during playback and in WAV export | ✅ |

## Project management

| Item | Status |
|---|---|
| Save/load full state (incl. automation, markers, channel/output/MIDI routing, device labels) | ✅ (migration fills defaults for old files) |
| Complex-project round-trip without loss | ✅ (QA-verified through reload; autosave now flushes on unload) |
| Export/bounce mix to WAV | ✅ (offline render honoring fades + automation) |
| Undo/redo across destructive ops | ✅ (gesture-scoped snapshots) |
| Shortcuts: Space, Ctrl+E split, Delete, Ctrl+Z/Shift+Z, Ctrl+S, Ctrl+D, Ctrl+C/V | ✅ |

## UI baseline

| Item | Status |
|---|---|
| Every control wired | ✅ (QA + manual pass) |
| Meters/playhead/waveforms update without blocking audio | ✅ (rAF polling; audio runs on the context thread) |
| Layout under overflow | ✅ (scrollable arranger/mixer/panels) |
| Device settings panel: devices, routing, buffer, measured latency | ✅ |

## Known limitations / deliberate scope cuts (browser platform)

1. **Input channel width** is whatever the browser delivers (often 2). The code requests 8 and adapts; diagnostics show the truth. Full 8×8 needs the wrapped native build (ASIO/Core Audio) described in docs/PLATFORMS.md.
2. **Buffer size** is controlled via latencyHint only; hard sample-count buffer settings are a native-build feature.
3. **Round-trip measurement** needs a physical loopback (or acoustic path) — it reports "no signal" rather than guessing.
4. **MIDI clock jitter**: Web MIDI send timestamps are used, but browsers provide ~1 ms scheduling, adequate for Helix tempo-sync, below hardware-sequencer tightness.
5. iPadOS Safari still lacks Web MIDI: MIDI features need Chrome/Edge/Electron or the Capacitor build with the CoreMIDI bridge.
