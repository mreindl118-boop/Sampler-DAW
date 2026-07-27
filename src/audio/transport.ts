/**
 * Lookahead scheduler (see "A Tale of Two Clocks" pattern).
 * The engine supplies scheduleWindow(fromBeat, toBeat, beatToTime) and gets
 * sample-accurate scheduling while UI reads currentBeat() for the playhead.
 */
export class Transport {
  playing = false
  tempo = 120
  loop = { on: false, start: 0, end: 8 }

  private ctx: AudioContext
  private originTime = 0 // AudioContext time that corresponds to originBeat
  private originBeat = 0
  private stoppedAt = 0 // beat position while stopped
  private schedBeat = 0 // next musical beat not yet scheduled
  private timer: ReturnType<typeof setInterval> | null = null
  private lookahead = 0.12 // seconds
  private interval = 25 // ms

  onWindow: ((fromBeat: number, toBeat: number, beatToTime: (b: number) => number) => void) | null = null
  onLoopWrap: (() => void) | null = null
  onStop: (() => void) | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  get secondsPerBeat(): number {
    return 60 / this.tempo
  }

  beatToTime = (beat: number): number => {
    return this.originTime + (beat - this.originBeat) * this.secondsPerBeat
  }

  currentBeat(): number {
    if (!this.playing) return this.stoppedAt
    return this.originBeat + (this.ctx.currentTime - this.originTime) / this.secondsPerBeat
  }

  setTempo(tempo: number): void {
    if (this.playing) {
      // rebase so position stays continuous
      const nowBeat = this.currentBeat()
      this.originTime = this.ctx.currentTime
      this.originBeat = nowBeat
    }
    this.tempo = tempo
  }

  setPosition(beat: number): void {
    this.stoppedAt = Math.max(0, beat)
    if (this.playing) {
      this.originTime = this.ctx.currentTime + 0.05
      this.originBeat = this.stoppedAt
      this.schedBeat = this.stoppedAt
    }
  }

  play(fromBeat?: number): void {
    if (this.playing) return
    const start = fromBeat ?? this.stoppedAt
    this.playing = true
    this.originTime = this.ctx.currentTime + 0.06
    this.originBeat = start
    this.schedBeat = start
    this.timer = setInterval(() => this.tick(), this.interval)
    this.tick()
  }

  stop(): void {
    if (!this.playing) return
    this.stoppedAt = Math.max(0, this.currentBeat())
    this.playing = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.onStop?.()
  }

  rewind(): void {
    if (this.playing) {
      this.setPosition(this.loop.on ? this.loop.start : 0)
    } else {
      this.stoppedAt = this.loop.on ? this.loop.start : 0
    }
  }

  private tick(): void {
    if (!this.playing) return
    const horizon = this.ctx.currentTime + this.lookahead
    // guard against runaway loops from degenerate loop regions
    let guard = 0
    while (this.beatToTime(this.schedBeat) < horizon && guard++ < 32) {
      const horizonBeat = this.originBeat + (horizon - this.originTime) / this.secondsPerBeat
      const { on, start, end } = this.loop
      const loopValid = on && end > start + 0.01
      if (loopValid && this.schedBeat < end && horizonBeat >= end) {
        // schedule up to the loop end, then wrap
        if (end > this.schedBeat) this.onWindow?.(this.schedBeat, end, this.beatToTime)
        const wrapTime = this.beatToTime(end)
        this.originTime = wrapTime
        this.originBeat = start
        this.schedBeat = start
        this.onLoopWrap?.()
      } else {
        this.onWindow?.(this.schedBeat, horizonBeat, this.beatToTime)
        this.schedBeat = horizonBeat
        break
      }
    }
  }
}
