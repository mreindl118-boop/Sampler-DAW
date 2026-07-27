import type { FxUnit } from '../state/types'

/** A built effect: audio flows input -> ... -> output. */
export interface BuiltFx {
  input: AudioNode
  output: AudioNode
  dispose(): void
}

function wetDry(ctx: BaseAudioContext, core: { input: AudioNode; output: AudioNode }, mix: number): BuiltFx {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  input.connect(dry)
  dry.connect(output)
  input.connect(core.input)
  core.output.connect(wet)
  wet.connect(output)
  return {
    input,
    output,
    dispose() {
      input.disconnect()
      dry.disconnect()
      core.output.disconnect()
      wet.disconnect()
      output.disconnect()
    },
  }
}

function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.max(1, Math.floor(rate * seconds))
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

function distortionCurve(drive: number) {
  const k = drive * 100 + 1
  const n = 2048
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}

function bitcrushCurve(bits: number) {
  const n = 4096
  const steps = Math.pow(2, Math.max(1, Math.round(bits)))
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = Math.round(x * steps) / steps
  }
  return curve
}

export function buildFx(ctx: BaseAudioContext, fx: FxUnit): BuiltFx {
  const p = fx.params
  switch (fx.type) {
    case 'delay': {
      const inNode = ctx.createGain()
      const delay = ctx.createDelay(4)
      delay.delayTime.value = p.time ?? 0.375
      const fb = ctx.createGain()
      fb.gain.value = Math.min(0.95, p.feedback ?? 0.35)
      inNode.connect(delay)
      delay.connect(fb)
      fb.connect(delay)
      return wetDry(ctx, { input: inNode, output: delay }, p.mix ?? 0.25)
    }
    case 'reverb': {
      const conv = ctx.createConvolver()
      conv.buffer = makeImpulse(ctx, p.size ?? 2.2, p.decay ?? 2.5)
      return wetDry(ctx, { input: conv, output: conv }, p.mix ?? 0.3)
    }
    case 'distortion': {
      const pre = ctx.createGain()
      pre.gain.value = 1 + (p.drive ?? 0.4) * 2
      const shaper = ctx.createWaveShaper()
      shaper.curve = distortionCurve(p.drive ?? 0.4)
      shaper.oversample = '4x'
      const post = ctx.createGain()
      post.gain.value = 1 / (1 + (p.drive ?? 0.4))
      pre.connect(shaper)
      shaper.connect(post)
      return wetDry(ctx, { input: pre, output: post }, p.mix ?? 1)
    }
    case 'chorus': {
      const inNode = ctx.createGain()
      const delay = ctx.createDelay(0.1)
      delay.delayTime.value = 0.02
      const lfo = ctx.createOscillator()
      lfo.frequency.value = p.rate ?? 0.8
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = p.depth ?? 0.004
      lfo.connect(lfoGain)
      lfoGain.connect(delay.delayTime)
      lfo.start()
      inNode.connect(delay)
      const built = wetDry(ctx, { input: inNode, output: delay }, p.mix ?? 0.5)
      const origDispose = built.dispose
      built.dispose = () => {
        try {
          lfo.stop()
        } catch { /* already stopped */ }
        origDispose()
      }
      return built
    }
    case 'eq3': {
      const low = ctx.createBiquadFilter()
      low.type = 'lowshelf'
      low.frequency.value = 250
      low.gain.value = p.low ?? 0
      const mid = ctx.createBiquadFilter()
      mid.type = 'peaking'
      mid.frequency.value = 1200
      mid.Q.value = 0.8
      mid.gain.value = p.mid ?? 0
      const high = ctx.createBiquadFilter()
      high.type = 'highshelf'
      high.frequency.value = 4500
      high.gain.value = p.high ?? 0
      low.connect(mid)
      mid.connect(high)
      return { input: low, output: high, dispose: () => { low.disconnect(); mid.disconnect(); high.disconnect() } }
    }
    case 'compressor': {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = p.threshold ?? -20
      comp.ratio.value = p.ratio ?? 4
      comp.attack.value = p.attack ?? 0.01
      comp.release.value = p.release ?? 0.2
      return { input: comp, output: comp, dispose: () => comp.disconnect() }
    }
    case 'filter': {
      const f = ctx.createBiquadFilter()
      f.type = ([ 'lowpass', 'highpass', 'bandpass' ] as BiquadFilterType[])[Math.round(p.type ?? 0)] ?? 'lowpass'
      f.frequency.value = p.freq ?? 2000
      f.Q.value = p.q ?? 1
      return { input: f, output: f, dispose: () => f.disconnect() }
    }
    case 'bitcrush': {
      const shaper = ctx.createWaveShaper()
      shaper.curve = bitcrushCurve(p.bits ?? 6)
      return wetDry(ctx, { input: shaper, output: shaper }, p.mix ?? 0.7)
    }
  }
}

/** Build a serial chain from a track's fx list. Returns entry/exit; caller connects around it. */
export function buildFxChain(ctx: BaseAudioContext, fxList: FxUnit[]): { input: AudioNode; output: AudioNode; dispose(): void } {
  const entry = ctx.createGain()
  let cursor: AudioNode = entry
  const built: BuiltFx[] = []
  for (const fx of fxList) {
    if (!fx.enabled) continue
    const b = buildFx(ctx, fx)
    cursor.connect(b.input)
    cursor = b.output
    built.push(b)
  }
  return {
    input: entry,
    output: cursor,
    dispose() {
      entry.disconnect()
      built.forEach((b) => b.dispose())
    },
  }
}
