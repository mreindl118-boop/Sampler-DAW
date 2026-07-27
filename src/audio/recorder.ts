/**
 * Audio input recorder. Works with any input the OS exposes — built-in mics,
 * and USB audio interfaces carrying XLR / 1/4" (TS/TRS) instrument signals.
 * Captures raw PCM via ScriptProcessor so recordings stay lossless.
 */
export interface RecordingResult {
  buffer: AudioBuffer
  startedAtCtxTime: number
}

export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  try {
    // prompt once so device labels populate
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
    tmp.getTracks().forEach((t) => t.stop())
  } catch {
    /* permission denied — still enumerate */
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput')
}

export class InputRecorder {
  private ctx: AudioContext
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private chunksL: Float32Array[] = []
  private chunksR: Float32Array[] = []
  private channels = 1
  private startedAt = 0
  recording = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  async start(deviceId?: string): Promise<void> {
    if (this.recording) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
    })
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.channels = Math.min(2, this.source.channelCount || 1)
    this.processor = this.ctx.createScriptProcessor(4096, this.channels, this.channels)
    this.chunksL = []
    this.chunksR = []
    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return
      this.chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      if (this.channels > 1) this.chunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)))
    }
    this.source.connect(this.processor)
    // ScriptProcessor needs a destination to run; keep it silent
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    this.processor.connect(sink)
    sink.connect(this.ctx.destination)
    this.startedAt = this.ctx.currentTime
    this.recording = true
  }

  stop(): RecordingResult | null {
    if (!this.recording) return null
    this.recording = false
    this.processor?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.processor = null
    this.source = null
    this.stream = null

    const total = this.chunksL.reduce((n, c) => n + c.length, 0)
    if (total === 0) return null
    const buffer = this.ctx.createBuffer(this.channels, total, this.ctx.sampleRate)
    const flat = (chunks: Float32Array[]) => {
      const out = new Float32Array(total)
      let off = 0
      for (const c of chunks) {
        out.set(c, off)
        off += c.length
      }
      return out
    }
    buffer.copyToChannel(flat(this.chunksL), 0)
    if (this.channels > 1) buffer.copyToChannel(flat(this.chunksR), 1)
    this.chunksL = []
    this.chunksR = []
    return { buffer, startedAtCtxTime: this.startedAt }
  }
}
