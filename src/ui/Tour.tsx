import { useEffect, useState } from 'react'
import { setUI, useStore } from '../state/store'
import type { BottomTab } from '../state/types'

interface TourStep {
  target: string // CSS selector to spotlight
  title: string
  body: string
  tab?: BottomTab // switch the bottom editor before showing
}

const STEPS: TourStep[] = [
  {
    target: '.transport',
    title: 'Transport',
    body: 'Play/pause (or Space), stop, and the red record button. The amber displays show position and BPM — type a new tempo any time. The loop and metronome toggles live here too, and the meter on the left shows your master level.',
  },
  {
    target: '.arranger',
    title: 'The timeline',
    body: 'Your song, one row per track. Double-tap an empty lane to create a clip; drag a clip to move it, drag its edges to trim. Long-press (or right-click) a clip to delete it. Drop audio files straight onto a lane.',
  },
  {
    target: '.ruler',
    title: 'Ruler & loop',
    body: 'Tap to move the playhead. Sweep across empty ruler to set a loop region — then drag the amber bar to move it, or its edges to resize. Everything snaps to beats.',
  },
  {
    target: '.track-heads',
    title: 'Track controls',
    body: 'M mutes, S solos, ● arms for recording, A opens the automation lane (draw volume/pan curves). Double-tap the name to rename, arrows reorder. The + buttons above add tracks — with a starter clip ready to edit.',
  },
  {
    target: '.tabs',
    title: 'The editor deck',
    body: 'The bottom panel is contextual: it edits whatever you selected up top. The chip on the right always names the target. Drum tracks open in Steps, melodies in Piano Roll.',
  },
  {
    target: '.tab-body',
    title: 'Steps — beats',
    tab: 'steps',
    body: 'One row per drum, one cell per 16th note. Tap cells to program; tap a lane name to hear it. The numbers on top count bars. Tune, decay and level per drum live in the Instrument tab.',
  },
  {
    target: '.tab-body',
    title: 'Piano Roll — melodies',
    tab: 'piano',
    body: 'Tap to draw notes, drag to move, drag the right edge to stretch. Long-press (or right-click) deletes. Rows tinted blue are in your key. Quantize snaps a sloppy take to the grid. On touch, flip Draw ↔ Pan to scroll.',
  },
  {
    target: '.tab-body',
    title: 'Chords — instant harmony',
    tab: 'chords',
    body: 'Pick a key and scale, then tap pads to hear every chord that fits. Long-press a pad to insert it into your clip. The progression buttons audition classic patterns in your key.',
  },
  {
    target: '.tab-body',
    title: 'Mixer — balance & FX',
    tab: 'mixer',
    body: 'Faders with live meters, pan, mute/solo per strip. Add effects from the + FX menu (reverb, delay, EQ, compressor…) and tap a chip to tweak it. Audio strips choose their input channel and monitoring here.',
  },
  {
    target: '.tab-body',
    title: 'Keys — play & record',
    tab: 'keys',
    body: 'A multi-touch keyboard — velocity follows where you strike the key. Map keys lets you rebind your computer keyboard. Arm a track, hit ⏺, and whatever you play here is recorded into a clip.',
  },
  {
    target: '.transport',
    title: "That's the loop",
    body: 'Make clips → fill them → mix → Export WAV. The ? button reopens the cheat-sheet, and ⚙ holds audio devices, MIDI, ROLI/MPE and re-amping. Now make something!',
  },
]

export function Tour() {
  const step = useStore((s) => s.ui.tourStep)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const current = step !== null ? STEPS[step] : null

  useEffect(() => {
    if (!current) return
    if (current.tab) setUI({ bottomTab: current.tab })
    let raf = 0
    const measure = () => {
      const el = document.querySelector(current.target)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    // allow the tab switch to render first
    const t = setTimeout(() => {
      measure()
      raf = requestAnimationFrame(measure)
    }, 60)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(t)
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  if (step === null || !current) return null

  const done = () => setUI({ tourStep: null })
  const cardW = Math.min(360, window.innerWidth - 24)
  const cardH = 190
  let top = 0
  let left = 12
  if (rect) {
    top = rect.bottom + cardH + 16 < window.innerHeight ? rect.bottom + 12 : Math.max(12, rect.top - cardH - 12)
    left = Math.min(Math.max(12, rect.left), window.innerWidth - cardW - 12)
  } else {
    top = window.innerHeight / 2 - cardH / 2
    left = window.innerWidth / 2 - cardW / 2
  }

  return (
    <div className="tour-layer">
      {rect && (
        <div
          className="tour-spot"
          style={{ left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10 }}
        />
      )}
      <div className="tour-card" style={{ top, left, width: cardW }}>
        <div className="tour-step-num">{step + 1} / {STEPS.length}</div>
        <h4>{current.title}</h4>
        <p>{current.body}</p>
        <div className="tour-nav">
          <button className="small" onClick={done}>Skip tour</button>
          <div style={{ flex: 1 }} />
          {step > 0 && <button className="small" onClick={() => setUI({ tourStep: step - 1 })}>‹ Back</button>}
          {step < STEPS.length - 1 ? (
            <button className="small active" onClick={() => setUI({ tourStep: step + 1 })}>Next ›</button>
          ) : (
            <button className="small active" onClick={done}>Finish</button>
          )}
        </div>
      </div>
    </div>
  )
}
