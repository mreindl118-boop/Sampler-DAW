import { useState } from 'react'
import { engine } from '../audio/engine'
import { addTrack, getState, mapTrack, setUI, useStore } from '../state/store'
import { toast } from '../state/toasts'
import { createDrumClipHere } from './StepSequencer'
import { createMelodicClipHere } from './PianoRoll'
import { Ic } from './icons'

const WELCOME_KEY = 'openstudio.welcome.v1'

export function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === 'done'
  } catch {
    return true
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(WELCOME_KEY, 'done')
  } catch {
    /* ok */
  }
}

/** First-launch overlay: teaches the timeline/editor model and jump-starts a workflow. */
export function Welcome() {
  const [open, setOpen] = useState(() => !welcomeSeen())
  if (!open) return null

  const done = () => {
    markSeen()
    setOpen(false)
  }

  const recordSetup = () => {
    let track = getState().project.tracks.find((t) => t.kind === 'audio')
    if (!track) track = addTrack('audio')
    mapTrack(track.id, (t) => ({ ...t, armed: true }))
    setUI({ selectedTrackId: track.id, bottomTab: 'mixer' })
    toast('Track armed. Pick your input device in ⚙ Settings if needed, then press the red ⏺ button.', 'info', 9000)
    done()
  }

  return (
    <div className="welcome-backdrop">
      <div className="welcome">
        <div className="welcome-head">
          <span className="logo-mark" />
          <div>
            <h2>Welcome to OpenStudio</h2>
            <p className="hint">
              Your song lives on the <b>timeline</b> up top. The panel below is the <b>editor</b> — it always shows
              the tools for whatever track or clip you've selected. Pick a starting point:
            </p>
          </div>
        </div>
        <div className="welcome-cards">
          <button className="welcome-card" onClick={() => { createDrumClipHere(); done() }}>
            <Ic n="steps" size={22} />
            <span className="wc-title">Make a beat</span>
            <span className="wc-sub">Tap cells in the step grid — kick, snare, hats</span>
          </button>
          <button className="welcome-card" onClick={() => { createMelodicClipHere(); done() }}>
            <Ic n="roll" size={22} />
            <span className="wc-title">Write a melody</span>
            <span className="wc-sub">Draw notes on the piano roll, scale-highlighted</span>
          </button>
          <button className="welcome-card" onClick={recordSetup}>
            <Ic n="record" size={22} />
            <span className="wc-title">Record audio</span>
            <span className="wc-sub">Guitar, vocals — any interface input</span>
          </button>
          <button className="welcome-card" onClick={() => { engine.togglePlay(); done() }}>
            <Ic n="play" size={22} />
            <span className="wc-title">Play the demo</span>
            <span className="wc-sub">Hear the starter project, then poke around</span>
          </button>
        </div>
        <div className="welcome-foot">
          <span className="hint">The ? button up top reopens this guide plus gestures & shortcuts, any time.</span>
          <button className="small" onClick={done}>Skip</button>
        </div>
      </div>
    </div>
  )
}

/** Cheat-sheet: workflow, gestures, shortcuts, hardware pointers. */
export function HelpModal() {
  const show = useStore((s) => s.ui.showHelp)
  if (!show) return null
  const close = () => setUI({ showHelp: false })
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, 94vw)' }}>
        <h3>How OpenStudio works</h3>

        <h4 style={{ marginBottom: 6 }}>The 3-step loop</h4>
        <ol className="help-list">
          <li><b>Add a track</b> (＋ Synth / Drums / Sampler / Audio above the timeline) — instrument tracks come with a starter clip.</li>
          <li><b>Fill the clip</b> — drums in <b>Steps</b>, melodies & chords in <b>Piano Roll</b> (the Chords tab can insert whole progressions).</li>
          <li><b>Balance and ship</b> — levels/pan/FX in <b>Mixer</b>, then <b>Export WAV</b>.</li>
        </ol>

        <h4 style={{ margin: '12px 0 6px' }}>Timeline gestures</h4>
        <ul className="help-list">
          <li>Double-click an empty lane → new clip · double-click a clip → open its editor</li>
          <li>Drag a clip to move · drag its left/right edge to trim · right-click to delete</li>
          <li>Drag along the ruler → set the loop region · click the ruler → move the playhead</li>
          <li>Drop an audio file on any lane to import it at that spot</li>
          <li>Piano roll: click to draw · Alt+drag ↕ on a note = velocity · right-click = delete</li>
          <li>A button on a track head → automation lane (click to add points, right-click to remove)</li>
        </ul>

        <h4 style={{ margin: '12px 0 6px' }}>Shortcuts</h4>
        <table className="help-keys">
          <tbody>
            <tr><td><kbd>Space</kbd></td><td>Play / pause</td><td><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd></td><td>Undo / redo</td></tr>
            <tr><td><kbd>Ctrl+E</kbd></td><td>Split clip at playhead</td><td><kbd>Ctrl+D</kbd></td><td>Duplicate clip</td></tr>
            <tr><td><kbd>Ctrl+C/V</kbd></td><td>Copy / paste clip</td><td><kbd>Delete</kbd></td><td>Delete selected clip</td></tr>
            <tr><td><kbd>Ctrl+S</kbd></td><td>Save project file</td><td><kbd>Z–M</kbd> / <kbd>Q–U</kbd></td><td>Play notes (remap in Keys tab)</td></tr>
          </tbody>
        </table>

        <h4 style={{ margin: '12px 0 6px' }}>Hardware</h4>
        <ul className="help-list">
          <li>⚙ Settings → Audio devices: pick your interface (XLR/¼″ inputs), measure latency</li>
          <li>⚙ Settings → MIDI: MPE for ROLI, footswitch MIDI-learn, clock & preset changes to outboard gear</li>
          <li>Mixer strips: input channel per audio track, 🎧 monitoring, hardware output routing</li>
        </ul>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  )
}
