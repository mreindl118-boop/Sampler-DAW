import type { AudioClip, Clip, FxUnit, Project, Track } from '../state/types'
import {
  addMarker, getState, mapTrack, setProject, setUI, subscribeStore, undo,
} from '../state/store'
import { uid } from '../state/presets'
import { getSettings } from '../state/settings'
import { toast } from '../state/toasts'
import { Transport } from './transport'
import { PolySynth, type Instrument } from './synth'
import { SamplerInstrument, sampleStore } from './sampler'
import { DrumKit } from './drums'
import { buildFxChain } from './effects'
import { InputRecorder, bufferFromCapture } from './recorder'
import { audioIO, wavSampleRate } from './audioIO'
import { scheduleLane } from './automation'
import { saveSampleToIDB } from '../util/idb'
import { audioBufferToWav } from './wav'
import {
  MIDI_CLOCK, MIDI_CONTINUE, MIDI_START, MIDI_STOP,
  registerMidiActions, sendControlChange, sendNoteOff, sendNoteOn, sendProgramChange, sendRealtime,
} from '../midi/midi'

interface Channel {
  trackId: string
  input: GainNode // audio-clip bus; instruments connect here too
  instrument: Instrument | null
  fx: { input: AudioNode; output: AudioNode; dispose(): void }
  gate: GainNode // mute/solo (0 or 1)
  vol: GainNode // fader value or volume automation
  pan: StereoPannerNode
  analyser: AnalyserNode
  fxRef: FxUnit[]
  paramsRef: unknown
  kind: Track['kind']
  outputPair: number // -1 = master
  monitorTap: GainNode | null
}

interface PendingRecNote {
  startBeat: number
  vel: number
}

