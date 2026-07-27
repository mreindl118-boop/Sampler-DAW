import { getSettings, updateSettings } from '../state/settings'
import { toast } from '../state/toasts'

/**
 * Device-agnostic audio I/O layer.
 *
 * Responsibilities:
 *  - enumerate input/output devices, independent selection, persistence
 *  - device profiles (Line 6 Helix Stadium XL) with auto-detect by name
 *  - hot-plug: fall back to default on disconnect, restore preferred device on reconnect
 *  - multi-channel input (up to 8 ch) with per-consumer channel taps
 *  - multi-channel output pairs via ChannelMerger where the hardware exposes >2 channels
 *  - latency reporting and round-trip measurement
 *
 * Browser platform notes (documented limitations):
 *  - getUserMedia is asked for 8 channels with all voice processing disabled; the browser/OS
 *    may still deliver fewer channels (Chrome commonly caps class-compliant interfaces at 2).
 *    The actual channel count is surfaced in the UI and diagnostics, never silently assumed.
 *  - Output device selection uses AudioContext.setSinkId (Chrome 110+). Multi-channel output
 *    works when destination.maxChannelCount > 2; otherwise pairs collapse to outs 1/2.
 *  - Buffer size is not directly adjustable in Web Audio; the latencyHint (interactive /
 *    balanced / playback) is the supported control and base/output latency are reported.
 *  - 24-bit device I/O arrives as float32 — no truncation happens in the app.
 */

export interface DeviceProfile {
  name: string
  match: RegExp
  inputLabels: string[]
  outputLabels: string[]
  notes: string
}

export const HELIX_STADIUM: DeviceProfile = {
  name: 'Line 6 Helix Stadium XL',
  match: /helix\s*stadium|line\s*6.*helix|helix.*xl/i,
  inputLabels: [
    'USB 1 (Main L)', 'USB 2 (Main R)', 'USB 3', 'USB 4',
    'USB 5', 'USB 6', 'USB 7 (Dry / Re-amp DI)', 'USB 8 (Mic In)',
  ],
  outputLabels: [
    'USB 1 (To Main L)', 'USB 2 (To Main R)', 'USB 3 (Re-amp feed L)', 'USB 4 (Re-amp feed R)',
    'USB 5', 'USB 6', 'USB 7', 'USB 8',
  ],
  notes:
    'USB 1/2 carry the processed stereo signal; USB 7 is the dry DI (re-amp source). ' +
    'Sending playback to USB 3/4 feeds the hardware signal chain for re-amping.',
}

const PROFILES = [HELIX_STADIUM]

export const MAX_CHANNELS = 8

export interface IOStatus {
  inputs: MediaDeviceInfo[]
  outputs: MediaDeviceInfo[]
  activeInputId: string
  activeInputLabel: string
  activeOutputId: string
  activeOutputLabel: string
  inputChannelCount: number
  outputChannelCount: number
  inputOpen: boolean
  profile: DeviceProfile | null
  sampleRate: number
  baseLatencyMs: number
  outputLatencyMs: number
}

type Listener = () => void

class AudioIO {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private splitter: ChannelSplitterNode | null = null
  private inputChannelCount = 0
  private activeInputId = ''
  private activeInputLabel = ''
  private activeOutputId = ''
  private activeOutputLabel = ''
  private merger: ChannelMergerNode | null = null
  private pairGains: GainNode[] = []
  private taps: { channels: number[]; node: GainNode }[] = []
  private devices: MediaDeviceInfo[] = []
  private listeners = new Set<Listener>()
  private watching = false
  /** Set while a preferred device is disconnected and we're on fallback. */
  private wantInputLabel = ''
  private wantOutputLabel = ''

  // ---------- lifecycle ----------

