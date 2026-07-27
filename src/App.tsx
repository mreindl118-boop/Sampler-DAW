import { useEffect } from 'react'
import { TransportBar } from './ui/TransportBar'
import { Arranger } from './ui/Arranger'
import { PianoRoll } from './ui/PianoRoll'
import { StepSequencer } from './ui/StepSequencer'
import { Mixer } from './ui/Mixer'
import { InstrumentEditor } from './ui/InstrumentEditor'
import { ChordPanel } from './ui/ChordPanel'
import { VirtualKeyboard } from './ui/VirtualKeyboard'
import { SettingsModal } from './ui/Settings'
import { Toasts } from './ui/Toasts'
import { engine } from './audio/engine'
import { initMidi } from './midi/midi'
import { exportProjectFile } from './util/projectio'
import {
  copyClip, duplicateClip, findClip, getState, pasteClip, redo, removeClip, setUI, splitClip, undo, useStore,
} from './state/store'
import { toast } from './state/toasts'
import type { BottomTab } from './state/types'

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'keys', label: '🎹 Keys' },
  { id: 'piano', label: '𝄞 Piano Roll' },
  { id: 'steps', label: '▦ Steps' },
  { id: 'chords', label: '♯ Chords' },
  { id: 'instrument', label: '⚡ Instrument' },
  { id: 'mixer', label: '🎚 Mixer' },
]

export default function App() {
  const tab = useStore((s) => s.ui.bottomTab)

  useEffect(() => {
    void initMidi()
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        engine.togglePlay()
      }
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if (mod && key === 's') {
        e.preventDefault()
        void exportProjectFile(getState().project)
        toast('Project saved to file (autosave also runs continuously)', 'info')
      }
      if (mod && key === 'e') {
        e.preventDefault()
        const f = findClip(getState().ui.selectedClipId)
        if (f && !splitClip(f.track.id, f.clip.id, engine.position(), getState().project.tempo)) {
          toast('Playhead is not inside the selected clip', 'warn')
        }
      }
      if (mod && key === 'd') {
        e.preventDefault()
        const f = findClip(getState().ui.selectedClipId)
        if (f) duplicateClip(f.track.id, f.clip.id)
      }
      if (mod && key === 'c') {
        if (copyClip(getState().ui.selectedClipId)) toast('Clip copied', 'info', 1500)
      }
      if (mod && key === 'v') {
        pasteClip(getState().ui.selectedTrackId, engine.position())
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
        const f = findClip(getState().ui.selectedClipId)
        if (f) {
          e.preventDefault()
          removeClip(f.track.id, f.clip.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TransportBar />
      <div className="main">
        <Arranger />
        <div className="bottom">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setUI({ bottomTab: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'keys' && <VirtualKeyboard />}
            {tab === 'piano' && <PianoRoll />}
            {tab === 'steps' && <StepSequencer />}
            {tab === 'chords' && <ChordPanel />}
            {tab === 'instrument' && <InstrumentEditor />}
            {tab === 'mixer' && <Mixer />}
          </div>
        </div>
      </div>
      <SettingsModal />
      <Toasts />
    </div>
  )
}
