import type { Clip, FxUnit, Project, Track } from '../state/types'
import { getState, mapTrack, setProject, setUI, subscribeStore } from '../state/store'
import { uid } from '../state/presets'
import { Transport } from './transport'
import { PolySynth, type Instrument } from './synth'
import { SamplerInstrument, sampleStore } from './sampler'
import { DrumKit } from './drums'
import { buildFxChain } from './effects'
import { InputRecorder } from './recorder'
import { saveSampleToIDB } from '../util/idb'
import { audioBufferToWav } from './wav'

interface Channel {
  trackId: string
  input: GainNode // audio-clip bus; instruments connect here too
  instrument: Instrument | null
  fx: { input: AudioNode; output: AudioNode; dispose(): void }
  gain: GainNode
  pan: StereoPannerNode
  fxRef: FxUnit[]
  paramsRef: unknown
  kind: Track['kind']
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
  private masterFx: { input: AudioNode; output: AudioNode; dispose(): void } | null = null
  private masterFxRef: FxUnit[] = []
  private channels = new Map<string, Channel>()
  private activeSources: AudioBufferSourceNode[] = []
  private recorder: InputRecorder | null = null
  private pendingRecNotes = new Map<string, PendingRecNote>() // key `${channel}:${pitch}`
  private recordClipByTrack = new Map<string, string>()
  private recordAudioTrackId: string | null = null
  private recordPlayOrigin: { ctxTime: number; beat: number } | null = null
  private loopWasOn = false
  private attached = false

  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
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
      this.analyser.connect(this.ctx.destination)
      this.transport.onWindow = (a, b, b2t) => this.scheduleWindow(a, b, b2t)
      this.transport.onLoopWrap = () => this.onLoopWrap()
      this.transport.onStop = () => this.onTransportStop()
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
        this.transport.loop = { ...p.loop }
      }
      this.sync(p)
    })
  }

  // ---------- graph sync ----------

  private masterInput(): GainNode {
    return this.master!
  }

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
      // fx chain rebuild if list identity changed
      if (ch.fxRef !== track.fx) {
        ch.fx.dispose()
        const src = ch.instrument ? ch.instrument.output : ch.input
        try { src.disconnect() } catch { /* ok */ }
        if (!ch.instrument) {
          // audio bus: input feeds fx directly
        }
        ch.fx = buildFxChain(ctx, track.fx)
        const source: AudioNode = ch.instrument ? ch.instrument.output : ch.input
        source.connect(ch.fx.input)
        ch.fx.output.connect(ch.gain)
        ch.fxRef = track.fx
      }
      // instrument params
      const params = track.synth ?? track.sampler ?? track.drums ?? null
      if (params && ch.instrument && ch.paramsRef !== params) {
        ch.instrument.update(params)
        ch.paramsRef = params
      }
      ch.pan.pan.value = track.pan
    }
    // dispose removed tracks
    for (const [id, ch] of this.channels) {
      if (!seen.has(id)) {
        ch.instrument?.dispose()
        ch.fx.dispose()
        ch.gain.disconnect()
        ch.pan.disconnect()
        try { ch.input.disconnect() } catch { /* ok */ }
        this.channels.delete(id)
      }
    }
    // master fx + volume
    if (this.masterFxRef !== project.master.fx) {
      // (master fx chain kept simple: rebuild between master gain and limiter)
      this.masterFxRef = project.master.fx
    }
    this.master!.gain.value = project.master.volume
    this.applyMixState(project)
  }

  private createChannel(track: Track): Channel {
    const ctx = this.ctx!
    const input = ctx.createGain()
    let instrument: Instrument | null = null
    if (track.kind === 'synth' && track.synth) instrument = new PolySynth(ctx, track.synth)
    if (track.kind === 'sampler' && track.sampler) instrument = new SamplerInstrument(ctx, track.sampler)
    if (track.kind === 'drums' && track.drums) instrument = new DrumKit(ctx, track.drums)
    const fx = buildFxChain(ctx, track.fx)
    const gain = ctx.createGain()
    const pan = ctx.createStereoPanner()
    const source: AudioNode = instrument ? instrument.output : input
    source.connect(fx.input)
    fx.output.connect(gain)
    gain.connect(pan)
    pan.connect(this.masterInput())
    return {
      trackId: track.id,
      input,
      instrument,
      fx,
      gain,
      pan,
      fxRef: track.fx,
      paramsRef: track.synth ?? track.sampler ?? track.drums ?? null,
      kind: track.kind,
    }
  }

  private applyMixState(project: Project): void {
    const anySolo = project.tracks.some((t) => t.solo)
    for (const track of project.tracks) {
      const ch = this.channels.get(track.id)
      if (!ch) continue
      const audible = !track.mute && (!anySolo || track.solo)
      ch.gain.gain.setTargetAtTime(audible ? track.volume : 0, this.ctx!.currentTime, 0.02)
    }
  }

  // ---------- transport ----------

  play(): void {
    this.ensure()
    const p = getState().project
    this.transport!.tempo = p.tempo
    this.transport!.loop = { ...p.loop }
    this.transport!.play()
    this.scheduleSpanningAudioAt(this.transport!.currentBeat())
  }

  stop(): void {
    if (!this.transport) return
    if (getState().ui.recording) void this.stopRecord()
    this.transport.stop()
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

  // ---------- scheduling ----------

  private scheduleWindow(fromBeat: number, toBeat: number, beatToTime: (b: number) => number): void {
    const { project } = getState()
    const anySolo = project.tracks.some((t) => t.solo)
    for (const track of project.tracks) {
      if (track.mute || (anySolo && !track.solo)) continue
      const ch = this.channels.get(track.id)
      if (!ch) continue
      for (const clip of track.clips) {
        if (clip.kind === 'midi') {
          this.scheduleMidiClip(track, clip, ch, fromBeat, toBeat, beatToTime)
        } else {
          if (clip.start >= fromBeat && clip.start < toBeat) {
            this.startAudioClip(clip, ch, beatToTime(clip.start), 0)
          }
        }
      }
    }
    if (this.metronome && this.transport) {
      const firstBeat = Math.ceil(fromBeat - 1e-9)
      for (let b = firstBeat; b < toBeat; b++) {
        this.click(beatToTime(b), b % project.timeSig[0] === 0)
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
    if (!ch.instrument) return
    const spb = this.transport!.secondsPerBeat
    for (const note of clip.notes) {
      const abs = clip.start + note.start
      if (abs >= fromBeat && abs < toBeat && note.start < clip.length) {
        const t = beatToTime(abs)
        ch.instrument.noteOn(note.pitch, note.vel, t)
        ch.instrument.noteOff(note.pitch, t + Math.max(0.05, note.dur * spb))
      }
    }
  }

  private startAudioClip(clip: Extract<Clip, { kind: 'audio' }>, ch: Channel, when: number, skipBeats: number): void {
    const buffer = sampleStore.get(clip.sampleId)
    if (!buffer || !this.ctx || !this.transport) return
    const spb = this.transport.secondsPerBeat
    const skipSec = skipBeats * spb
    const durSec = clip.length * spb - skipSec
    if (durSec <= 0.01) return
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const g = this.ctx.createGain()
    g.gain.value = clip.gain
    src.connect(g)
    g.connect(ch.input)
    src.start(when, clip.offset + skipSec, durSec)
    src.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== src)
      try { src.disconnect(); g.disconnect() } catch { /* ok */ }
    }
    this.activeSources.push(src)
  }

  /** When playback begins (or jumps) mid-clip, start audio clips already underway. */
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
    // audio clips spanning the loop start get retriggered mid-clip at wrap time
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
    // MIDI recording
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

  /** Preview a chord (list of MIDI pitches) with a light strum. */
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
    const startBeat = this.transport!.playing ? this.transport!.currentBeat() : this.transport!.currentBeat()

    // MIDI: create a take clip on every armed instrument track
    this.recordClipByTrack.clear()
    for (const track of project.tracks) {
      if (track.armed && track.kind !== 'audio') {
        const clipId = `rec_${Date.now().toString(36)}_${track.id}`
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

    // Audio: start capture on the first armed audio track
    const audioTrack = project.tracks.find((t) => t.armed && t.kind === 'audio')
    this.recordAudioTrackId = audioTrack?.id ?? null
    if (audioTrack) {
      this.recorder = new InputRecorder(this.ctx!)
      await this.recorder.start(ui.audioInputId || undefined)
    }

    // avoid loop wraps while recording so takes stay linear
    this.loopWasOn = this.transport!.loop.on
    this.transport!.loop = { ...this.transport!.loop, on: false }

    if (!this.transport!.playing) this.transport!.play(startBeat)
    this.recordPlayOrigin = { ctxTime: this.transport!.beatToTime(startBeat), beat: startBeat }
    setUI({ recording: true })
  }

  async stopRecord(): Promise<void> {
    const { ui } = getState()
    if (!ui.recording) return
    setUI({ recording: false })
    this.transport!.loop = { ...this.transport!.loop, on: this.loopWasOn }

    // flush held MIDI notes
    if (this.transport) {
      const nowBeat = this.transport.currentBeat()
      for (const [key, pending] of this.pendingRecNotes) {
        const [, pitchStr, trackId] = key.split(':')
        const clipId = this.recordClipByTrack.get(trackId)
        if (clipId) this.commitRecordedNote(trackId, clipId, parseInt(pitchStr, 10), pending, nowBeat)
      }
      this.pendingRecNotes.clear()
    }

    // finalize audio take
    if (this.recorder && this.recordAudioTrackId && this.recordPlayOrigin) {
      const result = this.recorder.stop()
      this.recorder = null
      if (result) {
        const { buffer, startedAtCtxTime } = result
        const origin = this.recordPlayOrigin
        const trimSec = Math.max(0, origin.ctxTime - startedAtCtxTime)
        const sampleId = `smp_${Date.now().toString(36)}`
        sampleStore.set(sampleId, buffer)
        void saveSampleToIDB(sampleId, audioBufferToWav(buffer))
        const tempo = getState().project.tempo
        const usableSec = Math.max(0, buffer.duration - trimSec)
        const lengthBeats = (usableSec * tempo) / 60
        const trackId = this.recordAudioTrackId
        setProject((p) => ({
          ...p,
          samples: [...p.samples, { id: sampleId, name: `Recording ${p.samples.length + 1}`, duration: buffer.duration }],
          tracks: p.tracks.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  clips: [
                    ...t.clips,
                    {
                      id: `clip_${Date.now().toString(36)}`,
                      kind: 'audio' as const,
                      name: 'Take',
                      start: origin.beat,
                      length: Math.max(0.25, lengthBeats),
                      sampleId,
                      offset: trimSec,
                      gain: 1,
                    },
                  ],
                }
              : t
          ),
        }))
      }
    }
    this.recordAudioTrackId = null
    this.recordClipByTrack.clear()
  }

  // ---------- samples ----------

  async importSample(file: File): Promise<string> {
    this.ensure()
    const arr = await file.arrayBuffer()
    const buffer = await this.ctx!.decodeAudioData(arr.slice(0))
    const sampleId = `smp_${Date.now().toString(36)}_${Math.floor(buffer.duration * 1000).toString(36)}`
    sampleStore.set(sampleId, buffer)
    void saveSampleToIDB(sampleId, audioBufferToWav(buffer))
    setProject((p) => ({ ...p, samples: [...p.samples, { id: sampleId, name: file.name, duration: buffer.duration }] }))
    return sampleId
  }
}

export const engine = new Engine()
