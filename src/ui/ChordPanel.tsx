import { useState } from 'react'
import { engine } from '../audio/engine'
import {
  CHORD_TYPES, NOTE_NAMES, PROGRESSIONS, SCALES, chordNotes, diatonicChords,
} from '../music/theory'
import { addMidiClip, beginGesture, findClip, getState, mapClip, setProject, useStore } from '../state/store'
import { uid } from '../state/presets'

export function ChordPanel() {
  const key = useStore((s) => s.project.key)
  const scale = useStore((s) => s.project.scale)
  const [octave, setOctave] = useState(4)
  const [chordRoot, setChordRoot] = useState(0)
  const [insertBeats, setInsertBeats] = useState(4)

  const diatonic = diatonicChords(key, scale)
  const rootMidi = (pc: number) => 12 * (octave + 1) + pc

  const insertChord = (pitches: number[]) => {
    const { ui } = getState()
    let found = findClip(ui.selectedClipId)
    if (!found || found.clip.kind !== 'midi' || found.track.kind === 'drums') {
      // create a clip on the first synth-ish track at the playhead
      const target = getState().project.tracks.find((t) => t.kind === 'synth' || t.kind === 'sampler')
      if (!target) return
      const start = Math.floor(engine.position())
      addMidiClip(target.id, start, Math.max(4, insertBeats))
      found = findClip(getState().ui.selectedClipId)
    }
    if (!found || found.clip.kind !== 'midi') return
    const { track, clip } = found
    // append after the last note in the clip
    const lastEnd = clip.notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0)
    const start = Math.min(lastEnd, clip.length)
    beginGesture()
    mapClip(track.id, clip.id, (c) =>
      c.kind === 'midi'
        ? {
            ...c,
            length: Math.max(c.length, start + insertBeats),
            notes: [
              ...c.notes,
              ...pitches.map((p) => ({ id: uid('n'), pitch: p, start, dur: insertBeats, vel: 0.8 })),
            ],
          }
        : c
    )
  }

  /** Tap = play; right-click or touch long-press = insert into the clip. */
  const padHandlers = (pitches: number[]) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button === 2) return
      engine.playChord(pitches)
      if (e.pointerType !== 'mouse') {
        const t = setTimeout(() => insertChord(pitches), 600)
        const clear = () => {
          clearTimeout(t)
          window.removeEventListener('pointerup', clear)
          window.removeEventListener('pointercancel', clear)
        }
        window.addEventListener('pointerup', clear)
        window.addEventListener('pointercancel', clear)
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      insertChord(pitches)
    },
  })

  const playProgression = (degrees: number[]) => {
    engine.ensure()
    const spb = 60 / getState().project.tempo
    degrees.forEach((deg, i) => {
      const chord = diatonic[deg % diatonic.length]
      if (!chord) return
      setTimeout(() => {
        engine.playChord(chordNotes(rootMidi(chord.rootMidi % 12), chord.intervals), 0.75, spb * 1.9)
      }, i * spb * 2 * 1000)
    })
  }

  return (
    <div className="chords">
      <div className="chord-row">
        <span className="section-title">Key</span>
        <select value={key} onChange={(e) => setProject((p) => ({ ...p, key: Number(e.target.value) }))}>
          {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        <select value={scale} onChange={(e) => setProject((p) => ({ ...p, scale: e.target.value }))}>
          {SCALES.map((s) => <option key={s.name}>{s.name}</option>)}
        </select>
        <span className="section-title">Octave</span>
        <button className="small" onClick={() => setOctave(Math.max(1, octave - 1))}>−</button>
        <span>{octave}</span>
        <button className="small" onClick={() => setOctave(Math.min(7, octave + 1))}>+</button>
        <span className="section-title">Insert length</span>
        <select value={insertBeats} onChange={(e) => setInsertBeats(Number(e.target.value))}>
          <option value={1}>1 beat</option>
          <option value={2}>2 beats</option>
          <option value={4}>1 bar</option>
          <option value={8}>2 bars</option>
        </select>
      </div>

      <span className="section-title">Diatonic chords in {NOTE_NAMES[key]} {scale} — tap to play · long-press or right-click to insert into clip</span>
      <div className="chord-row">
        {diatonic.map((c) => (
          <div key={c.degree} className="chord-pad" {...padHandlers(chordNotes(rootMidi(c.rootMidi % 12), c.intervals))}>
            <div className="roman">{c.roman}</div>
            <div className="sym">{c.symbol}</div>
          </div>
        ))}
        {diatonic.length === 0 && <span className="hint">Pentatonic/blues scales don’t stack tertian chords — switch scale for diatonic pads.</span>}
      </div>

      <span className="section-title">Chord explorer — any root, any quality</span>
      <div className="chord-row">
        <select value={chordRoot} onChange={(e) => setChordRoot(Number(e.target.value))}>
          {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        {CHORD_TYPES.map((ct) => (
          <div
            key={ct.symbol || 'maj'}
            className="chord-pad"
            style={{ minWidth: 56, padding: '6px 6px' }}
            {...padHandlers(chordNotes(rootMidi(chordRoot), ct.intervals))}
            title={ct.name}
          >
            <div className="sym" style={{ fontSize: 12 }}>{NOTE_NAMES[chordRoot]}{ct.symbol}</div>
          </div>
        ))}
      </div>

      <span className="section-title">Progressions — tap to audition in the current key</span>
      <div className="chord-row">
        {PROGRESSIONS.map((prog) => (
          <button key={prog.name} onClick={() => playProgression(prog.degrees)}>
            {prog.name}
          </button>
        ))}
      </div>
      <div className="hint">
        Chords play through the selected (or armed) instrument track. Inserting appends the chord after the last note in the
        selected MIDI clip — chain inserts to build a progression, then refine it in the piano roll.
      </div>
    </div>
  )
}
