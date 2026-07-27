import { useEffect, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { NOTE_NAMES } from '../music/theory'
import { setUI, useStore } from '../state/store'

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]
const BLACK_PCS: Record<number, number> = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 } // white index -> black pc after it

// QWERTY note map (FL-style): Z row = lower octave, Q row = upper octave
const KEY_MAP: Record<string, number> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  ',': 12, l: 13, '.': 14, ';': 15, '/': 16,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23,
  i: 24, '9': 25, o: 26, '0': 27, p: 28,
}

export function VirtualKeyboard() {
  const octave = useStore((s) => s.ui.keyboardOctave)
  const [octaves, setOctaves] = useState(2)
  const [velocity, setVelocity] = useState(0.85)
  const downRef = useRef(new Map<number, number>()) // pointerId -> pitch
  const [, force] = useState(0)

  // QWERTY playing
  useEffect(() => {
    const held = new Set<string>()
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if (k in KEY_MAP && !held.has(k)) {
        held.add(k)
        engine.ensure()
        engine.liveNoteOn(12 * (octave + 1) + KEY_MAP[k], velocity)
      }
    }
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (held.has(k)) {
        held.delete(k)
        engine.liveNoteOff(12 * (octave + 1) + KEY_MAP[k])
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [octave, velocity])

  const baseMidi = 12 * (octave + 1)
  const whiteCount = octaves * 7
  const whiteW = 100 / whiteCount

  const press = (pointerId: number, pitch: number, vel: number) => {
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
      keys.push(
        <div
          key={`w${idx}`}
          className={`white-key ${heldPitches.has(pitch) ? 'down' : ''}`}
          style={{ left: `${idx * whiteW}%`, width: `${whiteW}%` }}
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const v = 0.4 + 0.6 * Math.min(1, (e.clientY - rect.top) / rect.height)
            press(e.pointerId, pitch, v * velocity + 0.15)
          }}
          onPointerEnter={(e) => {
            if (e.buttons > 0) press(e.pointerId, pitch, velocity)
          }}
          onPointerUp={(e) => release(e.pointerId)}
          onPointerCancel={(e) => release(e.pointerId)}
        >
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
      keys.push(
        <div
          key={`b${idx}`}
          className={`black-key ${heldPitches.has(pitch) ? 'down' : ''}`}
          style={{ left: `${(idx + 0.65) * whiteW}%`, width: `${whiteW * 0.7}%` }}
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
            press(e.pointerId, pitch, velocity)
          }}
          onPointerEnter={(e) => {
            if (e.buttons > 0) press(e.pointerId, pitch, velocity)
          }}
          onPointerUp={(e) => release(e.pointerId)}
          onPointerCancel={(e) => release(e.pointerId)}
        />
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
        <span className="hint">Multi-touch on tablets · QWERTY: Z–M lower row, Q–U upper row</span>
      </div>
      <div className="vkb" style={{ touchAction: 'none' }}>
        {keys}
      </div>
    </div>
  )
}
