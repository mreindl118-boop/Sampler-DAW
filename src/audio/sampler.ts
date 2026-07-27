import type { SamplerParams } from '../state/types'
import type { Instrument } from './synth'

interface SamplerVoice {
  pitch: number
  channel: number
  src: AudioBufferSourceNode
  amp: GainNode
  releaseAt: number | null
}

/** Sample registry shared between the live engine and offline renders. */
export const sampleStore = new Map<string, AudioBuffer>()

export class SamplerInstrument implements Instrument {
  readonly output: GainNode
  private ctx: BaseAudioContext
  private params: SamplerParams
  private voices: SamplerVoice[] = []
  private buffers: Map<string, AudioBuffer>

  constructor(ctx: BaseAudioContext, params: SamplerParams, buffers: Map<string, AudioBuffer> = sampleStore) {
    this.ctx = ctx
    this.params = params
    this.buffers = buffers
    this.output = ctx.createGain()
    this.output.gain.value = params.gain
  }

  update(params: SamplerParams): void {
    this.params = params
    this.output.gain.value = params.gain
  }

  noteOn(pitch: number, vel: number, time: number, channel = 0): void {
    const p = this.params
    if (!p.sampleId) return
    const buffer = this.buffers.get(p.sampleId)
    if (!buffer) return

    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = Math.pow(2, (pitch - p.rootNote) / 12)
    const startSec = p.start * buffer.duration
    const endSec = p.end * buffer.duration
    if (p.loop) {
      src.loop = true
      src.loopStart = startSec
      src.loopEnd = Math.max(startSec + 0.01, endSec)
    }

    const amp = this.ctx.createGain()
    const a = Math.max(0.001, p.env.a)
    const d = Math.max(0.001, p.env.d)
    amp.gain.setValueAtTime(0, time)
    amp.gain.linearRampToValueAtTime(vel, time + a)
    amp.gain.setTargetAtTime(vel * p.env.s, time + a, d / 3)

    src.connect(amp)
    amp.connect(this.output)
    src.start(time, startSec)
    if (!p.loop) src.stop(time + (endSec - startSec) / src.playbackRate.value + p.env.r + 0.1)

    const voice: SamplerVoice = { pitch, channel, src, amp, releaseAt: null }
    src.onended = () => {
      this.voices = this.voices.filter((v) => v !== voice)
      try {
        src.disconnect()
        amp.disconnect()
      } catch { /* ok */ }
    }
    this.voices.push(voice)
  }

  noteOff(pitch: number, time: number, channel = 0): void {
    const r = Math.max(0.005, this.params.env.r)
    for (const v of this.voices) {
      if (v.pitch === pitch && v.channel === channel && v.releaseAt === null) {
        v.releaseAt = time
        v.amp.gain.cancelScheduledValues(time)
        v.amp.gain.setTargetAtTime(0, time, r / 3)
        try { v.src.stop(time + r * 4 + 0.05) } catch { /* already stopped */ }
        break
      }
    }
  }

  allNotesOff(): void {
    const t = this.ctx.currentTime
    for (const v of this.voices) {
      v.amp.gain.cancelScheduledValues(t)
      v.amp.gain.setTargetAtTime(0, t, 0.01)
      try { v.src.stop(t + 0.08) } catch { /* ok */ }
    }
    this.voices = []
  }

  pitchBend(semitones: number, channel: number): void {
    for (const v of this.voices) {
      if (channel !== 0 && v.channel !== channel) continue
      const base = Math.pow(2, (v.pitch - this.params.rootNote) / 12)
      v.src.playbackRate.setTargetAtTime(base * Math.pow(2, semitones / 12), this.ctx.currentTime, 0.005)
    }
  }

  dispose(): void {
    this.allNotesOff()
    this.output.disconnect()
  }
}
