import { useEffect, useRef } from 'react'
import { sampleStore } from '../audio/sampler'

/** Canvas waveform for an audio clip: renders min/max peaks per pixel column. */
export function Waveform({
  sampleId, offsetSec, durSec, color = 'rgba(255,255,255,0.85)',
}: {
  sampleId: string
  offsetSec: number
  durSec: number
  color?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const buffer = sampleStore.get(sampleId)
    const parent = canvas.parentElement
    const w = Math.max(2, Math.floor(parent?.clientWidth ?? 50))
    const h = Math.max(2, Math.floor(parent?.clientHeight ?? 30))
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const g = canvas.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, h)
    if (!buffer) {
      // sample not loaded (e.g. before first user gesture) — draw a flat line
      g.strokeStyle = color
      g.beginPath()
      g.moveTo(0, h / 2)
      g.lineTo(w, h / 2)
      g.stroke()
      return
    }
    const data = buffer.getChannelData(0)
    const start = Math.max(0, Math.floor(offsetSec * buffer.sampleRate))
    const span = Math.max(1, Math.floor(durSec * buffer.sampleRate))
    const per = span / w
    g.fillStyle = color
    const mid = h / 2
    for (let x = 0; x < w; x++) {
      const i0 = start + Math.floor(x * per)
      const i1 = Math.min(data.length, start + Math.floor((x + 1) * per) + 1)
      if (i0 >= data.length) break
      let min = 1
      let max = -1
      const step = Math.max(1, Math.floor((i1 - i0) / 40))
      for (let i = i0; i < i1; i += step) {
        const v = data[i]
        if (v < min) min = v
        if (v > max) max = v
      }
      const y0 = mid + min * mid * 0.95
      const y1 = mid + max * mid * 0.95
      g.fillRect(x, Math.min(y0, y1), 1, Math.max(1, Math.abs(y1 - y0)))
    }
  }, [sampleId, offsetSec, durSec, color])

  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}

/** Vertical peak meter driven by engine analyser polling (parent passes level 0..1). */
export function MeterBar({ level, height = 8, horizontal = true }: { level: number; height?: number; horizontal?: boolean }) {
  const pct = Math.min(1, level) * 100
  const clip = level >= 0.99
  const grad = 'linear-gradient(to right, #57d9a3 0%, #57d9a3 60%, #f7b32f 80%, #f75f5f 100%)'
  return (
    <div
      style={{
        background: '#0a0b0e',
        border: '1px solid var(--border)',
        borderRadius: 3,
        overflow: 'hidden',
        width: horizontal ? '100%' : height,
        height: horizontal ? height : '100%',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: horizontal ? `${pct}%` : '100%',
          height: horizontal ? '100%' : `${pct}%`,
          background: grad,
          transition: 'none',
        }}
      />
      {clip && (
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, background: '#f75f5f' }} />
      )}
    </div>
  )
}

export function snapBeat(beat: number, snap: number, snapOn: boolean): number {
  return snapOn ? Math.round(beat / snap) * snap : beat
}

export function snapFloor(beat: number, snap: number, snapOn: boolean): number {
  return snapOn ? Math.floor(beat / snap) * snap : beat
}
