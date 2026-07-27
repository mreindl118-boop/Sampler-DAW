import { useEffect, useRef } from 'react'
import { engine } from '../audio/engine'
import { scalePitchSet } from '../music/theory'
import { midiToName } from '../music/theory'
import {
  addNote, beginGesture, findClip, getState, quantizeClip, removeNote, updateNote, useStore,
} from '../state/store'

const LOW = 24 // C1
const HIGH = 108 // C8
const ROW_H = 16

export function PianoRoll() {
  const selectedClipId = useStore((s) => s.ui.selectedClipId)
  const snap = useStore((s) => s.ui.snap)
  const key = useStore((s) => s.project.key)
  const scale = useStore((s) => s.project.scale)
  // subscribe to project changes so note edits re-render
  useStore((s) => s.project)
  const found = findClip(selectedClipId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)

  const zoom = 48 // px per beat in the roll

  useEffect(() => {
    // center on C4 initially
    if (scrollRef.current) scrollRef.current.scrollTop = (HIGH - 72) * ROW_H
  }, [selectedClipId])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const f = findClip(getState().ui.selectedClipId)
      if (playheadRef.current && f) {
        const rel = engine.position() - f.clip.start
        playheadRef.current.style.display = rel >= 0 && rel <= f.clip.length ? 'block' : 'none'
        playheadRef.current.style.transform = `translateX(${rel * zoom}px)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (!found || found.clip.kind !== 'midi') {
    return <Empty message="Select or double-click a MIDI clip in the arranger to edit notes." />
  }
  if (found.track.kind === 'drums') {
    return <Empty message="This is a drum clip — use the Steps tab for the step sequencer." />
  }
  const { track, clip } = found
  const rows = HIGH - LOW
  const inScale = scalePitchSet(key, scale)
  const gridW = clip.length * zoom

  const posFromEvent = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const beat = (e.clientX - rect.left) / zoom
    const pitch = HIGH - 1 - Math.floor((e.clientY - rect.top) / ROW_H)
    return { beat, pitch }
  }

  const onGridPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.pr-note')) return
    const el = e.currentTarget as HTMLElement
    const { beat, pitch } = posFromEvent(e, el)
    if (beat < 0 || beat >= clip.length || pitch < LOW || pitch >= HIGH) return
    beginGesture()
    const start = Math.floor(beat / snap) * snap
    const note = addNote(track.id, clip.id, { pitch, start, dur: snap, vel: 0.85 })
    engine.ensure()
    engine.liveNoteOn(pitch, 0.7)
    setTimeout(() => engine.liveNoteOff(pitch), 200)
    // drag right to extend the new note
    const move = (ev: PointerEvent) => {
      const p = posFromEvent(ev, el)
      const dur = Math.max(snap, Math.ceil((p.beat - start) / snap) * snap)
      updateNote(track.id, clip.id, note.id, { dur })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="piano-roll" style={{ flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, padding: '4px 8px', alignItems: 'center', background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
        <span className="section-title">{track.name} — {clip.name}</span>
        <button className="small" onClick={() => quantizeClip(track.id, clip.id, snap)} title="Snap all note starts to the grid">
          Quantize {snap === 1 ? '1 beat' : `1/${Math.round(4 / snap) * 4}`}
        </button>
        <span className="hint">Draw: click · Move/resize: drag · Velocity: Alt+drag ↕ · Delete: right-click</span>
      </div>
      <div style={{ overflow: 'auto', display: 'flex', flex: 1 }} ref={scrollRef}>
        <div className="pr-keys">
          {Array.from({ length: rows }, (_, i) => {
            const pitch = HIGH - 1 - i
            const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12)
            return (
              <div
                key={pitch}
                className={`pr-key ${isBlack ? 'black' : 'white'} ${pitch % 12 === 0 ? 'c-note' : ''}`}
                onPointerDown={() => {
                  engine.ensure()
                  engine.liveNoteOn(pitch, 0.8)
                }}
                onPointerUp={() => engine.liveNoteOff(pitch)}
                onPointerLeave={() => engine.liveNoteOff(pitch)}
              >
                {pitch % 12 === 0 ? midiToName(pitch) : ''}
              </div>
            )
          })}
        </div>
        <div className="pr-grid" style={{ width: gridW, minWidth: gridW }} onPointerDown={onGridPointerDown}>
          {Array.from({ length: rows }, (_, i) => {
            const pitch = HIGH - 1 - i
            const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12)
            const scaleRow = inScale.has(pitch % 12)
            return <div key={pitch} className={`pr-row ${isBlack ? 'black' : ''} ${scaleRow && !isBlack ? 'in-scale' : ''}`} />
          })}
          {/* beat gridlines */}
          {Array.from({ length: Math.ceil(clip.length) + 1 }, (_, b) => (
            <div
              key={b}
              style={{
                position: 'absolute', top: 0, bottom: 0, left: b * zoom, width: 1,
                background: b % 4 === 0 ? '#333a4d' : '#232838', pointerEvents: 'none',
              }}
            />
          ))}
          {clip.notes.map((n) => (
            <NoteView key={n.id} trackId={track.id} clipId={clip.id} note={n} zoom={zoom} snap={snap} clipLen={clip.length} />
          ))}
          <div ref={playheadRef} className="pr-playhead" />
        </div>
      </div>
    </div>
  )
}

function NoteView({
  trackId, clipId, note, zoom, snap, clipLen,
}: {
  trackId: string
  clipId: string
  note: { id: string; pitch: number; start: number; dur: number; vel: number }
  zoom: number
  snap: number
  clipLen: number
}) {
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    const target = e.target as HTMLElement
    const resizing = target.classList.contains('resize')
    const velocityMode = e.altKey
    const startX = e.clientX
    const startY = e.clientY
    const orig = { ...note }
    beginGesture()
    const move = (ev: PointerEvent) => {
      const dBeat = (ev.clientX - startX) / zoom
      const dPitch = Math.round((startY - ev.clientY) / ROW_H)
      if (velocityMode) {
        const vel = Math.min(1, Math.max(0.05, orig.vel + (startY - ev.clientY) / 150))
        updateNote(trackId, clipId, note.id, { vel })
      } else if (resizing) {
        const dur = Math.max(snap, Math.round((orig.dur + dBeat) / snap) * snap)
        updateNote(trackId, clipId, note.id, { dur })
      } else {
        const start = Math.min(clipLen - snap, Math.max(0, Math.round((orig.start + dBeat) / snap) * snap))
        const pitch = Math.min(HIGH - 1, Math.max(LOW, orig.pitch + dPitch))
        updateNote(trackId, clipId, note.id, { start, pitch })
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className="pr-note"
      style={{
        left: note.start * zoom,
        width: Math.max(6, note.dur * zoom - 1),
        top: (HIGH - 1 - note.pitch) * ROW_H,
        opacity: 0.55 + note.vel * 0.45,
      }}
      title={`${midiToName(note.pitch)} vel ${Math.round(note.vel * 127)}`}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        beginGesture()
        removeNote(trackId, clipId, note.id)
      }}
    >
      <div className="resize" />
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
      {message}
    </div>
  )
}
