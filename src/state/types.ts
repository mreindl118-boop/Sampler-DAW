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
  fadeIn: number // beats
  fadeOut: number // beats
}

export type Clip = MidiClip | AudioClip

export type TrackKind = 'synth' | 'sampler' | 'drums' | 'audio'

export interface AutomationPoint {
  id: string
  beat: number
  value: number // param units: volume 0..1.5, pan -1..1
}

export interface AutomationLane {
  id: string
  param: 'volume' | 'pan'
  points: AutomationPoint[]
  enabled: boolean
}

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
  /** Interface input channels feeding this track when recording: 1 (mono) or 2 (stereo pair) 0-based indices. */
  inputChannels: number[]
  /** Software input monitoring while armed. */
  monitor: boolean
  /** Hardware output pair index (0 = outs 1/2). -1 routes through the master bus. */
  outputPair: number
  /** External MIDI destination for MIDI tracks ('' = internal instrument only). */
  midiOutId: string
  midiOutChannel: number // 0-based
  automation: AutomationLane[]
  showAutomation: boolean
}

export interface Marker {
  id: string
  beat: number
  name: string
  /** MIDI Program Change (0-127) sent when playback passes the marker, or null. */
  pc: number | null
  /** MIDI CCs sent at the marker (e.g. Helix snapshot CC69). */
  ccs: { num: number; val: number }[]
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
  master: { volume: number; fx: FxUnit[]; outputPair: number }
  markers: Marker[]
  /** Device labels captured at save time so routing can be restored by name on another machine. */
  io: { inputLabel: string; outputLabel: string }
}

// ---------- UI state ----------

export type BottomTab = 'piano' | 'steps' | 'mixer' | 'chords' | 'instrument' | 'keys'

export interface UIState {
  selectedTrackId: string | null
  selectedClipId: string | null
  bottomTab: BottomTab
  snap: number // beats (0.25 = 1/16 in 4/4)
  snapOn: boolean
  showSettings: boolean
  showHelp: boolean
  tourStep: number | null
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
