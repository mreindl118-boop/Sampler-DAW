import { useEffect, useRef } from 'react'
import type { MidiClip, Track } from '../state/types'
import { engine } from '../audio/engine'
import { DRUM_LANE_NAMES } from '../state/presets'
import {
  addMidiClip, addNote, addTrack, beginGesture, findClip, findTrack, getState, removeNote, setUI, useStore,
} from '../state/store'

const STEP = 0.25 // 1/16th in beats

/** Resolve the clip to edit: the selected drum clip, or the first clip on a drum track. */
function resolveDrumClip(): { track: Track; clip: MidiClip } | null {
  const { ui } = getState()
  const found = findClip(ui.selectedClipId)
  if (found && found.clip.kind === 'midi' && found.track.kind === 'drums') {
    return { track: found.track, clip: found.clip }
  }
  const selTrack = findTrack(ui.selectedTrackId)
  const track = selTrack?.kind === 'drums' ? selTrack : getState().project.tracks.find((t) => t.kind === 'drums')
  const clip = track?.clips.find((c): c is MidiClip => c.kind === 'midi')
  return track && clip ? { track, clip } : null
}

export function createDrumClipHere(): void {
  let track = getState().project.tracks.find((t) => t.kind === 'drums')
  if (!track) track = addTrack('drums')
  const clip = addMidiClip(track.id, Math.floor(engine.position()), 4)
  setUI({ selectedTrackId: track.id, selectedClipId: clip.id, bottomTab: 'steps' })
}

export function StepSequencer() {
  useStore((s) => s.ui.selectedClipId)
  useStore((s) => s.ui.selectedTrackId)
  useStore((s) => s.project)
  const found = resolveDrumClip()
  const colRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const f = resolveDrumClip()
      if (colRef.current && f && engine.isPlaying()) {
        const rel = engine.position() - f.clip.start
        const step = Math.floor(rel / STEP)
        colRef.current.querySelectorAll('.step-cell').forEach((el) => {
          const s = Number((el as HTMLElement).dataset.step)
          el.classList.toggle('playing-col', s === step)
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (!found) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
        <span>No drum clip yet — beats are programmed here, one cell per 16th note.</span>
        <button onClick={() => createDrumClipHere()}>＋ Create a drum clip at the playhead</button>
        <span className="hint">You can also double-click any empty spot on a Drums lane in the arranger.</span>
      </div>
    )
  }
  const { track, clip } = found
  const steps = Math.max(16, Math.round(clip.length / STEP))
  const lanes = track.drums?.lanes ?? []

  const toggle = (lane: number, step: number) => {
    const start = step * STEP
    const existing = clip.notes.find((n) => n.pitch === lane && Math.abs(n.start - start) < STEP / 2)
    beginGesture()
    if (existing) {
      removeNote(track.id, clip.id, existing.id)
    } else {
      addNote(track.id, clip.id, { pitch: lane, start, dur: STEP, vel: 0.9 })
      engine.ensure()
      engine.liveNoteOn(lane, 0.9)
    }
  }

  return (
    <div className="steps scroll-x" ref={colRef}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className="section-title">{track.name} — {clip.name}</span>
        <span className="hint">Tap cells to program · lane names preview the sound</span>
      </div>
      {lanes.map((lane, li) => (
        <div className="step-row" key={li}>
          <span
            className="lane-name"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              engine.ensure()
              engine.liveNoteOn(li, 0.9)
            }}
          >
            {lane.name || DRUM_LANE_NAMES[li]}
          </span>
          {Array.from({ length: steps }, (_, si) => {
            const on = clip.notes.some((n) => n.pitch === li && Math.abs(n.start - si * STEP) < STEP / 2)
            return (
              <div
                key={si}
                data-step={si}
                className={`step-cell ${on ? 'on' : ''} ${si % 4 === 0 ? 'beat-start' : ''}`}
                onPointerDown={() => toggle(li, si)}
              />
            )
          })}
        </div>
      ))}
      <div className="hint" style={{ marginTop: 8 }}>
        Tap cells to program the beat. Lane names preview the sound. Tune, decay and level per lane are in the Instrument tab.
      </div>
    </div>
  )
}
