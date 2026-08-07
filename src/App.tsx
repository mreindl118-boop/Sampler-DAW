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
import { HelpModal, Welcome } from './ui/Welcome'
import { Tour } from './ui/Tour'
import { Toasts } from './ui/Toasts'
import { engine } from './audio/engine'
import { initMidi } from './midi/midi'
import { exportProjectFile } from './util/projectio'
import {
  copyClip, duplicateClip, findClip, getState, pasteClip, redo, removeClip, setUI, splitClip, undo, useStore,
} from './state/store'
import { toast } from './state/toasts'
import { Ic, type IconName } from './ui/icons'
import type { BottomTab } from './state/types'

const TABS: { id: BottomTab; label: string; icon: IconName }[] = [
  { id: 'keys', label: 'Keys', icon: 'keys' },
  { id: 'piano', label: 'Piano Roll', icon: 'roll' },
  { id: 'steps', label: 'Steps', icon: 'steps' },
  { id: 'chords', label: 'Chords', icon: 'chords' },
  { id: 'instrument', label: 'Instrument', icon: 'inst' },
  { id: 'mixer', label: 'Mixer', icon: 'mixer' },
]

export default function App() {
  const tab = useStore((s) => s.ui.bottomTab)
  const selTrack = useStore((s) => s.project.tracks.find((t) => t.id === s.ui.selectedTrackId) ?? null)
  const selClipName = useStore((s) => {
    for (const t of s.project.tracks) {
      const c = t.clips.find((cl) => cl.id === s.ui.selectedClipId)
      if (c) return c.name
    }
    return null
  })

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
                <Ic n={t.icon} size={13} />
                {t.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            {selTrack && (
              <div className="context-chip" title="What the editor below is targeting — select tracks/clips in the timeline above">
                <span className="cc-dot" style={{ background: selTrack.color }} />
                <span>{selTrack.name}</span>
                {selClipName && <span className="cc-clip">▸ {selClipName}</span>}
              </div>
            )}
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
      <HelpModal />
      <Welcome />
      <Tour />
      <Toasts />
    </div>
  )
}
