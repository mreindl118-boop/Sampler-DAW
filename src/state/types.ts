// ---------- Core data model for OpenStudio projects ----------

export type OscWave = 'sine' | 'triangle' | 'sawtooth' | 'square'

export interface ADSR {
  a: number // attack seconds
  d: number // decay seconds
  s: number // sustain 0..1
  r: number // release seconds
}

export type FxType =
  | 'delay'
  | 'reverb'
  | 'distortion'
  | 'chorus'
  | 'eq3'
  | 'compressor'
  | 'filter'
  | 'bitcrush'

export interface FxUnit {
  id: string
  type: FxType
  enabled: boolean
  params: Record<string, number>
}

export interface SynthParams {
  osc1: { wave: OscWave; octave: number; detune: number; level: number }
  osc2: { wave: OscWave; octave: number; detune: number; level: number }
  noise: number
  filter: { type: 'lowpass' | 'highpass' | 'bandpass'; cutoff: number; q: number; envAmount: number }
  ampEnv: ADSR
  filterEnv: ADSR
  lfo: { rate: number; depth: number; target: 'pitch' | 'filter' | 'amp' }
  unison: number // 1..4 stacked layers
  unisonSpread: number // cents
  glide: number // seconds
  gain: number
  bendRange: number // semitones (MPE devices like ROLI default to 48)
}

export interface SamplerParams {
  sampleId: string | null
  rootNote: number
  loop: boolean
  start: number // 0..1 normalized
  end: number // 0..1 normalized
  env: ADSR
  gain: number
}

export interface DrumLane {
  name: string
  tune: number // -12..12 semitones
  decay: number // 0..1
  level: number // 0..1
}

export interface DrumParams {
  lanes: DrumLane[] // fixed 8 lanes
  gain: number
}

export interface Note {
  id: string
  pitch: number // MIDI note; for drum tracks this is the lane index 0..7
  start: number // beats, relative to clip start
  dur: number // beats
  vel: number // 0..1
}

export interface MidiClip {
  id: string
  kind: 'midi'
  name: string
  start: number // beats, absolute on timeline
  length: number // beats
  notes: Note[]
}

export interface AudioClip {
  id: string
  kind: 'audio'
  name: string
  start: number // beats
  length: number // beats (derived from sample duration at record tempo)
  sampleId: string
  offset: number // seconds into the sample
  gain: number
}

export type Clip = MidiClip | AudioClip

export type TrackKind = 'synth' | 'sampler' | 'drums' | 'audio'

export interface Track {
  id: string
  name: string
  kind: TrackKind
  color: string
  volume: number // 0..1.5
  pan: number // -1..1
  mute: boolean
  solo: boolean
  armed: boolean
  clips: Clip[]
  synth?: SynthParams
  sampler?: SamplerParams
  drums?: DrumParams
  fx: FxUnit[]
}

export interface SampleMeta {
  id: string
  name: string
  duration: number // seconds
}

export interface Project {
  name: string
  tempo: number
  timeSig: [number, number]
  bars: number
  key: number // 0..11, 0 = C
  scale: string
  tracks: Track[]
  samples: SampleMeta[]
  loop: { on: boolean; start: number; end: number } // beats
  master: { volume: number; fx: FxUnit[] }
}

// ---------- UI state ----------

export type BottomTab = 'piano' | 'steps' | 'mixer' | 'chords' | 'instrument' | 'keys'

export interface UIState {
  selectedTrackId: string | null
  selectedClipId: string | null
  bottomTab: BottomTab
  snap: number // beats (0.25 = 1/16 in 4/4)
  showSettings: boolean
  recording: boolean
  midiInputs: string[]
  mpeEnabled: boolean
  audioInputId: string
  keyboardOctave: number
  zoomX: number // px per beat in arranger
}

export interface AppState {
  project: Project
  ui: UIState
}