  attach(ctx: AudioContext): void {
    if (this.ctx === ctx) return
    this.ctx = ctx
    this.setupOutputBus()
    if (!this.watching && navigator.mediaDevices) {
      this.watching = true
      navigator.mediaDevices.addEventListener?.('devicechange', () => void this.onDeviceChange())
      void this.refreshDevices()
    }
    void this.applyOutputSelection(getSettings().outputDeviceId, false)
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private notify(): void {
    this.listeners.forEach((l) => l())
  }

  // ---------- enumeration / hot-plug ----------

  async refreshDevices(requestPermission = false): Promise<void> {
    if (!navigator.mediaDevices) return
    if (requestPermission) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
        tmp.getTracks().forEach((t) => t.stop())
      } catch {
        /* labels stay hidden without permission */
      }
    }
    this.devices = await navigator.mediaDevices.enumerateDevices()
    this.notify()
  }

  private async onDeviceChange(): Promise<void> {
    const prevInputs = this.devices.filter((d) => d.kind === 'audioinput').length
    await this.refreshDevices()
    const s = getSettings()

    // input disappeared while open?
    if (this.stream && this.activeInputId) {
      const still = this.inputDevices().some((d) => d.deviceId === this.activeInputId)
      const trackLive = this.stream.getAudioTracks().some((t) => t.readyState === 'live')
      if (!still || !trackLive) {
        toast(`Audio input "${this.activeInputLabel || 'device'}" disconnected — falling back to system default`, 'warn')
        this.wantInputLabel = this.activeInputLabel
        await this.openInput('') // default
      }
    }
    // preferred input reappeared?
    const wanted = this.wantInputLabel || (s.preferStadium ? '' : s.inputDeviceLabel)
    const reappeared = this.findByLabel(this.inputDevices(), this.wantInputLabel)
    if (this.wantInputLabel && reappeared) {
      toast(`"${reappeared.label}" reconnected — restoring input routing`, 'info')
      this.wantInputLabel = ''
      if (this.stream) await this.openInput(reappeared.deviceId)
      else {
        updateSettings({ inputDeviceId: reappeared.deviceId, inputDeviceLabel: reappeared.label })
      }
    } else if (s.preferStadium && this.devices.filter((d) => d.kind === 'audioinput').length > prevInputs) {
      // brand-new device: auto-detect Stadium
      const stadium = this.inputDevices().find((d) => HELIX_STADIUM.match.test(d.label))
      if (stadium && stadium.deviceId !== s.inputDeviceId) {
        toast(`${HELIX_STADIUM.name} detected — selected as audio input`, 'info')
        updateSettings({ inputDeviceId: stadium.deviceId, inputDeviceLabel: stadium.label })
        if (this.stream) await this.openInput(stadium.deviceId)
        const stadiumOut = this.outputDevices().find((d) => HELIX_STADIUM.match.test(d.label))
        if (stadiumOut) await this.applyOutputSelection(stadiumOut.deviceId, true)
      }
    }
    // output disappeared?
    if (this.activeOutputId && !this.outputDevices().some((d) => d.deviceId === this.activeOutputId)) {
      toast(`Audio output "${this.activeOutputLabel || 'device'}" disconnected — using system default`, 'warn')
      this.wantOutputLabel = this.activeOutputLabel
      await this.applyOutputSelection('', false)
    } else if (this.wantOutputLabel) {
      const back = this.findByLabel(this.outputDevices(), this.wantOutputLabel)
      if (back) {
        this.wantOutputLabel = ''
        toast(`Output "${back.label}" reconnected — restoring routing`, 'info')
        await this.applyOutputSelection(back.deviceId, true)
      }
    }
    this.notify()
  }

  private findByLabel(list: MediaDeviceInfo[], label: string): MediaDeviceInfo | undefined {
    if (!label) return undefined
    return list.find((d) => d.label === label)
  }

  inputDevices(): MediaDeviceInfo[] {
    return this.devices.filter((d) => d.kind === 'audioinput')
  }

  outputDevices(): MediaDeviceInfo[] {
    return this.devices.filter((d) => d.kind === 'audiooutput')
  }

  /** Best-effort auto-detect: returns the Stadium input device if present. */
  detectStadiumInput(): MediaDeviceInfo | undefined {
    return this.inputDevices().find((d) => HELIX_STADIUM.match.test(d.label))
  }

  activeProfile(): DeviceProfile | null {
    const label = this.activeInputLabel || getSettings().inputDeviceLabel
    return PROFILES.find((p) => p.match.test(label)) ?? null
  }

  // ---------- input ----------

  /**
   * Open (or reopen) the shared multi-channel input stream. All voice processing is
   * explicitly disabled — echo cancellation / noise suppression / AGC destroy instrument signals.
   */
  async openInput(deviceId?: string): Promise<void> {
    if (!this.ctx) throw new Error('AudioIO not attached')
    const id = deviceId ?? getSettings().inputDeviceId
    this.closeInput()
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: id ? { exact: id } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: MAX_CHANNELS },
        sampleRate: { ideal: this.ctx.sampleRate },
      },
    })
    const track = this.stream.getAudioTracks()[0]
    const settings = track?.getSettings() ?? {}
    this.inputChannelCount = settings.channelCount ?? 2
    this.activeInputId = (settings.deviceId as string) ?? id ?? ''
    this.activeInputLabel = track?.label ?? ''
    if (settings.sampleRate && settings.sampleRate !== this.ctx.sampleRate) {
      toast(
        `Input runs at ${settings.sampleRate} Hz but the engine is at ${this.ctx.sampleRate} Hz — the browser is resampling`,
        'warn'
      )
    }
    this.source = this.ctx.createMediaStreamSource(this.stream)
    // channelCount on the source reflects the real stream width
    this.inputChannelCount = Math.max(this.inputChannelCount, this.source.channelCount)
    this.splitter = this.ctx.createChannelSplitter(MAX_CHANNELS)
    this.source.connect(this.splitter)
    // rewire existing taps
    for (const tap of this.taps) this.wireTap(tap)
    if (id) updateSettings({ inputDeviceId: this.activeInputId, inputDeviceLabel: this.activeInputLabel })
    this.notify()
  }

  closeInput(): void {
    this.taps.forEach((t) => {
      try { t.node.disconnect() } catch { /* ok */ }
    })
    try { this.source?.disconnect() } catch { /* ok */ }
    try { this.splitter?.disconnect() } catch { /* ok */ }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.source = null
    this.splitter = null
    this.notify()
  }

  inputIsOpen(): boolean {
    return !!this.stream
  }

  rawSource(): MediaStreamAudioSourceNode | null {
    return this.source
  }

  realInputChannels(): number {
    return this.inputChannelCount
  }

  /**
   * A mono/stereo tap of specific input channels (0-based). Mono channels are
   * duplicated to both sides; pairs map to L/R. Channels beyond the device's
   * real width are silent — the UI flags this rather than failing.
   */
  getTap(channels: number[]): GainNode {
    if (!this.ctx) throw new Error('AudioIO not attached')
    const node = this.ctx.createGain()
    const tap = { channels, node }
    this.taps.push(tap)
    this.wireTap(tap)
    return node
  }

  releaseTap(node: GainNode): void {
    this.taps = this.taps.filter((t) => t.node !== node)
    try { node.disconnect() } catch { /* ok */ }
  }

  private wireTap(tap: { channels: number[]; node: GainNode }): void {
    if (!this.ctx || !this.splitter) return
    const merger = this.ctx.createChannelMerger(2)
    const chans = tap.channels.length ? tap.channels : [0]
    if (chans.length === 1) {
      this.splitter.connect(merger, Math.min(chans[0], MAX_CHANNELS - 1), 0)
      this.splitter.connect(merger, Math.min(chans[0], MAX_CHANNELS - 1), 1)
    } else {
      this.splitter.connect(merger, Math.min(chans[0], MAX_CHANNELS - 1), 0)
      this.splitter.connect(merger, Math.min(chans[1], MAX_CHANNELS - 1), 1)
    }
    merger.connect(tap.node)
  }

  // ---------- output ----------

  private setupOutputBus(): void {
    if (!this.ctx) return
    const dest = this.ctx.destination
    const hw = Math.min(MAX_CHANNELS, dest.maxChannelCount || 2)
    this.pairGains = []
    if (hw > 2) {
      dest.channelCount = hw
      dest.channelCountMode = 'explicit'
      dest.channelInterpretation = 'discrete'
      this.merger = this.ctx.createChannelMerger(hw)
      this.merger.connect(dest)
      for (let p = 0; p < Math.floor(hw / 2); p++) {
        const g = this.ctx.createGain()
        const split = this.ctx.createChannelSplitter(2)
        g.connect(split)
        split.connect(this.merger, 0, p * 2)
        split.connect(this.merger, 1, p * 2 + 1)
        this.pairGains.push(g)
      }
    } else {
      this.merger = null
      const g = this.ctx.createGain()
      g.connect(dest)
      this.pairGains = [g]
    }
    this.notify()
  }

  /** Number of stereo output pairs the current output device exposes. */
  outputPairCount(): number {
    return Math.max(1, this.pairGains.length)
  }

  /** Destination node for a given stereo pair (clamped to what the hardware has). */
  getOutputPair(pair: number): AudioNode {
    const idx = Math.min(Math.max(0, pair), this.pairGains.length - 1)
    return this.pairGains[idx]
  }

  async applyOutputSelection(deviceId: string, persist: boolean): Promise<void> {
    if (!this.ctx) return
    const ctxWithSink = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (typeof ctxWithSink.setSinkId === 'function') {
      try {
        await ctxWithSink.setSinkId(deviceId || '')
        this.activeOutputId = deviceId
        const dev = this.outputDevices().find((d) => d.deviceId === deviceId)
        this.activeOutputLabel = dev?.label ?? (deviceId ? this.activeOutputLabel : 'System default')
        if (persist) updateSettings({ outputDeviceId: deviceId, outputDeviceLabel: this.activeOutputLabel })
        // channel layout can change with the device
        this.setupOutputBus()
      } catch (e) {
        toast(`Could not switch output device: ${e}`, 'error')
      }
    } else if (deviceId) {
      toast('Output device selection (setSinkId) is not supported in this browser — using system default', 'warn')
    }
    this.notify()
  }

  // ---------- status / latency ----------

  status(): IOStatus {
    const ctx = this.ctx
    const outLat = (ctx as AudioContext & { outputLatency?: number })?.outputLatency ?? 0
    return {
      inputs: this.inputDevices(),
      outputs: this.outputDevices(),
      activeInputId: this.activeInputId || getSettings().inputDeviceId,
      activeInputLabel: this.activeInputLabel || getSettings().inputDeviceLabel,
      activeOutputId: this.activeOutputId,
      activeOutputLabel: this.activeOutputLabel || 'System default',
      inputChannelCount: this.inputChannelCount,
      outputChannelCount: this.ctx ? Math.min(MAX_CHANNELS, this.ctx.destination.maxChannelCount || 2) : 2,
      inputOpen: !!this.stream,
      profile: this.activeProfile(),
      sampleRate: ctx?.sampleRate ?? 0,
      baseLatencyMs: (ctx?.baseLatency ?? 0) * 1000,
      outputLatencyMs: outLat * 1000,
    }
  }

  /**
   * Round-trip latency measurement: emits 3 short clicks and finds them in the
   * recorded input (requires a physical loopback — e.g. Stadium outs into its inputs,
   * or acoustic mic pickup). Returns milliseconds, or null if no signal was detected.
   */
  async measureRoundTrip(): Promise<number | null> {
    if (!this.ctx) return null
    const ctx = this.ctx
    const wasOpen = this.inputIsOpen()
    if (!wasOpen) await this.openInput()
    if (!this.source) return null

    const capture = ctx.createScriptProcessor(2048, 1, 1)
    const chunks: Float32Array[] = []
    let captureStart = 0
    capture.onaudioprocess = (e) => {
      if (captureStart === 0) captureStart = e.playbackTime - e.inputBuffer.duration
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    const sink = ctx.createGain()
    sink.gain.value = 0
    this.source.connect(capture)
    capture.connect(sink)
    sink.connect(ctx.destination)

    const clickTimes: number[] = []
    const t0 = ctx.currentTime + 0.15
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.35
      clickTimes.push(t)
      const osc = ctx.createOscillator()
      osc.frequency.value = 2000
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.9, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.01)
      osc.connect(g)
      g.connect(this.getOutputPair(0))
      osc.start(t)
      osc.stop(t + 0.02)
    }

    await new Promise((r) => setTimeout(r, 1400))
    capture.disconnect()
    try { this.source.disconnect(capture) } catch { /* ok */ }
    sink.disconnect()
    if (!wasOpen) this.closeInput()

    const total = chunks.reduce((n, c) => n + c.length, 0)
    if (total === 0) return null
    const data = new Float32Array(total)
    let off = 0
    for (const c of chunks) {
      data.set(c, off)
      off += c.length
    }
    // find first strong onset above noise floor
    let peak = 0
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
    if (peak < 0.02) return null
    const threshold = Math.max(0.02, peak * 0.5)
    let onset = -1
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) >= threshold) {
        onset = i
        break
      }
    }
    if (onset < 0) return null
    const onsetTime = captureStart + onset / ctx.sampleRate
    const rtMs = (onsetTime - clickTimes[0]) * 1000
    if (rtMs < 0 || rtMs > 900) return null
    updateSettings({ measuredRoundTripMs: rtMs, recordingOffsetMs: Math.round(rtMs) })
    return rtMs
  }
}

export const audioIO = new AudioIO()

/** Parse a WAV header for the true source sample rate (decodeAudioData resamples silently). */
export function wavSampleRate(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 28) return null
  const v = new DataView(buf)
  if (v.getUint32(0, false) !== 0x52494646) return null // 'RIFF'
  // scan chunks for 'fmt '
  let off = 12
  while (off + 8 <= buf.byteLength) {
    const id = v.getUint32(off, false)
    const size = v.getUint32(off + 4, true)
    if (id === 0x666d7420) return v.getUint32(off + 12, true) // fmt -> sampleRate at +4 within chunk body
    off += 8 + size + (size % 2)
  }
  return null
}
