import { useSyncExternalStore } from 'react'
import type { AppState, AutomationLane, Clip, Marker, MidiClip, Note, Project, Track, TrackKind, UIState } from './types'
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
    master: { volume: 0.9, fx: [], outputPair: 0 },
    markers: [],
    io: { inputLabel: '', outputLabel: '' },
  }
}

/** Fill defaults on projects saved by older versions (or hand-edited files). */
export function normalizeProject(p: Project): Project {
  const proj = { ...p }
  const m = (p.master ?? {}) as Partial<Project['master']>
  proj.master = { volume: m.volume ?? 0.9, fx: m.fx ?? [], outputPair: m.outputPair ?? 0 }
  proj.markers = Array.isArray(p.markers) ? p.markers : []
  proj.io = p.io ?? { inputLabel: '', outputLabel: '' }
  proj.samples = Array.isArray(p.samples) ? p.samples : []
  proj.tracks = (p.tracks ?? []).map((raw) => {
    const t = raw as Partial<Track> & Track
    return {
      ...t,
      inputChannels: t.inputChannels ?? [0, 1],
      monitor: t.monitor ?? false,
      outputPair: t.outputPair ?? -1,
      midiOutId: t.midiOutId ?? '',
      midiOutChannel: t.midiOutChannel ?? 0,
      automation: t.automation ?? [],
      showAutomation: t.showAutomation ?? false,
      fx: t.fx ?? [],
      clips: (t.clips ?? []).map((raw2) => {
        if (raw2.kind !== 'audio') return raw2
        const c = raw2 as Partial<Clip> & typeof raw2
        return { ...c, fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0, gain: c.gain ?? 1 }
      }),
    }
  })
  return proj
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
    inputChannels: [0, 1],
    monitor: false,
    outputPair: -1,
    midiOutId: '',
    midiOutChannel: 0,
    automation: [],
    showAutomation: false,
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
      snapOn: true,
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

function writeAutosave(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.project))
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

export function autosave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(writeAutosave, 800)
}

/** Write immediately — used on unload so the debounce window can't drop edits. */
export function flushAutosave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  writeAutosave()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushAutosave)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutosave()
  })
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
  const proj = normalizeProject(p)
  setState((s) => ({
    project: proj,
    ui: { ...s.ui, selectedTrackId: proj.tracks[0]?.id ?? null, selectedClipId: null },
  }))
}

// ---------- track management ----------

export function renameTrack(trackId: string, name: string): void {
  mapTrack(trackId, (t) => ({ ...t, name }))
}

export function moveTrack(trackId: string, dir: -1 | 1): void {
  beginGesture()
  setProject((p) => {
    const idx = p.tracks.findIndex((t) => t.id === trackId)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= p.tracks.length) return p
    const tracks = [...p.tracks]
    const [t] = tracks.splice(idx, 1)
    tracks.splice(to, 0, t)
    return { ...p, tracks }
  })
}

// ---------- clip operations ----------

function cloneClip(c: Clip, shiftBeats = 0): Clip {
  if (c.kind === 'midi') {
    return { ...c, id: uid('clip'), start: c.start + shiftBeats, notes: c.notes.map((n) => ({ ...n, id: uid('n') })) }
  }
  return { ...c, id: uid('clip'), start: c.start + shiftBeats }
}

/** Split the clip at an absolute timeline beat. Returns true if a split happened. */
export function splitClip(trackId: string, clipId: string, atBeat: number, tempo: number): boolean {
  const found = findClip(clipId)
  if (!found) return false
  const { clip } = found
  const rel = atBeat - clip.start
  if (rel <= 0.01 || rel >= clip.length - 0.01) return false
  beginGesture()
  if (clip.kind === 'midi') {
    const left: MidiClip = {
      ...clip,
      length: rel,
      notes: clip.notes.filter((n) => n.start < rel).map((n) => ({ ...n, dur: Math.min(n.dur, rel - n.start) })),
    }
    const right: MidiClip = {
      ...clip,
      id: uid('clip'),
      start: clip.start + rel,
      length: clip.length - rel,
      notes: clip.notes
        .filter((n) => n.start + n.dur > rel)
        .map((n) => {
          const s = Math.max(0, n.start - rel)
          const clippedStart = Math.max(n.start, rel)
          return { ...n, id: uid('n'), start: s, dur: n.dur - (clippedStart - n.start) }
        }),
    }
    mapTrack(trackId, (t) => ({ ...t, clips: [...t.clips.filter((c) => c.id !== clipId), left, right] }))
  } else {
    const spb = 60 / tempo
    const left = { ...clip, length: rel, fadeOut: 0 }
    const right = {
      ...clip,
      id: uid('clip'),
      start: clip.start + rel,
      length: clip.length - rel,
      offset: clip.offset + rel * spb,
      fadeIn: 0,
    }
    mapTrack(trackId, (t) => ({ ...t, clips: [...t.clips.filter((c) => c.id !== clipId), left, right] }))
  }
  return true
}

