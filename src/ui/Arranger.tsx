import { useEffect, useRef, useState } from 'react'
import type { Clip, Track } from '../state/types'
import { engine } from '../audio/engine'
import {
  addMidiClip, addTrack, beginGesture, getState, mapClip, mapTrack, removeClip, removeTrack, setProject, setUI, useStore,
} from '../state/store'

export function Arranger() {
  const tracks = useStore((s) => s.project.tracks)
  const bars = useStore((s) => s.project.bars)
  const timeSigNum = useStore((s) => s.project.timeSig[0])
  const loop = useStore((s) => s.project.loop)
  const zoomX = useStore((s) => s.ui.zoomX)
  const snap = useStore((s) => s.ui.snap)
  const selectedTrackId = useStore((s) => s.ui.selectedTrackId)
  const selectedClipId = useStore((s) => s.ui.selectedClipId)
  const totalBeats = bars * timeSigNum
  const width = totalBeats * zoomX
  const playheadRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${engine.position() * zoomX}px)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [zoomX])

  const beatAtClientX = (clientX: number): number => {
    const el = scrollRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const headW = 168
    return Math.max(0, (clientX - rect.left - headW + el.scrollLeft) / zoomX)
  }

  const onRulerPointerDown = (e: React.PointerEvent) => {
    const startBeat = Math.round(beatAtClientX(e.clientX) / snap) * snap
    let dragged = false
    const move = (ev: PointerEvent) => {
      const b = Math.round(beatAtClientX(ev.clientX) / snap) * snap
      if (Math.abs(b - startBeat) >= snap) {
        dragged = true
        setProject((p) => ({
          ...p,
          loop: { on: true, start: Math.min(startBeat, b), end: Math.max(startBeat, b) },
        }))
      }
    }
    const up = () => {
      if (!dragged) engine.setPosition(startBeat)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="arranger-wrap">
      <div style={{ display: 'flex', gap: 6, padding: '5px 8px', background: 'var(--panel)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="section-title">Tracks</span>
        <button className="small" onClick={() => addTrack('synth')}>+ Synth</button>
        <button className="small" onClick={() => addTrack('sampler')}>+ Sampler</button>
        <button className="small" onClick={() => addTrack('drums')}>+ Drums</button>
        <button className="small" onClick={() => addTrack('audio')}>+ Audio</button>
        <div className="grow" style={{ flex: 1 }} />
        <span className="section-title">Snap</span>
        <select value={snap} onChange={(e) => setUI({ snap: Number(e.target.value) })}>
          <option value={1}>1 beat</option>
          <option value={0.5}>1/8</option>
          <option value={0.25}>1/16</option>
          <option value={0.125}>1/32</option>
        </select>
        <button className="small" onClick={() => setUI({ zoomX: Math.max(8, zoomX / 1.4) })}>−</button>
        <button className="small" onClick={() => setUI({ zoomX: Math.min(160, zoomX * 1.4) })}>+</button>
      </div>
      <div className="arranger" ref={scrollRef}>
        <div className="track-heads">
          <div style={{ height: 26, borderBottom: '1px solid var(--border)' }} />
          {tracks.map((t) => (
            <TrackHead key={t.id} track={t} selected={t.id === selectedTrackId} />
          ))}
        </div>
        <div style={{ position: 'relative', minWidth: width }}>
          <div className="ruler" style={{ width }} onPointerDown={onRulerPointerDown}>
            {Array.from({ length: bars }, (_, i) => (
              <span
                key={i}
                style={{
                  position: 'absolute', left: i * timeSigNum * zoomX + 4, top: 5,
                  fontSize: 10, color: 'var(--text-dim)', borderLeft: '1px solid var(--border)', paddingLeft: 3,
                }}
              >
                {i + 1}
              </span>
            ))}
            {loop.on && (
              <div className="loop-region" style={{ left: loop.start * zoomX, width: (loop.end - loop.start) * zoomX }} />
            )}
          </div>
          <div className="lanes" style={{ width }}>
            {tracks.map((t) => (
              <Lane key={t.id} track={t} zoomX={zoomX} snap={snap} selectedClipId={selectedClipId} beatAtClientX={beatAtClientX} />
            ))}
            <div ref={playheadRef} className="playhead" />
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackHead({ track, selected }: { track: Track; selected: boolean }) {
  return (
    <div
      className={`track-head ${selected ? 'selected' : ''}`}
      onClick={() => setUI({ selectedTrackId: track.id })}
      style={{ borderLeft: `3px solid ${track.color}` }}
    >
      <div className="name">{track.name}</div>
      <div className="controls">
        <button
          className={track.mute ? 'active' : ''}
          onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, mute: !t.mute })) }}
          title="Mute"
        >M</button>
        <button
          className={track.solo ? 'active' : ''}
          onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, solo: !t.solo })) }}
          title="Solo"
        >S</button>
        <button
          className={track.armed ? 'rec-active' : ''}
          onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, armed: !t.armed })) }}
          title="Arm for recording"
        >●</button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Delete track "${track.name}"?`)) removeTrack(track.id)
          }}
          title="Delete track"
        >✕</button>
      </div>
    </div>
  )
}

function Lane({
  track, zoomX, snap, selectedClipId, beatAtClientX,
}: {
  track: Track
  zoomX: number
  snap: number
  selectedClipId: string | null
  beatAtClientX: (x: number) => number
}) {
  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.clip')) return
    if (track.kind === 'audio') return
    const beat = Math.floor(beatAtClientX(e.clientX) / snap) * snap
    addMidiClip(track.id, beat, 4)
    setUI({ bottomTab: track.kind === 'drums' ? 'steps' : 'piano' })
  }
  return (
    <div className="lane" onDoubleClick={onDoubleClick} onClick={() => setUI({ selectedTrackId: track.id })}>
      {track.clips.map((c) => (
        <ClipView key={c.id} track={track} clip={c} zoomX={zoomX} snap={snap} selected={c.id === selectedClipId} beatAtClientX={beatAtClientX} />
      ))}
    </div>
  )
}

function ClipView({
  track, clip, zoomX, snap, selected, beatAtClientX,
}: {
  track: Track
  clip: Clip
  zoomX: number
  snap: number
  selected: boolean
  beatAtClientX: (x: number) => number
}) {
  const [drag, setDrag] = useState(false)

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    setUI({ selectedTrackId: track.id, selectedClipId: clip.id })
    const startBeatAtDown = beatAtClientX(e.clientX)
    const origStart = clip.start
    const target = e.target as HTMLElement
    const resizing = target.classList.contains('clip-resize')
    beginGesture()
    setDrag(true)
    const move = (ev: PointerEvent) => {
      const delta = beatAtClientX(ev.clientX) - startBeatAtDown
      if (resizing) {
        const newLen = Math.max(snap, Math.round((clip.length + delta) / snap) * snap)
        mapClip(track.id, clip.id, (c) => ({ ...c, length: newLen }))
      } else {
        const newStart = Math.max(0, Math.round((origStart + delta) / snap) * snap)
        mapClip(track.id, clip.id, (c) => ({ ...c, start: newStart }))
      }
    }
    const up = () => {
      setDrag(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setUI({
      selectedTrackId: track.id,
      selectedClipId: clip.id,
      bottomTab: clip.kind === 'audio' ? 'mixer' : track.kind === 'drums' ? 'steps' : 'piano',
    })
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (confirm(`Delete clip "${clip.name}"?`)) removeClip(track.id, clip.id)
  }

  const cur = getState().project.tracks.find((t) => t.id === track.id)?.clips.find((c) => c.id === clip.id) ?? clip

  return (
    <div
      className={`clip ${selected ? 'selected' : ''}`}
      style={{
        left: cur.start * zoomX,
        width: Math.max(8, cur.length * zoomX),
        background: track.color,
        cursor: drag ? 'grabbing' : 'grab',
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {clip.name}
      {clip.kind === 'midi' && <MiniNotes notes={clip.notes} length={clip.length} />}
      <div className="clip-resize" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />
    </div>
  )
}

function MiniNotes({ notes, length }: { notes: { pitch: number; start: number; dur: number }[]; length: number }) {
  if (notes.length === 0) return null
  const pitches = notes.map((n) => n.pitch)
  const min = Math.min(...pitches)
  const max = Math.max(...pitches) + 1
  const span = Math.max(4, max - min)
  return (
    <div className="mini-notes">
      {notes.slice(0, 100).map((n, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${(n.start / length) * 100}%`,
            width: `${Math.max(1.5, (n.dur / length) * 100)}%`,
            top: `${(1 - (n.pitch - min + 1) / span) * 100}%`,
            height: 2.5,
            background: 'rgba(255,255,255,0.85)',
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  )
}
