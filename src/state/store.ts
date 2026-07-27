import { useSyncExternalStore } from 'react'
import type { AppState, Clip, MidiClip, Note, Project, Track, TrackKind, UIState } from './types'
import { TRACK_COLORS, defaultDrums, defaultSampler, defaultSynth, uid } from './presets'

// ---------- tiny external store ----------

function demoProject(): Project {
  const synthTrack = makeTrack('synth', 'Lead Synth')
  const drumTrack = makeTrack('drums', 'Drums')
  // small starter groove so first Play press makes sound
  const drumNotes: Note[] = []
  for (let step = 0; step < 16; step++) {
    const b = step * 0.25
    if (step % 4 === 0) drumNotes.push({ id: uid('n'), pitch: 0, start: b, dur: 0.25, vel: 1 })
    if (step % 8 === 4) drumNotes.push({ id: uid('n'), pitch: 1, start: b, dur: 0.25, vel: 0.9 })
    if (step % 2 === 0) drumNotes.push({ id: uid('n'), pitch: 3, start: b, dur: 0.25, vel: step % 4 === 2 ? 0.5 : 0.75 })
  }
  drumTrack.clips.push({ id: uid('clip'), kind: 'midi', name: 'Beat 1', start: 0, length: 4, notes: drumNotes })
  const melody: [number, number, number][] = [
    [60, 0, 0.5], [63, 0.5, 0.5], [67, 1, 1], [65, 2, 0.5], [63, 2.5, 0.5], [60, 3, 1],
  ]
  synthTrack.clips.push({
    id: uid('clip'),
    kind: 'midi',
    name: 'Melody',
    start: 0,
    length: 4,
    notes: melody.map(([p, s, d]) => ({ id: uid('n'), pitch: p, start: s, dur: d, vel: 0.85 })),
  })
  return {
    name: 'New Project',
    tempo: 120,
    timeSig: [4, 4],
    bars: 32,
    key: 0,
    scale: 'Natural Minor',
    tracks: [synthTrack, drumTrack],
    samples: [],
    loop: { on: true, start: 0, end: 8 },
    master: { volume: 0.9, fx: [] },
  }
}

export function makeTrack(kind: TrackKind, name?: string): Track {
  const t: Track = {
    id: uid('trk'),
    name: name ?? { synth: 'Synth', sampler: 'Sampler', drums: 'Drums', audio: 'Audio' }[kind],
    kind,
    color: TRACK_COLORS[Math.floor(Math.random() * TRACK_COLORS.length)],
    volume: 0.85,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    clips: [],
    fx: [],
  }
  if (kind === 'synth') t.synth = defaultSynth()
  if (kind === 'sampler') t.sampler = defaultSampler()
  if (kind === 'drums') t.drums = defaultDrums()
  return t
}

function initialState(): AppState {
  const project = demoProject()
  return {
    project,
    ui: {
      selectedTrackId: project.tracks[0]?.id ?? null,
      selectedClipId: project.tracks[0]?.clips[0]?.id ?? null,
      bottomTab: 'keys',
      snap: 0.25,
      showSettings: false,
      recording: false,
      midiInputs: [],
      mpeEnabled: true,
      audioInputId: '',
      keyboardOctave: 4,
      zoomX: 32,
    },
  }
}

let state: AppState = initialState()
const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export function subscribeStore(l: () => void): () => void {
  return subscribe(l)
}

// ---------- undo / redo ----------

const undoStack: Project[] = []
const redoStack: Project[] = []
const UNDO_LIMIT = 60

/** Snapshot current project before a (gesture of) edits. */
export function beginGesture(): void {
  undoStack.push(state.project)
  if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  redoStack.length = 0
}

export function undo(): void {
  const prev = undoStack.pop()
  if (!prev) return
  redoStack.push(state.project)
  setState({ project: prev })
}

export function redo(): void {
  const next = redoStack.pop()
  if (!next) return
  undoStack.push(state.project)
  setState({ project: next })
}

// ---------- project mutation helpers ----------

export function setProject(fn: (p: Project) => Project): void {
  setState((s) => ({ project: fn(s.project) }))
}

export function setUI(patch: Partial<UIState>): void {
  setState((s) => ({ ui: { ...s.ui, ...patch } }))
}

export function mapTrack(trackId: string, fn: (t: Track) => Track): void {
  setProject((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? fn(t) : t)) }))
}

export function mapClip(trackId: string, clipId: string, fn: (c: Clip) => Clip): void {
  mapTrack(trackId, (t) => ({ ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) }))
}

export function addTrack(kind: TrackKind): Track {
  const t = makeTrack(kind)
  beginGesture()
  setProject((p) => ({ ...p, tracks: [...p.tracks, t] }))
  setUI({ selectedTrackId: t.id, bottomTab: kind === 'audio' ? 'mixer' : 'instrument' })
  return t
}

export function removeTrack(trackId: string): void {
  beginGesture()
  setProject((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== trackId) }))
  setState((s) => ({
    ui: {
      ...s.ui,
      selectedTrackId: s.ui.selectedTrackId === trackId ? s.project.tracks[0]?.id ?? null : s.ui.selectedTrackId,
    },
  }))
}

export function addMidiClip(trackId: string, start: number, length = 4): MidiClip {
  const clip: MidiClip = { id: uid('clip'), kind: 'midi', name: 'Clip', start, length, notes: [] }
  beginGesture()
  mapTrack(trackId, (t) => ({ ...t, clips: [...t.clips, clip] }))
  setUI({ selectedClipId: clip.id, selectedTrackId: trackId })
  return clip
}

export function removeClip(trackId: string, clipId: string): void {
  beginGesture()
  mapTrack(trackId, (t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }))
  setState((s) => ({ ui: { ...s.ui, selectedClipId: s.ui.selectedClipId === clipId ? null : s.ui.selectedClipId } }))
}

export function findClip(clipId: string | null): { track: Track; clip: Clip } | null {
  if (!clipId) return null
  for (const track of state.project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { track, clip }
  }
  return null
}

export function findTrack(trackId: string | null): Track | null {
  return state.project.tracks.find((t) => t.id === trackId) ?? null
}

// ---------- notes ----------

export function addNote(trackId: string, clipId: string, note: Omit<Note, 'id'>): Note {
  const n: Note = { ...note, id: uid('n') }
  mapClip(trackId, clipId, (c) => (c.kind === 'midi' ? { ...c, notes: [...c.notes, n] } : c))
  return n
}

export function updateNote(trackId: string, clipId: string, noteId: string, patch: Partial<Note>): void {
  mapClip(trackId, clipId, (c) =>
    c.kind === 'midi' ? { ...c, notes: c.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)) } : c
  )
}

export function removeNote(trackId: string, clipId: string, noteId: string): void {
  mapClip(trackId, clipId, (c) => (c.kind === 'midi' ? { ...c, notes: c.notes.filter((n) => n.id !== noteId) } : c))
}

// ---------- persistence (project structure only; sample audio lives in IndexedDB) ----------

const LS_KEY = 'openstudio.project.v1'
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function autosave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state.project))
    } catch {
      /* storage full or unavailable — non-fatal */
    }
  }, 800)
}

export function loadAutosaved(): Project | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Project
  } catch {
    return null
  }
}

export function replaceProject(p: Project): void {
  setState((s) => ({
    project: p,
    ui: { ...s.ui, selectedTrackId: p.tracks[0]?.id ?? null, selectedClipId: null },
  }))
}

export function newProject(): void {
  beginGesture()
  replaceProject(demoProject())
}

// autosave on every project change
subscribe(() => autosave())
