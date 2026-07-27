import type { SynthParams } from '../state/types'
import { midiToFreq } from '../music/theory'

export interface Instrument {
  readonly output: GainNode
  noteOn(pitch: number, vel: number, time: number, channel?: number): void
  noteOff(pitch: number, time: number, channel?: number): void
  allNotesOff(): void
  update(params: unknown): void
  dispose(): void
  // Per-channel expression (MPE — one note per channel on ROLI-style controllers)
  pitchBend?(semitones: number, channel: number): void
  pressure?(value: number, channel: number): void
  timbre?(value: number, channel: number): void
}

interface Voice {
  pitch: number
  channel: number
  oscs: OscillatorNode[]
  baseDetunes: number[] // cents, per osc
  noise: AudioBufferSourceNode | null
  filter: BiquadFilterNode
  amp: GainNode
  pressGain: GainNode
  vel: number
  baseCutoff: number
  releaseAt: number | null
}

let sharedNoiseBuffer: AudioBuffer | null = null
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === ctx.sampleRate) return sharedNoiseBuffer
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  sharedNoiseBuffer = buf
  return buf
}

const MAX_VOICES = 16

export class PolySynth implements Instrument {
  readonly output: GainNode
  private ctx: BaseAudioContext
  private params: SynthParams
  private voices: Voice[] = []
  private lfo: OscillatorNode
  private lfoGainPitch: GainNode
  private lfoGainFilter: GainNode
  private lfoGainAmp: GainNode
  private lastFreq: number | null = null

  constructor(ctx: BaseAudioContext, params: SynthParams) {
    this.ctx = ctx
    this.params = params
    this.output = ctx.createGain()
    this.output.gain.value = params.gain

    this.lfo = ctx.createOscillator()
    this.lfo.frequency.value = params.lfo.rate
    this.lfoGainPitch = ctx.createGain()
    this.lfoGainFilter = ctx.createGain()
    this.lfoGainAmp = ctx.createGain()
    this.lfo.connect(this.lfoGainPitch)
    this.lfo.connect(this.lfoGainFilter)
    this.lfo.connect(this.lfoGainAmp)
    this.lfoGainAmp.connect(this.output.gain)
    this.applyLfoDepth()
    this.lfo.start()
  }

  private applyLfoDepth(): void {
    const { depth, target } = this.params.lfo
    this.lfoGainPitch.gain.value = target === 'pitch' ? depth : 0 // cents
    this.lfoGainFilter.gain.value = target === 'filter' ? depth * 40 : 0 // Hz
    this.lfoGainAmp.gain.value = target === 'amp' ? depth / 40 : 0
  }

  update(params: SynthParams): void {
    this.params = params
    this.output.gain.value = params.gain
    this.lfo.frequency.value = params.lfo.rate
    this.applyLfoDepth()
    for (const v of this.voices) {
      v.filter.type = params.filter.type
      v.filter.Q.value = params.filter.q
    }
  }

