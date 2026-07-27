import { useEffect, useRef } from 'react'
import { engine } from '../audio/engine'
import { DRUM_LANE_NAMES } from '../state/presets'
import {
  addNote, beginGesture, findClip, getState, removeNote, useStore,
} from '../state/store'

const STEP = 0.25 // 1/16th in beats

export function StepSequencer() {
  const selectedClipId = useStore((s) => s.ui.selectedClipId)
  useStore((s) => s.project)
  const found = findClip(selectedClipId)
  const colRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const f = findClip(getState().ui.selectedClipId)
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

  if (!found || found.clip.kind !== 'midi' || found.track.kind !== 'drums') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
        Select a clip on a Drums track (double-click a lane on a drum track to create one).
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