class Engine {
  ctx: AudioContext | null = null
  transport: Transport | null = null
  metronome = true

  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  analyser: AnalyserNode | null = null
  private channels = new Map<string, Channel>()
  private activeSources: AudioBufferSourceNode[] = []
  private recorder: InputRecorder | null = null
  private pendingRecNotes = new Map<string, PendingRecNote>()
  private recordClipByTrack = new Map<string, string>()
  private recordAudioTracks: string[] = []
  private recordPlayOrigin: { ctxTime: number; beat: number } | null = null
  private loopWasOn = false
  private attached = false
  private playStartBeat = 0
  private masterPairRef = -1
  private clockRunning = false
  private meterData: Float32Array<ArrayBuffer> | null = null

  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: getSettings().latencyHint })
      this.transport = new Transport(this.ctx)
      this.master = this.ctx.createGain()
      this.limiter = this.ctx.createDynamicsCompressor()
      this.limiter.threshold.value = -3
      this.limiter.ratio.value = 20
      this.limiter.attack.value = 0.002
      this.limiter.release.value = 0.1
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.master.connect(this.limiter)
      this.limiter.connect(this.analyser)
      audioIO.attach(this.ctx)
      this.routeMaster(getState().project.master.outputPair)
      audioIO.onChange(() => this.rewireOutputs())
      this.transport.onWindow = (a, b, b2t) => this.scheduleWindow(a, b, b2t)
      this.transport.onLoopWrap = () => this.onLoopWrap()
      this.transport.onStop = () => this.onTransportStop()
      this.registerTransportMidiActions()
      this.attach()
      this.sync(getState().project)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private attach(): void {
    if (this.attached) return
    this.attached = true
    subscribeStore(() => {
      const p = getState().project
      if (this.transport) {
        this.transport.tempo === p.tempo || this.transport.setTempo(p.tempo)
        if (!getState().ui.recording) this.transport.loop = { ...p.loop }
      }
      this.sync(p)
    })
  }

  private registerTransportMidiActions(): void {
    registerMidiActions({
      playStop: () => this.togglePlay(),
      record: () => (getState().ui.recording ? void this.stopRecord() : void this.record()),
      loopToggle: () => setProject((p) => ({ ...p, loop: { ...p.loop, on: !p.loop.on } })),
      returnToZero: () => this.setPosition(0),
      prevMarker: () => this.gotoMarker(-1),
      nextMarker: () => this.gotoMarker(1),
      undo: () => undo(),
    })
  }

  gotoMarker(dir: -1 | 1): void {
    const { markers } = getState().project
    if (markers.length === 0) return
    const pos = this.position()
    const eps = 0.01
    const target =
      dir > 0
        ? markers.find((m) => m.beat > pos + eps)
        : [...markers].reverse().find((m) => m.beat < pos - eps)
    this.setPosition(target ? target.beat : dir > 0 ? markers[markers.length - 1].beat : 0)
  }

  // ---------- output routing ----------

  private routeMaster(pair: number): void {
    if (!this.analyser) return
    try { this.analyser.disconnect() } catch { /* ok */ }
    this.analyser.connect(audioIO.getOutputPair(Math.max(0, pair)))
    this.masterPairRef = pair
  }

  /** Re-connect master + direct-out tracks after the output device/bus changed. */
  private rewireOutputs(): void {
    if (!this.ctx) return
    this.routeMaster(getState().project.master.outputPair)
    for (const [id, ch] of this.channels) {
      const track = getState().project.tracks.find((t) => t.id === id)
      if (!track) continue
      this.routeChannel(ch, track.outputPair)
    }
  }

  private routeChannel(ch: Channel, pair: number): void {
    try { ch.analyser.disconnect() } catch { /* ok */ }
    if (pair >= 0 && audioIO.outputPairCount() > pair) {
      ch.analyser.connect(audioIO.getOutputPair(pair))
    } else if (pair >= 0) {
      // requested pair not available on this hardware — fall back audibly, not silently
      ch.analyser.connect(this.master!)
    } else {
      ch.analyser.connect(this.master!)
    }
    ch.outputPair = pair
  }

  // ---------- graph sync ----------

  sync(project: Project): void {
    if (!this.ctx) return
    const ctx = this.ctx
    const seen = new Set<string>()
    for (const track of project.tracks) {
      seen.add(track.id)
      let ch = this.channels.get(track.id)
      if (!ch) {
        ch = this.createChannel(track)
        this.channels.set(track.id, ch)
      }
      if (ch.fxRef !== track.fx) {
        ch.fx.dispose()
        const src: AudioNode = ch.instrument ? ch.instrument.output : ch.input
        try { src.disconnect() } catch { /* ok */ }
        ch.fx = buildFxChain(ctx, track.fx)
        src.connect(ch.fx.input)
        ch.fx.output.connect(ch.gate)
        ch.fxRef = track.fx
      }
      const params = track.synth ?? track.sampler ?? track.drums ?? null
      if (params && ch.instrument && ch.paramsRef !== params) {
        ch.instrument.update(params)
        ch.paramsRef = params
      }
      if (ch.outputPair !== track.outputPair) this.routeChannel(ch, track.outputPair)
      if (!this.isPlaying()) {
        ch.pan.pan.setTargetAtTime(track.pan, ctx.currentTime, 0.02)
        ch.vol.gain.setTargetAtTime(track.volume, ctx.currentTime, 0.02)
      }
    }
    for (const [id, ch] of this.channels) {
      if (!seen.has(id)) {
        ch.instrument?.dispose()
        ch.fx.dispose()
        ch.gate.disconnect()
        ch.vol.disconnect()
        ch.pan.disconnect()
        ch.analyser.disconnect()
        if (ch.monitorTap) audioIO.releaseTap(ch.monitorTap)
        try { ch.input.disconnect() } catch { /* ok */ }
        this.channels.delete(id)
      }
    }
    this.master!.gain.value = project.master.volume
    if (this.masterPairRef !== project.master.outputPair) this.routeMaster(project.master.outputPair)
    this.applyMixState(project)
    this.syncMonitors(project)
  }

  private createChannel(track: Track): Channel {
    const ctx = this.ctx!
    const input = ctx.createGain()
    let instrument: Instrument | null = null
    if (track.kind === 'synth' && track.synth) instrument = new PolySynth(ctx, track.synth)
    if (track.kind === 'sampler' && track.sampler) instrument = new SamplerInstrument(ctx, track.sampler)
    if (track.kind === 'drums' && track.drums) instrument = new DrumKit(ctx, track.drums)
    const fx = buildFxChain(ctx, track.fx)
    const gate = ctx.createGain()
    const vol = ctx.createGain()
    vol.gain.value = track.volume
    const pan = ctx.createStereoPanner()
    pan.pan.value = track.pan
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    const source: AudioNode = instrument ? instrument.output : input
    source.connect(fx.input)
    fx.output.connect(gate)
    gate.connect(vol)
    vol.connect(pan)
    pan.connect(analyser)
    const ch: Channel = {
      trackId: track.id,
      input,
      instrument,
      fx,
      gate,
      vol,
      pan,
      analyser,
      fxRef: track.fx,
      paramsRef: track.synth ?? track.sampler ?? track.drums ?? null,
      kind: track.kind,
      outputPair: -999,
      monitorTap: null,
    }
    this.routeChannel(ch, track.outputPair)
    return ch
  }

  private applyMixState(project: Project): void {
    const anySolo = project.tracks.some((t) => t.solo)
    for (const track of project.tracks) {
      const ch = this.channels.get(track.id)
      if (!ch) continue
      const audible = !track.mute && (!anySolo || track.solo)
      ch.gate.gain.setTargetAtTime(audible ? 1 : 0, this.ctx!.currentTime, 0.02)
    }
  }

  /** Software input monitoring for armed audio tracks. */
  private syncMonitors(project: Project): void {
    for (const track of project.tracks) {
      const ch = this.channels.get(track.id)
      if (!ch || track.kind !== 'audio') continue
      const want = track.armed && track.monitor
      if (want && !ch.monitorTap) {
        const connectTap = () => {
          if (!audioIO.inputIsOpen()) return
          const current = this.channels.get(track.id)
          const tState = getState().project.tracks.find((t) => t.id === track.id)
          if (!current || !tState || !(tState.armed && tState.monitor) || current.monitorTap) return
          current.monitorTap = audioIO.getTap(tState.inputChannels)
          current.monitorTap.connect(current.input)
          if (audioIO.activeProfile()) {
            toast(
              'Software monitoring is on — the Helix Stadium already hardware-monitors USB 1/2; disable one to avoid double-monitoring',
              'warn',
              7000
            )
          }
        }
        if (audioIO.inputIsOpen()) connectTap()
        else {
          audioIO
            .openInput()
            .then(connectTap)
            .catch((e) => toast(`Cannot open audio input for monitoring: ${e}`, 'error'))
        }
      } else if (!want && ch.monitorTap) {
        audioIO.releaseTap(ch.monitorTap)
        ch.monitorTap = null
      }
    }
  }

  // ---------- metering ----------

  /** Peak level 0..1 for a track (or master with trackId null). */
  meterPeak(trackId: string | null): number {
    const analyser = trackId ? this.channels.get(trackId)?.analyser : this.analyser
    if (!analyser) return 0
    if (!this.meterData || this.meterData.length < analyser.fftSize) {
      this.meterData = new Float32Array(analyser.fftSize)
    }
    const buf = this.meterData.subarray(0, analyser.fftSize)
    analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i])
      if (a > peak) peak = a
    }
    return peak
  }

  // ---------- transport ----------

  play(): void {
    this.ensure()
    const p = getState().project
    this.transport!.tempo = p.tempo
    this.transport!.loop = { ...p.loop }
    this.playStartBeat = this.transport!.currentBeat()
    this.transport!.play()
    this.scheduleSpanningAudioAt(this.transport!.currentBeat())
    this.sendClockStart()
  }

  /** Pause: stop playback, keep position (Space). */
  stop(): void {
    if (!this.transport) return
    if (getState().ui.recording) void this.stopRecord()
    this.transport.stop()
  }

  /** Stop button: stop and return to where playback started; if already there, go to zero. */
  stopReturn(): void {
    this.ensure()
    if (this.transport!.playing) {
      this.stop()
      this.transport!.setPosition(this.playStartBeat)
    } else if (Math.abs(this.transport!.currentBeat() - this.playStartBeat) > 0.001) {
      this.transport!.setPosition(this.playStartBeat)
    } else {
      this.transport!.setPosition(0)
    }
  }

  togglePlay(): void {
    this.ensure()
    if (this.transport!.playing) this.stop()
    else this.play()
  }

  isPlaying(): boolean {
    return this.transport?.playing ?? false
  }

  position(): number {
    return this.transport?.currentBeat() ?? 0
  }

  setPosition(beat: number): void {
    this.ensure()
    const wasPlaying = this.transport!.playing
    if (wasPlaying) {
      this.stopActiveSources()
      this.allNotesOff()
    }
    this.transport!.setPosition(beat)
    if (wasPlaying) this.scheduleSpanningAudioAt(beat)
  }

  private onTransportStop(): void {
    this.stopActiveSources()
    this.allNotesOff()
    this.resetAutomatedParams()
    this.sendClockStop()
  }

  /** After playback, restore fader/pan params that automation may have driven. */
  private resetAutomatedParams(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const track of getState().project.tracks) {
      const ch = this.channels.get(track.id)
      if (!ch) continue
      ch.vol.gain.cancelScheduledValues(now)
      ch.vol.gain.setTargetAtTime(track.volume, now, 0.02)
      ch.pan.pan.cancelScheduledValues(now)
      ch.pan.pan.setTargetAtTime(track.pan, now, 0.02)
    }
  }

  private allNotesOff(): void {
    for (const ch of this.channels.values()) ch.instrument?.allNotesOff()
  }

  private stopActiveSources(): void {
    const t = this.ctx?.currentTime ?? 0
    for (const s of this.activeSources) {
      try { s.stop(t + 0.02) } catch { /* ok */ }
    }
    this.activeSources = []
  }

  private ctxToPerf(audioTime: number): number {
    return performance.now() + (audioTime - this.ctx!.currentTime) * 1000
  }

  // ---------- MIDI clock ----------

  private sendClockStart(): void {
    const s = getSettings()
    if (!s.midiClockEnabled || !s.midiClockOutId) return
    sendRealtime(s.midiClockOutId, this.position() < 0.001 ? MIDI_START : MIDI_CONTINUE)
    this.clockRunning = true
  }

  private sendClockStop(): void {
    const s = getSettings()
    if (this.clockRunning && s.midiClockOutId) sendRealtime(s.midiClockOutId, MIDI_STOP)
    this.clockRunning = false
  }

  // ---------- scheduling ----------

  private scheduleWindow(fromBeat: number, toBeat: number, beatToTime: (b: number) => number): void {
    const { project } = getState()
    const anySolo = project.tracks.some((t) => t.solo)
    const settings = getSettings()

    for (const track of project.tracks) {
      const ch = this.channels.get(track.id)
      if (!ch) continue
      // automation runs regardless of mute (gate handles audibility)
      for (const lane of track.automation) {
        if (!lane.enabled || lane.points.length === 0) continue
        if (lane.param === 'volume') scheduleLane(ch.vol.gain, lane, fromBeat, toBeat, beatToTime, track.volume)
        if (lane.param === 'pan') scheduleLane(ch.pan.pan, lane, fromBeat, toBeat, beatToTime, track.pan)
      }
      if (track.mute || (anySolo && !track.solo)) continue
      for (const clip of track.clips) {
        if (clip.kind === 'midi') {
          this.scheduleMidiClip(track, clip, ch, fromBeat, toBeat, beatToTime)
        } else if (clip.start >= fromBeat && clip.start < toBeat) {
          this.startAudioClip(clip, ch, beatToTime(clip.start), 0)
        }
      }
    }

    // metronome
    if (this.metronome && this.transport) {
      const firstBeat = Math.ceil(fromBeat - 1e-9)
      for (let b = firstBeat; b < toBeat; b++) {
        this.click(beatToTime(b), b % project.timeSig[0] === 0)
      }
    }

    // markers → Program Change / CC to outboard gear (Helix presets & snapshots)
    if (settings.midiPcOutId) {
      for (const m of project.markers) {
        if (m.beat >= fromBeat && m.beat < toBeat) {
          const at = this.ctxToPerf(beatToTime(m.beat))
          if (m.pc !== null) sendProgramChange(settings.midiPcOutId, settings.midiPcChannel, m.pc, at)
          for (const cc of m.ccs) sendControlChange(settings.midiPcOutId, settings.midiPcChannel, cc.num, cc.val, at)
        }
      }
    }

    // MIDI clock at 24 PPQN
    if (settings.midiClockEnabled && settings.midiClockOutId && this.clockRunning) {
      const tick = 1 / 24
      const firstTick = Math.ceil(fromBeat / tick - 1e-9)
      for (let i = firstTick; i * tick < toBeat; i++) {
        sendRealtime(settings.midiClockOutId, MIDI_CLOCK, this.ctxToPerf(beatToTime(i * tick)))
      }
    }
  }

  private scheduleMidiClip(
    track: Track,
    clip: Extract<Clip, { kind: 'midi' }>,
    ch: Channel,
    fromBeat: number,
    toBeat: number,
    beatToTime: (b: number) => number
  ): void {
    const spb = this.transport!.secondsPerBeat
    for (const note of clip.notes) {
      const abs = clip.start + note.start
      if (abs >= fromBeat && abs < toBeat && note.start < clip.length) {
        const t = beatToTime(abs)
        const durSec = Math.max(0.05, note.dur * spb)
        ch.instrument?.noteOn(note.pitch, note.vel, t)
        ch.instrument?.noteOff(note.pitch, t + durSec)
        // external hardware MIDI out (e.g. to the Helix Stadium DIN/USB MIDI)
        if (track.midiOutId) {
          const at = this.ctxToPerf(t)
          sendNoteOn(track.midiOutId, track.midiOutChannel, note.pitch, note.vel, at)
          sendNoteOff(track.midiOutId, track.midiOutChannel, note.pitch, at + durSec * 1000)
        }
      }
    }
  }

  private startAudioClip(clip: AudioClip, ch: Channel, when: number, skipBeats: number): void {
    const buffer = sampleStore.get(clip.sampleId)
    if (!buffer || !this.ctx || !this.transport) return
    const spb = this.transport.secondsPerBeat
    const skipSec = skipBeats * spb
    const durSec = clip.length * spb - skipSec
    if (durSec <= 0.01) return
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const g = this.ctx.createGain()
    // clip gain with fade in/out (fades defined in beats)
    const fadeInSec = Math.max(0, clip.fadeIn * spb - skipSec)
    const fadeOutSec = Math.min(clip.fadeOut * spb, durSec)
    if (clip.fadeIn > 0 && fadeInSec > 0.001) {
      g.gain.setValueAtTime(0.0001, when)
      g.gain.linearRampToValueAtTime(clip.gain, when + fadeInSec)
    } else {
      g.gain.setValueAtTime(clip.gain, when)
    }
    if (fadeOutSec > 0.001) {
      g.gain.setValueAtTime(clip.gain, when + durSec - fadeOutSec)
      g.gain.linearRampToValueAtTime(0.0001, when + durSec)
    }
    src.connect(g)
    g.connect(ch.input)
    src.start(when, clip.offset + skipSec, durSec)
    src.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== src)
      try { src.disconnect(); g.disconnect() } catch { /* ok */ }
    }
    this.activeSources.push(src)
  }

  private scheduleSpanningAudioAt(beat: number): void {
    const { project } = getState()
    const anySolo = project.tracks.some((t) => t.solo)
    const when = (this.ctx?.currentTime ?? 0) + 0.07
    for (const track of project.tracks) {
      if (track.mute || (anySolo && !track.solo)) continue
      const ch = this.channels.get(track.id)
      if (!ch) continue
      for (const clip of track.clips) {
        if (clip.kind === 'audio' && clip.start < beat && clip.start + clip.length > beat) {
          this.startAudioClip(clip, ch, when, beat - clip.start)
        }
      }
    }
  }

  private onLoopWrap(): void {
    const start = this.transport!.loop.start
    const { project } = getState()
    const anySolo = project.tracks.some((t) => t.solo)
    const when = this.transport!.beatToTime(start)
    for (const track of project.tracks) {
      if (track.mute || (anySolo && !track.solo)) continue
      const ch = this.channels.get(track.id)
      if (!ch) continue
      for (const clip of track.clips) {
        if (clip.kind === 'audio' && clip.start < start && clip.start + clip.length > start) {
          this.startAudioClip(clip, ch, when, start - clip.start)
        }
      }
    }
  }

  private click(time: number, accent: boolean): void {
    if (!this.ctx || !this.master) return
    const osc = this.ctx.createOscillator()
    osc.frequency.value = accent ? 1600 : 1100
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(accent ? 0.25 : 0.15, time)
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05)
    osc.connect(g)
    g.connect(this.master)
    osc.start(time)
    osc.stop(time + 0.06)
  }

  // ---------- live input (keyboard / MIDI / chord pads) ----------

  private liveTarget(): Channel | null {
    const { project, ui } = getState()
    const armed = project.tracks.find((t) => t.armed && t.kind !== 'audio')
    const track = armed ?? project.tracks.find((t) => t.id === ui.selectedTrackId && t.kind !== 'audio')
      ?? project.tracks.find((t) => t.kind !== 'audio')
    return track ? this.channels.get(track.id) ?? null : null
  }

  liveNoteOn(pitch: number, vel: number, channel = 0): void {
    this.ensure()
    const ch = this.liveTarget()
    ch?.instrument?.noteOn(pitch, vel, this.ctx!.currentTime, channel)
    const track = ch && getState().project.tracks.find((t) => t.id === ch.trackId)
    if (track?.midiOutId) sendNoteOn(track.midiOutId, track.midiOutChannel, pitch, vel)
    const { ui } = getState()
    if (ui.recording && this.transport?.playing && ch) {
      const clipId = this.recordClipByTrack.get(ch.trackId)
      if (clipId) this.pendingRecNotes.set(`${channel}:${pitch}:${ch.trackId}`, { startBeat: this.transport.currentBeat(), vel })
    }
  }

  liveNoteOff(pitch: number, channel = 0): void {
    if (!this.ctx) return
    const ch = this.liveTarget()
    ch?.instrument?.noteOff(pitch, this.ctx.currentTime, channel)
    const track = ch && getState().project.tracks.find((t) => t.id === ch.trackId)
    if (track?.midiOutId) sendNoteOff(track.midiOutId, track.midiOutChannel, pitch)
    if (ch && this.transport) {
      const key = `${channel}:${pitch}:${ch.trackId}`
      const pending = this.pendingRecNotes.get(key)
      const clipId = this.recordClipByTrack.get(ch.trackId)
      if (pending && clipId) {
        this.pendingRecNotes.delete(key)
        this.commitRecordedNote(ch.trackId, clipId, pitch, pending, this.transport.currentBeat())
      }
    }
  }

  livePitchBend(semitones: number, channel = 0): void {
    this.liveTarget()?.instrument?.pitchBend?.(semitones, channel)
  }

  livePressure(value: number, channel = 0): void {
    this.liveTarget()?.instrument?.pressure?.(value, channel)
  }

  liveTimbre(value: number, channel = 0): void {
    this.liveTarget()?.instrument?.timbre?.(value, channel)
  }

  playChord(pitches: number[], vel = 0.8, durSec = 0.9, strumMs = 18): void {
    this.ensure()
    const ch = this.liveTarget()
    if (!ch?.instrument) return
    const t0 = this.ctx!.currentTime
    pitches.forEach((p, i) => {
      const t = t0 + (i * strumMs) / 1000
      ch.instrument!.noteOn(p, vel, t)
      ch.instrument!.noteOff(p, t + durSec)
    })
  }

  private commitRecordedNote(trackId: string, clipId: string, pitch: number, pending: PendingRecNote, endBeat: number): void {
    const { project } = getState()
    const track = project.tracks.find((t) => t.id === trackId)
    const clip = track?.clips.find((c) => c.id === clipId)
    if (!track || !clip || clip.kind !== 'midi') return
    const start = Math.max(0, pending.startBeat - clip.start)
    const dur = Math.max(0.1, endBeat - pending.startBeat)
    const recPitch = track.kind === 'drums' ? Math.max(0, Math.min(7, pitch % 8)) : pitch
    mapTrack(trackId, (t) => ({
      ...t,
      clips: t.clips.map((c) =>
        c.id === clipId && c.kind === 'midi'
          ? {
              ...c,
              length: Math.max(c.length, Math.ceil(start + dur)),
              notes: [...c.notes, { id: uid('n'), pitch: recPitch, start, dur, vel: pending.vel }],
            }
          : c
      ),
    }))
  }

  // ---------- recording ----------

  async record(): Promise<void> {
    this.ensure()
    const { project, ui } = getState()
    if (ui.recording) return
    const startBeat = this.transport!.currentBeat()

    this.recordClipByTrack.clear()
    for (const track of project.tracks) {
      if (track.armed && track.kind !== 'audio') {
        const clipId = uid('clip')
        mapTrack(track.id, (t) => ({
          ...t,
          clips: [
            ...t.clips,
            { id: clipId, kind: 'midi', name: 'Take', start: Math.floor(startBeat), length: 4, notes: [] },
          ],
        }))
        this.recordClipByTrack.set(track.id, clipId)
      }
    }

    // one shared multichannel capture serves every armed audio track (dual-signal recording)
    this.recordAudioTracks = project.tracks.filter((t) => t.armed && t.kind === 'audio').map((t) => t.id)
    if (this.recordAudioTracks.length > 0) {
      try {
        if (!audioIO.inputIsOpen()) await audioIO.openInput()
        this.recorder = new InputRecorder(this.ctx!)
        this.recorder.start()
      } catch (e) {
        toast(`Cannot open audio input: ${e}`, 'error')
        this.recorder = null
        this.recordAudioTracks = []
      }
    }
    if (this.recordAudioTracks.length === 0 && this.recordClipByTrack.size === 0) {
      toast('Arm a track first (● on the track header) to record', 'warn')
      return
    }

    this.loopWasOn = this.transport!.loop.on
    this.transport!.loop = { ...this.transport!.loop, on: false }

    if (!this.transport!.playing) this.play()
    this.recordPlayOrigin = { ctxTime: this.transport!.beatToTime(startBeat), beat: startBeat }
    setUI({ recording: true })
  }

  async stopRecord(): Promise<void> {
    const { ui } = getState()
    if (!ui.recording) return
    setUI({ recording: false })
    this.transport!.loop = { ...this.transport!.loop, on: this.loopWasOn }

    if (this.transport) {
      const nowBeat = this.transport.currentBeat()
      for (const [key, pending] of this.pendingRecNotes) {
        const [, pitchStr, trackId] = key.split(':')
        const clipId = this.recordClipByTrack.get(trackId)
        if (clipId) this.commitRecordedNote(trackId, clipId, parseInt(pitchStr, 10), pending, nowBeat)
      }
      this.pendingRecNotes.clear()
    }

    if (this.recorder && this.recordAudioTracks.length > 0 && this.recordPlayOrigin) {
      const capture = this.recorder.stop()
      this.recorder = null
      if (capture) {
        const origin = this.recordPlayOrigin
        // trim capture lead-in + apply round-trip compensation so takes align sample-accurately
        const offsetSec = getSettings().recordingOffsetMs / 1000
        const baseTrim = Math.max(0, origin.ctxTime - capture.startedAtCtxTime) + offsetSec
        const tempo = getState().project.tempo
        for (const trackId of this.recordAudioTracks) {
          const track = getState().project.tracks.find((t) => t.id === trackId)
          if (!track) continue
          const buffer = bufferFromCapture(this.ctx!, capture, track.inputChannels, baseTrim)
          if (!buffer) continue
          const sampleId = uid('smp')
          sampleStore.set(sampleId, buffer)
          void saveSampleToIDB(sampleId, audioBufferToWav(buffer))
          const lengthBeats = (buffer.duration * tempo) / 60
          const chLabel = track.inputChannels.map((c) => c + 1).join('/')
          setProject((p) => ({
            ...p,
            samples: [...p.samples, { id: sampleId, name: `${track.name} take (ch ${chLabel})`, duration: buffer.duration }],
            tracks: p.tracks.map((t) =>
              t.id === trackId
                ? {
                    ...t,
                    clips: [
                      ...t.clips,
                      {
                        id: uid('clip'),
                        kind: 'audio' as const,
                        name: `Take (ch ${chLabel})`,
                        start: origin.beat,
                        length: Math.max(0.25, lengthBeats),
                        sampleId,
                        offset: 0,
                        gain: 1,
                        fadeIn: 0,
                        fadeOut: 0,
                      },
                    ],
                  }
                : t
            ),
          }))
        }
      }
    }
    this.recordAudioTracks = []
    this.recordClipByTrack.clear()
  }

  // ---------- re-amping ----------

  /**
   * Re-amp workflow: play the source track's audio clips out of a hardware output pair
   * (feeding the Stadium's processing chain), record the processed return from the chosen
   * input channels, and place the result on a new track with round-trip compensation applied.
   */
  async reamp(sourceTrackId: string, outPair: number, inputChannels: number[]): Promise<boolean> {
    this.ensure()
    const project = getState().project
    const source = project.tracks.find((t) => t.id === sourceTrackId)
    const clips = (source?.clips.filter((c) => c.kind === 'audio') ?? []) as AudioClip[]
    if (!source || clips.length === 0) {
      toast('Re-amp needs a source track with audio clips', 'warn')
      return false
    }
    if (this.isPlaying()) this.stop()
    try {
      if (!audioIO.inputIsOpen()) await audioIO.openInput()
    } catch (e) {
      toast(`Cannot open audio input for re-amp: ${e}`, 'error')
      return false
    }

    const spb = 60 / project.tempo
    const minStart = Math.min(...clips.map((c) => c.start))
    const maxEnd = Math.max(...clips.map((c) => c.start + c.length))
    const durSec = (maxEnd - minStart) * spb + 0.6 // tail

    const recorder = new InputRecorder(this.ctx!)
    recorder.start()
    const t0 = this.ctx!.currentTime + 0.25
    const feed = this.ctx!.createGain()
    feed.connect(audioIO.getOutputPair(outPair))
    const srcs: AudioBufferSourceNode[] = []
    for (const clip of clips) {
      const buffer = sampleStore.get(clip.sampleId)
      if (!buffer) continue
      const s = this.ctx!.createBufferSource()
      s.buffer = buffer
      const g = this.ctx!.createGain()
      g.gain.value = clip.gain
      s.connect(g)
      g.connect(feed)
      s.start(t0 + (clip.start - minStart) * spb, clip.offset, clip.length * spb)
      srcs.push(s)
    }
    toast(`Re-amping ${source.name} → out pair ${outPair * 2 + 1}/${outPair * 2 + 2}, recording ch ${inputChannels.map((c) => c + 1).join('/')}…`, 'info', durSec * 1000)

    await new Promise((r) => setTimeout(r, (t0 - this.ctx!.currentTime + durSec) * 1000))
    const capture = recorder.stop()
    srcs.forEach((s) => { try { s.stop() } catch { /* ok */ } })
    feed.disconnect()
    if (!capture) {
      toast('Re-amp capture came back empty', 'error')
      return false
    }
    const offsetSec = getSettings().recordingOffsetMs / 1000
    const trim = Math.max(0, t0 - capture.startedAtCtxTime) + offsetSec
    const buffer = bufferFromCapture(this.ctx!, capture, inputChannels, trim)
    if (!buffer) return false
    const sampleId = uid('smp')
    sampleStore.set(sampleId, buffer)
    void saveSampleToIDB(sampleId, audioBufferToWav(buffer))
    const lengthBeats = Math.min((buffer.duration * project.tempo) / 60, maxEnd - minStart + 1)
    setProject((p) => {
      const track = {
        ...p.tracks.find((t) => t.id === sourceTrackId)!,
      }
      const newTrack: Track = {
        ...track,
        id: uid('trk'),
        name: `${source.name} (re-amped)`,
        armed: false,
        monitor: false,
        solo: false,
        mute: false,
        outputPair: -1,
        automation: [],
        fx: [],
        clips: [
          {
            id: uid('clip'),
            kind: 'audio',
            name: 'Re-amp',
            start: minStart,
            length: Math.max(0.25, lengthBeats),
            sampleId,
            offset: 0,
            gain: 1,
            fadeIn: 0,
            fadeOut: 0,
          },
        ],
      }
      return {
        ...p,
        samples: [...p.samples, { id: sampleId, name: `${source.name} re-amp`, duration: buffer.duration }],
        tracks: [...p.tracks, newTrack],
      }
    })
    toast('Re-amp complete — new track added, aligned with round-trip compensation', 'info')
    return true
  }

  // ---------- samples ----------

  async importSample(file: File): Promise<string> {
    this.ensure()
    const arr = await file.arrayBuffer()
    const srcRate = wavSampleRate(arr)
    const buffer = await this.ctx!.decodeAudioData(arr.slice(0))
    if (srcRate && srcRate !== this.ctx!.sampleRate) {
      toast(`"${file.name}" is ${srcRate} Hz — resampled to the engine rate (${this.ctx!.sampleRate} Hz)`, 'info')
    }
    const sampleId = uid('smp')
    sampleStore.set(sampleId, buffer)
    void saveSampleToIDB(sampleId, audioBufferToWav(buffer))
    setProject((p) => ({ ...p, samples: [...p.samples, { id: sampleId, name: file.name, duration: buffer.duration }] }))
    return sampleId
  }

  /** Import an audio file directly onto the timeline as a clip. */
  async importSampleAsClip(file: File, trackId: string, atBeat: number): Promise<void> {
    const sampleId = await this.importSample(file)
    const buffer = sampleStore.get(sampleId)!
    const tempo = getState().project.tempo
    const lengthBeats = Math.max(0.25, (buffer.duration * tempo) / 60)
    mapTrack(trackId, (t) => ({
      ...t,
      clips: [
        ...t.clips,
        {
          id: uid('clip'),
          kind: 'audio',
          name: file.name.replace(/\.[^.]+$/, ''),
          start: Math.max(0, atBeat),
          length: lengthBeats,
          sampleId,
          offset: 0,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
    }))
  }

  addMarkerAtPlayhead(): void {
    addMarker(Math.round(this.position() * 4) / 4)
  }
}

export const engine = new Engine()
