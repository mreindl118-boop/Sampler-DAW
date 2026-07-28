import { useSyncExternalStore } from 'react'

/**
 * App-level settings persisted independently of projects (localStorage):
 * audio device choices, latency compensation, MIDI mappings & clock.
 */
export interface AppSettings {
  inputDeviceId: string
  inputDeviceLabel: string
  outputDeviceId: string
  outputDeviceLabel: string
  /** Auto-route to a Line 6 Helix Stadium when it (re)appears. */
  preferStadium: boolean
  /** Applied to every recorded/re-amped clip, in milliseconds. */
  recordingOffsetMs: number
  /** Last measured round-trip latency (ms), informational. */
  measuredRoundTripMs: number | null
  latencyHint: 'interactive' | 'balanced' | 'playback'
  /** MIDI-learn map: "cc:<num>" | "pc" (any channel) -> action id. */
  midiMap: Record<string, string>
  midiClockEnabled: boolean
  midiClockOutId: string
  /** Send marker PC/CC to this output. */
  midiPcOutId: string
  midiPcChannel: number // 0-based
  /** QWERTY → note mapping: key char → semitone offset from the keyboard's base C. */
  keyboardMap: Record<string, number>
}

/** Default QWERTY layout (FL-style): Z row = lower octave, Q row = upper octave. */
export const DEFAULT_KEY_MAP: Record<string, number> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  ',': 12, l: 13, '.': 14, ';': 15, '/': 16,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23,
  i: 24, '9': 25, o: 26, '0': 27, p: 28,
}

const DEFAULTS: AppSettings = {
  inputDeviceId: '',
  inputDeviceLabel: '',
  outputDeviceId: '',
  outputDeviceLabel: '',
  preferStadium: true,
  recordingOffsetMs: 0,
  measuredRoundTripMs: null,
  latencyHint: 'interactive',
  midiMap: {},
  midiClockEnabled: false,
  midiClockOutId: '',
  midiPcOutId: '',
  midiPcChannel: 0,
  keyboardMap: { ...DEFAULT_KEY_MAP },
}

const LS_KEY = 'openstudio.settings.v1'

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    /* fall through */
  }
  return { ...DEFAULTS }
}

let settings: AppSettings = load()
const listeners = new Set<() => void>()

export function getSettings(): AppSettings {
  return settings
}

export function updateSettings(patch: Partial<AppSettings>): void {
  settings = { ...settings, ...patch }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings))
  } catch {
    /* best effort */
  }
  listeners.forEach((l) => l())
}

export function useSettings<T>(sel: (s: AppSettings) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sel(settings)
  )
}

/** Transport-level actions that can be MIDI-learned. */
export const MIDI_ACTIONS: { id: string; label: string }[] = [
  { id: 'playStop', label: 'Play / Stop' },
  { id: 'record', label: 'Record' },
  { id: 'loopToggle', label: 'Loop on/off' },
  { id: 'returnToZero', label: 'Return to zero' },
  { id: 'prevMarker', label: 'Previous marker' },
  { id: 'nextMarker', label: 'Next marker' },
  { id: 'undo', label: 'Undo' },
]
