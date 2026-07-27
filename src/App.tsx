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
import { engine } from './audio/engine'
import { initMidi } from './midi/midi'
import { redo, setUI, undo, useStore } from './state/store'
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
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
    </div>
  )
}
