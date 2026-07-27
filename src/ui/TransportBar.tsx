import { useEffect, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { exportWav } from '../audio/exporter'
import { exportProjectFile, importProjectFile } from '../util/projectio'
import { getState, newProject, redo, setProject, setUI, undo, useStore } from '../state/store'

function MasterMeter() {
  const [level, setLevel] = useState(0)
  const peakRef = useRef(0)
  const clipRef = useRef(0)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const p = engine.meterPeak(null)
      peakRef.current = p > peakRef.current ? p : peakRef.current * 0.92
      if (p >= 0.99) clipRef.current = performance.now()
      setLevel(peakRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  const clip = performance.now() - clipRef.current < 1500
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Master peak meter">
      <div style={{ width: 90, height: 10, background: '#0a0b0e', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div
          style={{
            width: `${Math.min(1, level) * 100}%`, height: '100%',
            background: 'linear-gradient(to right, #57d9a3 0%, #57d9a3 65%, #f7b32f 85%, #f75f5f 100%)',
          }}
        />
      </div>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: clip ? 'var(--red)' : '#222630' }} title={clip ? 'Clipping!' : 'No clip'} />
    </div>
  )
}

export function TransportBar() {
  const tempo = useStore((s) => s.project.tempo)
  const timeSig = useStore((s) => s.project.timeSig)
  const loopOn = useStore((s) => s.project.loop.on)
  const recording = useStore((s) => s.ui.recording)
  const name = useStore((s) => s.project.name)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState('1.1.00')
  const [metronome, setMetronome] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setPlaying(engine.isPlaying())
      const beat = engine.position()
      const [num] = getState().project.timeSig
      const bar = Math.floor(beat / num) + 1
      const b = Math.floor(beat % num) + 1
      const sub = Math.floor((beat % 1) * 100)
      setPos(`${bar}.${b}.${sub.toString().padStart(2, '0')}`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="transport">
      <span className="logo">◉ OpenStudio</span>
      <button onClick={() => { engine.ensure(); engine.setPosition(0) }} title="Return to zero">⏮</button>
      <button className={playing ? 'active' : ''} onClick={() => engine.togglePlay()} title="Play/Pause (Space)">
        {playing ? '⏸' : '▶'}
      </button>
      <button onClick={() => engine.stopReturn()} title="Stop (return to play start; press again for zero)">⏹</button>
      <button
        className={recording ? 'rec-active' : ''}
        onClick={() => (recording ? void engine.stopRecord() : void engine.record())}
        title="Record (arm a track first)"
      >
        ⏺
      </button>
      <span className="time">{pos}</span>
      <MasterMeter />
      <div className="tempo-box">
        <input
          type="number"
          min={30}
          max={300}
          value={tempo}
          onChange={(e) => setProject((p) => ({ ...p, tempo: Math.min(300, Math.max(30, Number(e.target.value) || 120)) }))}
        />
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>BPM</span>
      </div>
      <select
        value={`${timeSig[0]}/${timeSig[1]}`}
        onChange={(e) => {
          const [a, b] = e.target.value.split('/').map(Number)
          setProject((p) => ({ ...p, timeSig: [a, b] }))
        }}
      >
        {['4/4', '3/4', '6/8', '5/4', '7/8'].map((ts) => (
          <option key={ts}>{ts}</option>
        ))}
      </select>
      <button
        className={loopOn ? 'active' : ''}
        onClick={() => setProject((p) => ({ ...p, loop: { ...p.loop, on: !p.loop.on } }))}
        title="Loop"
      >
        🔁
      </button>
      <button
        className={metronome ? 'active' : ''}
        onClick={() => {
          engine.metronome = !metronome
          setMetronome(!metronome)
        }}
        title="Metronome"
      >
        🎵
      </button>
      <button className="small" onClick={() => undo()} title="Undo (Ctrl+Z)">↩</button>
      <button className="small" onClick={() => redo()} title="Redo (Ctrl+Shift+Z)">↪</button>
      <div className="grow" />
      <input
        type="text"
        value={name}
        style={{ width: 130 }}
        onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
        title="Project name"
      />
      <button onClick={() => newProject()}>New</button>
      <button onClick={() => void exportProjectFile(getState().project)}>Save</button>
      <button onClick={() => fileRef.current?.click()}>Open</button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importProjectFile(f).catch((err) => alert(`Import failed: ${err}`))
          e.target.value = ''
        }}
      />
      <button
        disabled={exporting}
        onClick={async () => {
          setExporting(true)
          try {
            engine.ensure()
            await exportWav(getState().project)
          } finally {
            setExporting(false)
          }
        }}
      >
        {exporting ? 'Rendering…' : 'Export WAV'}
      </button>
      <button onClick={() => setUI({ showSettings: true })} title="Settings">⚙</button>
    </div>
  )
}