export function duplicateClip(trackId: string, clipId: string): void {
  const found = findClip(clipId)
  if (!found) return
  beginGesture()
  const copy = cloneClip(found.clip, found.clip.length)
  mapTrack(trackId, (t) => ({ ...t, clips: [...t.clips, copy] }))
  setUI({ selectedClipId: copy.id })
}

let clipboard: Clip | null = null

export function copyClip(clipId: string | null): boolean {
  const found = findClip(clipId)
  if (!found) return false
  clipboard = found.clip
  return true
}

/** Paste at a beat position on the target (or original-kind-compatible selected) track. */
export function pasteClip(targetTrackId: string | null, atBeat: number): void {
  if (!clipboard) return
  const src = clipboard
  const target =
    state.project.tracks.find((t) => t.id === targetTrackId) ??
    state.project.tracks.find((t) => t.id === state.ui.selectedTrackId)
  if (!target) return
  const compatible = src.kind === 'audio' ? target.kind === 'audio' : target.kind !== 'audio'
  if (!compatible) return
  beginGesture()
  const copy = cloneClip(src, 0)
  copy.start = Math.max(0, atBeat)
  mapTrack(target.id, (t) => ({ ...t, clips: [...t.clips, copy] }))
  setUI({ selectedClipId: copy.id, selectedTrackId: target.id })
}

/** Quantize note starts in a MIDI clip to a grid (beats). */
export function quantizeClip(trackId: string, clipId: string, grid: number): void {
  beginGesture()
  mapClip(trackId, clipId, (c) =>
    c.kind === 'midi'
      ? {
          ...c,
          notes: c.notes.map((n) => ({ ...n, start: Math.max(0, Math.round(n.start / grid) * grid) })),
        }
      : c
  )
}

// ---------- markers ----------

export function addMarker(beat: number): Marker {
  const m: Marker = { id: uid('mk'), beat, name: `Marker ${state.project.markers.length + 1}`, pc: null, ccs: [] }
  beginGesture()
  setProject((p) => ({ ...p, markers: [...p.markers, m].sort((a, b) => a.beat - b.beat) }))
  return m
}

export function updateMarker(id: string, patch: Partial<Marker>): void {
  setProject((p) => ({
    ...p,
    markers: p.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.beat - b.beat),
  }))
}

export function removeMarker(id: string): void {
  beginGesture()
  setProject((p) => ({ ...p, markers: p.markers.filter((m) => m.id !== id) }))
}

// ---------- automation ----------

export function getOrCreateLane(trackId: string, param: AutomationLane['param']): void {
  const track = state.project.tracks.find((t) => t.id === trackId)
  if (!track) return
  if (!track.automation.some((l) => l.param === param)) {
    mapTrack(trackId, (t) => ({
      ...t,
      automation: [...t.automation, { id: uid('lane'), param, points: [], enabled: true }],
    }))
  }
}

export function addAutomationPoint(trackId: string, laneId: string, beat: number, value: number): string {
  const pid = uid('ap')
  mapTrack(trackId, (t) => ({
    ...t,
    automation: t.automation.map((l) =>
      l.id === laneId
        ? { ...l, points: [...l.points, { id: pid, beat, value }].sort((a, b) => a.beat - b.beat) }
        : l
    ),
  }))
  return pid
}

export function updateAutomationPoint(trackId: string, laneId: string, pointId: string, beat: number, value: number): void {
  mapTrack(trackId, (t) => ({
    ...t,
    automation: t.automation.map((l) =>
      l.id === laneId
        ? {
            ...l,
            points: l.points
              .map((pt) => (pt.id === pointId ? { ...pt, beat: Math.max(0, beat), value } : pt))
              .sort((a, b) => a.beat - b.beat),
          }
        : l
    ),
  }))
}

export function removeAutomationPoint(trackId: string, laneId: string, pointId: string): void {
  mapTrack(trackId, (t) => ({
    ...t,
    automation: t.automation.map((l) => (l.id === laneId ? { ...l, points: l.points.filter((pt) => pt.id !== pointId) } : l)),
  }))
}

export function newProject(): void {
  beginGesture()
  replaceProject(demoProject())
}

// autosave on every project change
subscribe(() => autosave())
