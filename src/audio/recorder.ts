import { audioIO, MAX_CHANNELS } from './audioIO'

/**
 * Multi-channel capture session on top of the shared AudioIO input stream.
 *
 * Captures every available input channel losslessly (float32 PCM) in one pass so
 * several armed tracks can record different channels of the same take — e.g. the
 * Helix Stadium's processed USB 1/2 on one track and the dry DI on USB 7 on another.
 */
export interface CaptureResult {
  /** One Float32Array per captured input channel. */
  channels: Float32Array<ArrayBuffer>[]
  sampleRate: number
  startedAtCtxTime: number
}

export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  await audioIO.refreshDevices(true)
  return audioIO.inputDevices()
}

export class InputRecorder {
  private ctx: AudioContext
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private chunks: Float32Array<ArrayBuffer>[][] = []
  private channelCount = 0
  private startedAt = 0
  recording = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  /** Requires audioIO.openInput() to have succeeded first. */
  start(): void {
    if (this.recording) return
    const source = audioIO.rawSource()
    if (!source) throw new Error('No input stream open')
    this.channelCount = Math.min(MAX_CHANNELS, Math.max(1, audioIO.realInputChannels()))
    this.processor = this.ctx.createScriptProcessor(4096, this.channelCount, 1)
    this.chunks = Array.from({ length: this.channelCount }, () => [])
    this.startedAt = 0
    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return
      if (this.startedAt === 0) this.startedAt = e.playbackTime - e.inputBuffer.duration
      for (let ch = 0; ch < this.channelCount; ch++) {
        const src = ch < e.inputBuffer.numberOfChannels ? e.inputBuffer.getChannelData(ch) : null
        this.chunks[ch].push(src ? new Float32Array(src) : new Float32Array(e.inputBuffer.length))
      }
    }
    source.connect(this.processor)
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0
    this.processor.connect(this.sink)
    this.sink.connect(this.ctx.destination)
    if (this.startedAt === 0) this.startedAt = this.ctx.currentTime
    this.recording = true
  }

  stop(): CaptureResult | null {
    if (!this.recording) return null
    this.recording = false
    const source = audioIO.rawSource()
    try { if (source && this.processor) source.disconnect(this.processor) } catch { /* ok */ }
    this.processor?.disconnect()
    this.sink?.disconnect()
    this.processor = null
    this.sink = null

    const total = this.chunks[0]?.reduce((n, c) => n + c.length, 0) ?? 0
    if (total === 0) return null
    const channels = this.chunks.map((chList) => {
      const out = new Float32Array(total)
      let off = 0
      for (const c of chList) {
        out.set(c, off)
        off += c.length
      }
      return out
    })
    this.chunks = []
    return { channels, sampleRate: this.ctx.sampleRate, startedAtCtxTime: this.startedAt }
  }
}

/** Build an AudioBuffer from selected channels of a capture (mono or stereo). */
export function bufferFromCapture(
  ctx: BaseAudioContext,
  capture: CaptureResult,
  channelSel: number[],
  trimStartSec: number
): AudioBuffer | null {
  const chans = channelSel.length ? channelSel : [0, 1]
  const avail = capture.channels.length
  const picked = chans.map((c) => capture.channels[Math.min(c, avail - 1)] ?? capture.channels[0])
  const trim = Math.max(0, Math.floor(trimStartSec * capture.sampleRate))
  const frames = picked[0].length - trim
  if (frames <= 0) return null
  const buf = ctx.createBuffer(picked.length, frames, capture.sampleRate)
  picked.forEach((data, i) => buf.copyToChannel(data.subarray(trim), i))
  return buf
}
