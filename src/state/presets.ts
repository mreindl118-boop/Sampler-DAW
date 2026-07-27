import type { DrumParams, FxUnit, FxType, SamplerParams, SynthParams } from './types'

let idCounter = 0
export function uid(prefix = 'id'): string {
  idCounter++
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

export const TRACK_COLORS = ['#2f81f7', '#57d9a3', '#f7b32f', '#f75f5f', '#b48cf2', '#4fd2e8', '#f28cc7', '#9acd32']

export function defaultSynth(): SynthParams {
  return {
    osc1: { wave: 'sawtooth', octave: 0, detune: -7, level: 0.7 },
    osc2: { wave: 'sawtooth', octave: 0, detune: 7, level: 0.7 },
    noise: 0,
    filter: { type: 'lowpass', cutoff: 4000, q: 1, envAmount: 2000 },
    ampEnv: { a: 0.01, d: 0.2, s: 0.7, r: 0.3 },
    filterEnv: { a: 0.01, d: 0.25, s: 0.4, r: 0.3 },
    lfo: { rate: 5, depth: 0, target: 'pitch' },
    unison: 1,
    unisonSpread: 12,
    glide: 0,
    gain: 0.8,
    bendRange: 2,
  }
}

export interface SynthPreset {
  name: string
  params: SynthParams
}

const P = (over: Partial<SynthParams> & Record<string, unknown>): SynthParams => ({ ...defaultSynth(), ...(over as Partial<SynthParams>) })

export const SYNTH_PRESETS: SynthPreset[] = [
  { name: 'Super Saw Lead', params: P({ unison: 3, unisonSpread: 18, filter: { type: 'lowpass', cutoff: 6000, q: 1, envAmount: 1500 } }) },
  {
    name: 'Warm Pad',
    params: P({
      osc1: { wave: 'sawtooth', octave: 0, detune: -5, level: 0.5 },
      osc2: { wave: 'triangle', octave: -1, detune: 5, level: 0.6 },
      ampEnv: { a: 0.8, d: 0.5, s: 0.8, r: 1.5 },
      filterEnv: { a: 0.9, d: 0.6, s: 0.5, r: 1.2 },
      filter: { type: 'lowpass', cutoff: 1800, q: 0.7, envAmount: 900 },
      unison: 2,
      unisonSpread: 14,
    }),
  },
  {
    name: 'Deep Bass',
    params: P({
      osc1: { wave: 'square', octave: -1, detune: 0, level: 0.8 },
      osc2: { wave: 'sine', octave: -2, detune: 0, level: 0.9 },
      filter: { type: 'lowpass', cutoff: 700, q: 2, envAmount: 1200 },
      ampEnv: { a: 0.005, d: 0.25, s: 0.5, r: 0.15 },
      filterEnv: { a: 0.005, d: 0.18, s: 0.2, r: 0.15 },
    }),
  },
  {
    name: 'Pluck',
    params: P({
      osc1: { wave: 'triangle', octave: 0, detune: 0, level: 0.8 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 4, level: 0.4 },
      ampEnv: { a: 0.002, d: 0.28, s: 0, r: 0.25 },
      filterEnv: { a: 0.002, d: 0.2, s: 0, r: 0.2 },
      filter: { type: 'lowpass', cutoff: 900, q: 1.5, envAmount: 4500 },
    }),
  },
  {
    name: 'Glass Keys',
    params: P({
      osc1: { wave: 'sine', octave: 0, detune: 0, level: 0.8 },
      osc2: { wave: 'sine', octave: 1, detune: 3, level: 0.35 },
      ampEnv: { a: 0.004, d: 0.6, s: 0.25, r: 0.6 },
      filter: { type: 'lowpass', cutoff: 8000, q: 0.5, envAmount: 0 },
      lfo: { rate: 5.5, depth: 4, target: 'pitch' },
    }),
  },
  {
    name: 'MPE Expressive (ROLI)',
    params: P({
      osc1: { wave: 'sawtooth', octave: 0, detune: -4, level: 0.65 },
      osc2: { wave: 'square', octave: 0, detune: 4, level: 0.4 },
      ampEnv: { a: 0.05, d: 0.3, s: 0.85, r: 0.5 },
      filter: { type: 'lowpass', cutoff: 2500, q: 1.2, envAmount: 1200 },
      bendRange: 48,
      glide: 0,
    }),
  },
  {
    name: 'Acid 303',
    params: P({
      osc1: { wave: 'sawtooth', octave: -1, detune: 0, level: 0.9 },
      osc2: { wave: 'sawtooth', octave: -1, detune: 0, level: 0 },
      filter: { type: 'lowpass', cutoff: 500, q: 8, envAmount: 3500 },
      ampEnv: { a: 0.003, d: 0.18, s: 0.3, r: 0.1 },
      filterEnv: { a: 0.003, d: 0.16, s: 0.05, r: 0.1 },
      glide: 0.06,
    }),
  },
  {
    name: 'Strings',
    params: P({
      osc1: { wave: 'sawtooth', octave: 0, detune: -9, level: 0.55 },
      osc2: { wave: 'sawtooth', octave: 0, detune: 9, level: 0.55 },
      unison: 2,
      unisonSpread: 10,
      ampEnv: { a: 0.35, d: 0.3, s: 0.9, r: 0.8 },
      filter: { type: 'lowpass', cutoff: 3200, q: 0.6, envAmount: 400 },
      lfo: { rate: 4.5, depth: 3, target: 'pitch' },
    }),
  },
]

export function defaultSampler(): SamplerParams {
  return {
    sampleId: null,
    rootNote: 60,
    loop: false,
    start: 0,
    end: 1,
    env: { a: 0.003, d: 0.1, s: 1, r: 0.2 },
    gain: 0.9,
  }
}

export const DRUM_LANE_NAMES = ['Kick', 'Snare', 'Clap', 'Hat Closed', 'Hat Open', 'Tom Low', 'Tom High', 'Crash']

export function defaultDrums(): DrumParams {
  return {
    lanes: DRUM_LANE_NAMES.map((name) => ({ name, tune: 0, decay: 0.5, level: 0.9 })),
    gain: 0.9,
  }
}

export function defaultFxParams(type: FxType): Record<string, number> {
  switch (type) {
    case 'delay':
      return { time: 0.375, feedback: 0.35, mix: 0.25 }
    case 'reverb':
      return { size: 2.2, decay: 2.5, mix: 0.3 }
    case 'distortion':
      return { drive: 0.4, mix: 1 }
    case 'chorus':
      return { rate: 0.8, depth: 0.004, mix: 0.5 }
    case 'eq3':
      return { low: 0, mid: 0, high: 0 }
    case 'compressor':
      return { threshold: -20, ratio: 4, attack: 0.01, release: 0.2 }
    case 'filter':
      return { freq: 2000, q: 1, type: 0 } // type: 0 lowpass, 1 highpass, 2 bandpass
    case 'bitcrush':
      return { bits: 6, mix: 0.7 }
  }
}

export function makeFx(type: FxType): FxUnit {
  return { id: uid('fx'), type, enabled: true, params: defaultFxParams(type) }
}

export const FX_TYPES: { type: FxType; label: string }[] = [
  { type: 'reverb', label: 'Reverb' },
  { type: 'delay', label: 'Delay' },
  { type: 'chorus', label: 'Chorus' },
  { type: 'distortion', label: 'Distortion' },
  { type: 'eq3', label: 'EQ 3-Band' },
  { type: 'compressor', label: 'Compressor' },
  { type: 'filter', label: 'Filter' },
  { type: 'bitcrush', label: 'Bitcrush' },
]
