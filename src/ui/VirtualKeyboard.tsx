import { useEffect, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { NOTE_NAMES } from '../music/theory'
import { setUI, useStore } from '../state/store'
import { DEFAULT_KEY_MAP, getSettings, updateSettings, useSettings } from '../state/settings'
import { toast } from '../state/toasts'

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]
const BLACK_PCS: Record<number, number> = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 } // white index -> black pc after it

export function VirtualKeyboard() {
  const octave = useStore((s) => s.ui.keyboardOctave)
  const keyMap = useSettings((s) => s.keyboardMap)
  const [octaves, setOctaves] = useState(2)
  const [velocity, setVelocity] = useState(0.85)
  const [mapMode, setMapMode] = useState(false)
  const [pendingPitch, setPendingPitch] = useState<number | null>(null)
  const downRef = useRef(new Map<number, number>()) // pointerId -> pitch
  const [, force] = useState(0)

  const baseMidi = 12 * (octave + 1)

  // QWERTY: plays through the user's mapping; in map mode the next key press binds instead
  useEffect(() => {
    const held = new Set<string>()
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const k = e.key.toLowerCase()

      if (mapMode) {
        if (pendingPitch === null) return
        if (e.key === 'Escape') {
          setPendingPitch(null)
          return
        }
        const offset = pendingPitch - baseMidi
        if (e.key === 'Backspace' || e.key === 'Delete') {
          // clear every key bound to this note
          const map = { ...getSettings().keyboardMap }
          for (const key of Object.keys(map)) if (map[key] === offset) delete map[key]
          updateSettings({ keyboardMap: map })
          toast(`Cleared bindings for ${NOTE_NAMES[pendingPitch % 12]}${Math.floor(pendingPitch / 12) - 1}`, 'info', 2500)
          setPendingPitch(null)
          e.preventDefault()
          return
        }
        if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const map = { ...getSettings().keyboardMap }
          delete map[k] // a key can only trigger one note
          map[k] = offset
          updateSettings({ keyboardMap: map })
          toast(`"${k.toUpperCase()}" → ${NOTE_NAMES[pendingPitch % 12]}${Math.floor(pendingPitch / 12) - 1}`, 'info', 2500)
          setPendingPitch(null)
          e.preventDefault()
        }
        return
      }

      if (k in keyMap && !held.has(k)) {
        held.add(k)
        engine.ensure()
        engine.liveNoteOn(baseMidi + keyMap[k], velocity)
      }
    }
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (held.has(k)) {
        held.delete(k)
        engine.liveNoteOff(baseMidi + keyMap[k])
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [octave, velocity, keyMap, mapMode, pendingPitch, baseMidi])

  const whiteCount = octaves * 7
  const whiteW = 100 / whiteCount

  // reverse lookup: note offset -> bound key labels (for silkscreen on the keys)
  const labelsFor = (pitch: number): string => {
    const offset = pitch - baseMidi
    const keys = Object.entries(keyMap)
      .filter(([, v]) => v === offset)
      .map(([k]) => k.toUpperCase())
    return keys.slice(0, 2).join(' ')
  }

  const press = (pointerId: number, pitch: number, vel: number) => {
    if (mapMode) {
      setPendingPitch(pitch)
      engine.ensure()
      engine.liveNoteOn(pitch, 0.6)
      setTimeout(() => engine.liveNoteOff(pitch), 180)
      return
    }
    const prev = downRef.current.get(pointerId)
    if (prev === pitch) return
    if (prev !== undefined) engine.liveNoteOff(prev)
    engine.ensure()
    engine.liveNoteOn(pitch, vel)
    downRef.current.set(pointerId, pitch)
    force((n) => n + 1)
  }
  const release = (pointerId: number) => {
    const prev = downRef.current.get(pointerId)
    if (prev !== undefined) {
      engine.liveNoteOff(prev)
      downRef.current.delete(pointerId)
      force((n) => n + 1)
    }
  }

  const heldPitches = new Set(downRef.current.values())

  const keys: React.ReactNode[] = []
  for (let o = 0; o < octaves; o++) {
    for (let wi = 0; wi < 7; wi++) {
      const idx = o * 7 + wi
      const pitch = baseMidi + o * 12 + WHITE_PCS[wi]
      const bound = labelsFor(pitch)
      keys.push(
        <div
          key={`w${idx}`}
          className={`white-key ${heldPitches.has(pitch) ? 'down' : ''} ${pendingPitch === pitch ? 'map-pending' : ''}`}
          style={{ left: `${idx * whiteW}%`, width: `${whiteW}%` }}
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const v = 0.4 + 0.6 * Math.min(1, (e.clientY - rect.top) / rect.height)
            press(e.pointerId, pitch, v * velocity + 0.15)
          }}
          onPointerEnter={(e) => {
            if (!mapMode && e.buttons > 0) press(e.pointerId, pitch, velocity)
          }}
          onPointerUp={(e) => release(e.pointerId)}
          onPointerCancel={(e) => release(e.pointerId)}
        >
          {(mapMode || bound) && <span className="map-label">{bound}</span>}
          {WHITE_PCS[wi] === 0 && <span className="key-label">{NOTE_NAMES[0]}{octave + o}</span>}
        </div>
      )
    }
  }
  for (let o = 0; o < octaves; o++) {
    for (let wi = 0; wi < 7; wi++) {
      const blackPc = BLACK_PCS[wi]
      if (blackPc === undefined) continue
      const idx = o * 7 + wi
      const pitch = baseMidi + o * 12 + blackPc
      const bound = labelsFor(pitch)
      keys.push(
        <div
          key={`b${idx}`}
          className={`black-key ${heldPitches.has(pitch) ? 'down' : ''} ${pendingPitch === pitch ? 'map-pending' : ''}`}
          style={{ left: `${(idx + 0.65) * whiteW}%`, width: `${whiteW * 0.7}%` }}
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
            press(e.pointerId, pitch, velocity)
          }}
          onPointerEnter={(e) => {
            if (!mapMode && e.buttons > 0) press(e.pointerId, pitch, velocity)
          }}
          onPointerUp={(e) => release(e.pointerId)}
          onPointerCancel={(e) => release(e.pointerId)}
        >
          {(mapMode || bound) && <span className="map-label">{bound}</span>}
        </div>
      )
    }
  }

  return (
    <div className="vkb-wrap">
      <div className="vkb-bar">
        <span className="section-title">Octave</span>
        <button className="small" onClick={() => setUI({ keyboardOctave: Math.max(0, octave - 1) })}>−</button>
        <span>C{octave}</span>
        <button className="small" onClick={() => setUI({ keyboardOctave: Math.min(7, octave + 1) })}>+</button>
        <span className="section-title">Range</span>
        <select value={octaves} onChange={(e) => setOctaves(Number(e.target.value))}>
          <option value={1}>1 octave</option>
          <option value={2}>2 octaves</option>
          <option value={3}>3 octaves</option>
          <option value={4}>4 octaves</option>
        </select>
        <span className="section-title">Velocity</span>
        <input type="range" min={0.1} max={1} step={0.01} value={velocity} onChange={(e) => setVelocity(Number(e.target.value))} />
        <span className="section-title">Key map</span>
        <button
          className={`small ${mapMode ? 'active' : ''}`}
          onClick={() => {
            setMapMode(!mapMode)
            setPendingPitch(null)
          }}
          title="Remap your computer keyboard: click a piano key, then press the key to bind"
        >
          {mapMode ? 'Mapping… (click a key)' : 'Map keys'}
        </button>
        <button
          className="small"
          onClick={() => {
            updateSettings({ keyboardMap: { ...DEFAULT_KEY_MAP } })
            toast('Keyboard map reset to default layout', 'info', 2500)
          }}
          title="Restore the default Z-row / Q-row layout"
        >
          Reset map
        </button>
        <span className="hint">
          {mapMode
            ? pendingPitch !== null
              ? `Press a key to bind ${NOTE_NAMES[pendingPitch % 12]}${Math.floor(pendingPitch / 12) - 1} · Backspace clears · Esc cancels`
              : 'Click a piano key, then press the computer key to bind it. Bindings save automatically.'
            : 'Multi-touch on tablets · bound keys are printed on the keybed'}
        </span>
      </div>
      <div className="vkb" style={{ touchAction: 'none' }}>
        {keys}
      </div>
    </div>
  )
}