  noteOn(pitch: number, vel: number, time: number, channel = 0): void {
    const p = this.params
    const ctx = this.ctx
    // voice stealing: oldest releasing first, then oldest
    if (this.voices.length >= MAX_VOICES) {
      const idx = this.voices.findIndex((v) => v.releaseAt !== null)
      const steal = idx >= 0 ? this.voices.splice(idx, 1)[0] : this.voices.shift()
      if (steal) this.killVoice(steal, time)
    }

    const filter = ctx.createBiquadFilter()
    filter.type = p.filter.type
    filter.Q.value = p.filter.q
    const baseCutoff = p.filter.cutoff
    // filter envelope
    const fa = Math.max(0.001, p.filterEnv.a)
    const fd = Math.max(0.001, p.filterEnv.d)
    const peak = Math.min(18000, baseCutoff + p.filter.envAmount)
    const sus = Math.min(18000, baseCutoff + p.filter.envAmount * p.filterEnv.s)
    filter.frequency.setValueAtTime(Math.max(30, baseCutoff), time)
    filter.frequency.linearRampToValueAtTime(Math.max(30, peak), time + fa)
    filter.frequency.setTargetAtTime(Math.max(30, sus), time + fa, fd / 3)
    this.lfoGainFilter.connect(filter.frequency)

    const amp = ctx.createGain()
    const pressGain = ctx.createGain()
    pressGain.gain.value = 1
    const level = vel
    const aa = Math.max(0.001, p.ampEnv.a)
    const ad = Math.max(0.001, p.ampEnv.d)
    amp.gain.setValueAtTime(0, time)
    amp.gain.linearRampToValueAtTime(level, time + aa)
    amp.gain.setTargetAtTime(level * p.ampEnv.s, time + aa, ad / 3)

    filter.connect(amp)
    amp.connect(pressGain)
    pressGain.connect(this.output)

    const freq = midiToFreq(pitch)
    const oscs: OscillatorNode[] = []
    const baseDetunes: number[] = []
    const unison = Math.max(1, Math.min(4, Math.round(p.unison)))
    for (let u = 0; u < unison; u++) {
      const spread = unison > 1 ? (u / (unison - 1) - 0.5) * 2 * p.unisonSpread : 0
      for (const oc of [p.osc1, p.osc2] as const) {
        if (oc.level <= 0.001) continue
        const osc = ctx.createOscillator()
        osc.type = oc.wave
        const det = oc.detune + spread
        osc.detune.value = det
        if (p.glide > 0 && this.lastFreq) {
          osc.frequency.setValueAtTime(this.lastFreq * Math.pow(2, oc.octave), time)
          osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq * Math.pow(2, oc.octave)), time + p.glide)
        } else {
          osc.frequency.setValueAtTime(freq * Math.pow(2, oc.octave), time)
        }
        const g = ctx.createGain()
        g.gain.value = oc.level / unison
        osc.connect(g)
        g.connect(filter)
        this.lfoGainPitch.connect(osc.detune)
        osc.start(time)
        oscs.push(osc)
        baseDetunes.push(det)
      }
    }

    let noise: AudioBufferSourceNode | null = null
    if (p.noise > 0.001) {
      noise = ctx.createBufferSource()
      noise.buffer = noiseBuffer(ctx)
      noise.loop = true
      const ng = ctx.createGain()
      ng.gain.value = p.noise
      noise.connect(ng)
      ng.connect(filter)
      noise.start(time)
    }

    this.lastFreq = freq
    this.voices.push({ pitch, channel, oscs, baseDetunes, noise, filter, amp, pressGain, vel, baseCutoff, releaseAt: null })
  }

  noteOff(pitch: number, time: number, channel = 0): void {
    const p = this.params
    for (const v of this.voices) {
      if (v.pitch === pitch && v.channel === channel && v.releaseAt === null) {
        v.releaseAt = time
        const r = Math.max(0.005, p.ampEnv.r)
        v.amp.gain.cancelScheduledValues(time)
        v.amp.gain.setTargetAtTime(0, time, r / 3)
        v.filter.frequency.cancelScheduledValues(time)
        v.filter.frequency.setTargetAtTime(Math.max(30, v.baseCutoff), time, Math.max(0.005, p.filterEnv.r) / 3)
        const stopAt = time + r * 4 + 0.05
        v.oscs.forEach((o) => o.stop(stopAt))
        v.noise?.stop(stopAt)
        setTimeout(() => this.reap(), (stopAt - this.ctx.currentTime) * 1000 + 100)
        break
      }
    }
  }

  private reap(): void {
    const now = this.ctx.currentTime
    this.voices = this.voices.filter((v) => {
      if (v.releaseAt !== null && now > v.releaseAt + this.params.ampEnv.r * 4 + 0.05) {
        this.disconnectVoice(v)
        return false
      }
      return true
    })
  }

  private disconnectVoice(v: Voice): void {
    try {
      v.oscs.forEach((o) => o.disconnect())
      v.noise?.disconnect()
      v.filter.disconnect()
      v.amp.disconnect()
      v.pressGain.disconnect()
    } catch { /* nodes may already be gone */ }
  }

  private killVoice(v: Voice, time: number): void {
    v.amp.gain.cancelScheduledValues(time)
    v.amp.gain.setTargetAtTime(0, time, 0.01)
    const stopAt = time + 0.08
    v.oscs.forEach((o) => {
      try { o.stop(stopAt) } catch { /* not started yet */ }
    })
    try { v.noise?.stop(stopAt) } catch { /* not started */ }
  }

  allNotesOff(): void {
    const t = this.ctx.currentTime
    this.voices.forEach((v) => this.killVoice(v, t))
    this.voices = []
  }

  /** MPE per-channel pitch bend, in semitones. */
  pitchBend(semitones: number, channel: number): void {
    for (const v of this.voices) {
      if (channel !== 0 && v.channel !== channel) continue
      v.oscs.forEach((o, i) => {
        o.detune.setTargetAtTime(v.baseDetunes[i] + semitones * 100, this.ctx.currentTime, 0.005)
      })
    }
  }

  /** MPE channel pressure 0..1 → voice loudness. */
  pressure(value: number, channel: number): void {
    for (const v of this.voices) {
      if (channel !== 0 && v.channel !== channel) continue
      v.pressGain.gain.setTargetAtTime(0.3 + 0.7 * value, this.ctx.currentTime, 0.02)
    }
  }

  /** MPE timbre (CC74 slide) 0..1 → filter brightness. */
  timbre(value: number, channel: number): void {
    for (const v of this.voices) {
      if (channel !== 0 && v.channel !== channel) continue
      const f = v.baseCutoff * Math.pow(4, value - 0.5)
      v.filter.frequency.setTargetAtTime(Math.min(18000, Math.max(60, f)), this.ctx.currentTime, 0.02)
    }
  }

  dispose(): void {
    this.allNotesOff()
    try { this.lfo.stop() } catch { /* already stopped */ }
    this.output.disconnect()
  }
}
