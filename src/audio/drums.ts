import type { DrumParams } from '../state/types'
import type { Instrument } from './synth'

/**
 * Synthesized 808/909-style drum kit — no sample assets needed.
 * Notes address lanes 0..7: kick, snare, clap, closed hat, open hat, low tom, high tom, crash.
 */
export class DrumKit implements Instrument {
  readonly output: GainNode
  private ctx: BaseAudioContext
  private params: DrumParams
  private noise: AudioBuffer

  constructor(ctx: BaseAudioContext, params: DrumParams) {
    this.ctx = ctx
    this.params = params
    this.output = ctx.createGain()
    this.output.gain.value = params.gain
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }

  update(params: DrumParams): void {
    this.params = params
    this.output.gain.value = params.gain
  }

  noteOn(lane: number, vel: number, time: number): void {
    const l = this.params.lanes[lane]
    if (!l) return
    const level = vel * l.level
    if (level <= 0.001) return
    const tune = Math.pow(2, l.tune / 12)
    const decay = 0.15 + l.decay * 1.5
    switch (lane) {
      case 0: this.kick(time, level, tune, decay); break
      case 1: this.snare(time, level, tune, decay * 0.5); break
      case 2: this.clap(time, level, decay * 0.4); break
      case 3: this.hat(time, level, tune, 0.02 + l.decay * 0.08); break
      case 4: this.hat(time, level, tune, 0.1 + l.decay * 0.5); break
      case 5: this.tom(time, level, 100 * tune, decay * 0.6); break
      case 6: this.tom(time, level, 180 * tune, decay * 0.5); break
      case 7: this.crash(time, level, decay * 1.6); break
    }
  }

  private env(time: number, level: number, decay: number): GainNode {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(level, time)
    g.gain.exponentialRampToValueAtTime(0.001, time + decay)
    g.connect(this.output)
    return g
  }

  private kick(t: number, level: number, tune: number, decay: number): void {
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(160 * tune, t)
    osc.frequency.exponentialRampToValueAtTime(45 * tune, t + 0.09)
    const g = this.env(t, level * 1.2, decay)
    osc.connect(g)
    osc.start(t)
    osc.stop(t + decay + 0.05)
    // click transient
    const click = this.ctx.createOscillator()
    click.type = 'square'
    click.frequency.value = 900
    const cg = this.env(t, level * 0.3, 0.015)
    click.connect(cg)
    click.start(t)
    click.stop(t + 0.03)
  }

  private noiseSrc(t: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    src.start(t)
    return src
  }

  private snare(t: number, level: number, tune: number, decay: number): void {
    const body = this.ctx.createOscillator()
    body.type = 'triangle'
    body.frequency.setValueAtTime(220 * tune, t)
    body.frequency.exponentialRampToValueAtTime(140 * tune, t + 0.06)
    const bg = this.env(t, level * 0.6, decay * 0.6)
    body.connect(bg)
    body.start(t)
    body.stop(t + decay + 0.05)

    const n = this.noiseSrc(t)
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1800
    const ng = this.env(t, level * 0.8, decay)
    n.connect(hp)
    hp.connect(ng)
    n.stop(t + decay + 0.05)
  }

  private clap(t: number, level: number, decay: number): void {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.012
      const n = this.noiseSrc(at)
      const bp = this.ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1400
      bp.Q.value = 1.5
      const g = this.env(at, level * (i === 2 ? 1 : 0.5), i === 2 ? decay : 0.02)
      n.connect(bp)
      bp.connect(g)
      n.stop(at + decay + 0.05)
    }
  }

  private hat(t: number, level: number, tune: number, decay: number): void {
    const n = this.noiseSrc(t)
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7000 * tune
    const g = this.env(t, level * 0.7, decay)
    n.connect(hp)
    hp.connect(g)
    n.stop(t + decay + 0.05)
  }

  private tom(t: number, level: number, freq: number, decay: number): void {
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * 1.4, t)
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.08)
    const g = this.env(t, level, decay)
    osc.connect(g)
    osc.start(t)
    osc.stop(t + decay + 0.05)
  }

  private crash(t: number, level: number, decay: number): void {
    const n = this.noiseSrc(t)
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 5000
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'peaking'
    bp.frequency.value = 9000
    bp.gain.value = 6
    const g = this.env(t, level * 0.6, decay)
    n.connect(hp)
    hp.connect(bp)
    bp.connect(g)
    n.stop(t + decay + 0.1)
  }

  noteOff(): void {
    /* one-shots — nothing to do */
  }

  allNotesOff(): void {
    /* one-shots decay on their own */
  }

  dispose(): void {
    this.output.disconnect()
  }
}
