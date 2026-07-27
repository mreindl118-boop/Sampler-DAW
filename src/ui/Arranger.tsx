import { useEffect, useRef, useState } from 'react'
import type { AutomationLane, Clip, Track } from '../state/types'
import { engine } from '../audio/engine'
import {
  addAutomationPoint, addMidiClip, addTrack, beginGesture, copyClip, duplicateClip, findClip,
  getOrCreateLane, getState, mapClip, mapTrack, moveTrack, pasteClip, removeAutomationPoint,
  removeClip, removeMarker, removeTrack, renameTrack, setProject, setUI, splitClip,
  updateAutomationPoint, updateMarker, useStore,
} from '../state/store'
import { toast } from '../state/toasts'
import { Waveform, snapBeat, snapFloor } from './Waveform'

const LANE_H = 56
const AUTO_H = 44
const HEAD_W = 168

export function Arranger() {
  const tracks = useStore((s) => s.project.tracks)
  const bars = useStore((s) => s.project.bars)
  const timeSigNum = useStore((s) => s.project.timeSig[0])
  const loop = useStore((s) => s.project.loop)
  const markers = useStore((s) => s.project.markers)
  const tempo = useStore((s) => s.project.tempo)
  const zoomX = useStore((s) => s.ui.zoomX)
  const snap = useStore((s) => s.ui.snap)
  const snapOn = useStore((s) => s.ui.snapOn)
  const selectedTrackId = useStore((s) => s.ui.selectedTrackId)
  const selectedClipId = useStore((s) => s.ui.selectedClipId)
  const totalBeats = bars * timeSigNum
  const width = totalBeats * zoomX
  const playheadRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

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
    return Math.max(0, (clientX - rect.left - HEAD_W + el.scrollLeft) / zoomX)
  }

  const onRulerPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.marker-flag')) return
    const startBeat = snapBeat(beatAtClientX(e.clientX), snap, snapOn)
    let dragged = false
    const move = (ev: PointerEvent) => {
      const b = snapBeat(beatAtClientX(ev.clientX), snap, snapOn)
      if (Math.abs(b - startBeat) >= Math.max(snap, 0.1)) {
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

  const doSplit = () => {
    const { ui } = getState()
    const found = findClip(ui.selectedClipId)
    if (!found) return toast('Select a clip to split', 'warn')
    if (!splitClip(found.track.id, found.clip.id, engine.position(), tempo)) {
      toast('Playhead is not inside the selected clip', 'warn')
    }
  }

  const importAudio = async (files: FileList | File[], trackId?: string, atBeat?: number) => {
    let target = trackId ? getState().project.tracks.find((t) => t.id === trackId) : undefined
    if (!target || target.kind !== 'audio') {
      target = getState().project.tracks.find((t) => t.kind === 'audio')
      if (!target) target = addTrack('audio')
    }
    let beat = atBeat ?? snapFloor(engine.position(), snap, snapOn)
    beginGesture()
    for (const f of Array.from(files)) {
      try {
        await engine.importSampleAsClip(f, target.id, beat)
        const buf = getState().project.samples[getState().project.samples.length - 1]
        beat += Math.max(1, (buf?.duration ?? 1) * (tempo / 60))
      } catch (err) {
        toast(`Could not import ${f.name}: ${err}`, 'error')
      }
    }
  }

  return (
    <div className="arranger-wrap">
      <div style={{ display: 'flex', gap: 6, padding: '5px 8px', background: 'var(--panel)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="section-title">Tracks</span>
        <button className="small" onClick={() => addTrack('synth')}>+ Synth</button>
        <button className="small" onClick={() => addTrack('sampler')}>+ Sampler</button>
        <button className="small" onClick={() => addTrack('drums')}>+ Drums</button>
        <button className="small" onClick={() => addTrack('audio')}>+ Audio</button>
        <button className="small" onClick={() => importRef.current?.click()} title="Import audio to timeline">Import ♪</button>
        <input
          ref={importRef} type="file" accept="audio/*" multiple style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files?.length) void importAudio(e.target.files); e.target.value = '' }}
        />
        <span style={{ width: 8 }} />
        <button className="small" onClick={doSplit} title="Split selected clip at playhead (Ctrl+E)">✂ Split</button>
        <button
          className="small"
          onClick={() => {
            const f = findClip(getState().ui.selectedClipId)
            if (f) duplicateClip(f.track.id, f.clip.id)
          }}
          title="Duplicate selected clip (Ctrl+D)"
        >⧉ Dup</button>
        <button className="small" onClick={() => engine.addMarkerAtPlayhead()} title="Add marker at playhead">🚩 Marker</button>
        <div className="grow" style={{ flex: 1 }} />
        <button className={`small ${snapOn ? 'active' : ''}`} onClick={() => setUI({ snapOn: !snapOn })} title="Snap on/off">
          Snap
        </button>
        <select value={snap} onChange={(e) => setUI({ snap: Number(e.target.value) })} disabled={!snapOn}>
          <option value={1}>1 beat</option>
          <option value={0.5}>1/8</option>
          <option value={0.25}>1/16</option>
          <option value={0.125}>1/32</option>
        </select>
        <button className="small" onClick={() => setUI({ zoomX: Math.max(8, zoomX / 1.4) })}>−</button>
        <button className="small" onClick={() => setUI({ zoomX: Math.min(160, zoomX * 1.4) })}>+</button>
      </div>
      <div className="arranger" ref={scrollRef}>
        <div className="track-heads" style={{ minWidth: HEAD_W }}>
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
            {markers.map((m) => (
              <MarkerFlag key={m.id} marker={m} zoomX={zoomX} />
            ))}
          </div>
          <div className="lanes" style={{ width }}>
            {tracks.map((t) => (
              <div key={t.id}>
                <Lane track={t} zoomX={zoomX} snap={snap} snapOn={snapOn} selectedClipId={selectedClipId} beatAtClientX={beatAtClientX} onImport={importAudio} />
                {t.showAutomation && <AutomationLaneView track={t} zoomX={zoomX} width={width} beatAtClientX={beatAtClientX} />}
              </div>
            ))}
            <div ref={playheadRef} className="playhead" />
          </div>
        </div>
      </div>
    </div>
  )
}

function MarkerFlag({ marker, zoomX }: { marker: { id: string; beat: number; name: string; pc: number | null; ccs: { num: number; val: number }[] }; zoomX: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div
        className="marker-flag"
        style={{ position: 'absolute', left: marker.beat * zoomX, top: 0, cursor: 'pointer', zIndex: 5, fontSize: 10, color: 'var(--yellow)' }}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        title={`${marker.name}${marker.pc !== null ? ` (PC ${marker.pc})` : ''}`}
      >
        ▾{marker.name}
      </div>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 380 }}>
            <h3>Marker</h3>
            <div className="row">
              <label>Name</label>
              <input type="text" value={marker.name} onChange={(e) => updateMarker(marker.id, { name: e.target.value })} />
            </div>
            <div className="row">
              <label>Beat</label>
              <input
                type="number" min={0} step={0.25} value={marker.beat}
                onChange={(e) => updateMarker(marker.id, { beat: Math.max(0, Number(e.target.value)) })}
              />
            </div>
            <div className="row">
              <label>Program Change</label>
              <input
                type="number" min={-1} max={127} value={marker.pc ?? -1}
                title="-1 = none. Sent to the marker MIDI output (Settings) — switches Helix presets."
                onChange={(e) => updateMarker(marker.id, { pc: Number(e.target.value) < 0 ? null : Math.min(127, Number(e.target.value)) })}
              />
              <span className="hint">−1 = off</span>
            </div>
            <div className="row">
              <label>CC (snapshot)</label>
              <input
                type="number" min={-1} max={127} placeholder="CC#" value={marker.ccs[0]?.num ?? -1}
                onChange={(e) => {
                  const num = Number(e.target.value)
                  updateMarker(marker.id, { ccs: num < 0 ? [] : [{ num, val: marker.ccs[0]?.val ?? 0 }] })
                }}
              />
              <input
                type="number" min={0} max={127} placeholder="value" value={marker.ccs[0]?.val ?? 0}
                disabled={!marker.ccs.length}
                onChange={(e) => updateMarker(marker.id, { ccs: [{ num: marker.ccs[0]?.num ?? 69, val: Number(e.target.value) }] })}
              />
              <span className="hint">Helix snapshots: CC69, value 0–7</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button onClick={() => { removeMarker(marker.id); setOpen(false) }}>Delete</button>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function TrackHead({ track, selected }: { track: Track; selected: boolean }) {
  const [editing, setEditing] = useState(false)
  return (
    <div
      className={`track-head ${selected ? 'selected' : ''}`}
      onClick={() => setUI({ selectedTrackId: track.id })}
      style={{ borderLeft: `3px solid ${track.color}`, height: track.showAutomation ? LANE_H + AUTO_H : LANE_H }}
    >
      {editing ? (
        <input
          type="text" autoFocus defaultValue={track.name}
          onBlur={(e) => { renameTrack(track.id, e.target.value || track.name); setEditing(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          style={{ width: '95%' }}
        />
      ) : (
        <div className="name" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
          {track.name}
        </div>
      )}
      <div className="controls">
        <button className={track.mute ? 'active' : ''} onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, mute: !t.mute })) }} title="Mute">M</button>
        <button className={track.solo ? 'active' : ''} onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, solo: !t.solo })) }} title="Solo">S</button>
        <button className={track.armed ? 'rec-active' : ''} onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, armed: !t.armed })) }} title="Arm for recording">●</button>
        <button
          className={track.showAutomation ? 'active' : ''}
          onClick={(e) => {
            e.stopPropagation()
            getOrCreateLane(track.id, 'volume')
            mapTrack(track.id, (t) => ({ ...t, showAutomation: !t.showAutomation }))
          }}
          title="Automation lane"
        >A</button>
        <button onClick={(e) => { e.stopPropagation(); moveTrack(track.id, -1) }} title="Move up">↑</button>
        <button onClick={(e) => { e.stopPropagation(); moveTrack(track.id, 1) }} title="Move down">↓</button>
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
  track, zoomX, snap, snapOn, selectedClipId, beatAtClientX, onImport,
}: {
  track: Track
  zoomX: number
  snap: number
  snapOn: boolean
  selectedClipId: string | null
  beatAtClientX: (x: number) => number
  onImport: (files: FileList | File[], trackId?: string, atBeat?: number) => Promise<void>
}) {
  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.clip')) return
    if (track.kind === 'audio') return
    const beat = snapFloor(beatAtClientX(e.clientX), snap, snapOn)
    addMidiClip(track.id, beat, 4)
    setUI({ bottomTab: track.kind === 'drums' ? 'steps' : 'piano' })
  }
  return (
    <div
      className="lane"
      onDoubleClick={onDoubleClick}
      onClick={() => setUI({ selectedTrackId: track.id })}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        const beat = snapFloor(beatAtClientX(e.clientX), snap, snapOn)
        void onImport(e.dataTransfer.files, track.kind === 'audio' ? track.id : undefined, beat)
      }}
    >
      {track.clips.map((c) => (
        <ClipView key={c.id} track={track} clip={c} zoomX={zoomX} snap={snap} snapOn={snapOn} selected={c.id === selectedClipId} beatAtClientX={beatAtClientX} />
      ))}
    </div>
  )
}

function ClipView({
  track, clip, zoomX, snap, snapOn, selected, beatAtClientX,
}: {
  track: Track
  clip: Clip
  zoomX: number
  snap: number
  snapOn: boolean
  selected: boolean
  beatAtClientX: (x: number) => number
}) {
  const [drag, setDrag] = useState(false)
  const tempo = getState().project.tempo

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    setUI({ selectedTrackId: track.id, selectedClipId: clip.id })
    const startBeatAtDown = beatAtClientX(e.clientX)
    const orig = { start: clip.start, length: clip.length, offset: clip.kind === 'audio' ? clip.offset : 0 }
    const target = e.target as HTMLElement
    const mode = target.classList.contains('clip-resize') ? 'resize' : target.classList.contains('clip-trim-l') ? 'trimL' : 'move'
    beginGesture()
    setDrag(true)
    const move = (ev: PointerEvent) => {
      const delta = beatAtClientX(ev.clientX) - startBeatAtDown
      if (mode === 'resize') {
        const newLen = Math.max(snapOn ? snap : 0.05, snapBeat(orig.length + delta, snap, snapOn))
        mapClip(track.id, clip.id, (c) => ({ ...c, length: newLen }))
      } else if (mode === 'trimL') {
        // trim the clip start: move start forward/back, keep the far edge fixed
        const spb = 60 / tempo
        let d = snapBeat(delta, snap, snapOn)
        d = Math.max(-orig.start, Math.min(orig.length - (snapOn ? snap : 0.05), d))
        if (clip.kind === 'audio') d = Math.max(d, -orig.offset / spb) // can't trim before sample start
        mapClip(track.id, clip.id, (c) =>
          c.kind === 'audio'
            ? { ...c, start: orig.start + d, length: orig.length - d, offset: orig.offset + d * spb }
            : {
                ...c,
                start: orig.start + d,
                length: orig.length - d,
                notes: c.notes.map((n) => ({ ...n, start: n.start - d })).filter((n) => n.start + n.dur > 0),
              }
        )
      } else {
        const newStart = Math.max(0, snapBeat(orig.start + delta, snap, snapOn))
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
  const spb = 60 / tempo

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
      {cur.kind === 'midi' && <MiniNotes notes={cur.notes} length={cur.length} />}
      {cur.kind === 'audio' && (
        <div style={{ position: 'absolute', inset: '14px 2px 2px' }}>
          <Waveform sampleId={cur.sampleId} offsetSec={cur.offset} durSec={cur.length * spb} />
          {cur.fadeIn > 0 && (
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, (cur.fadeIn / cur.length) * 100)}%`, background: 'linear-gradient(to right, rgba(0,0,0,0.55), transparent)' }} />
          )}
          {cur.fadeOut > 0 && (
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${Math.min(100, (cur.fadeOut / cur.length) * 100)}%`, background: 'linear-gradient(to left, rgba(0,0,0,0.55), transparent)' }} />
          )}
        </div>
      )}
      <div className="clip-trim-l" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'w-resize' }} />
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

// ---------- automation lane ----------

const PARAM_RANGE: Record<AutomationLane['param'], [number, number]> = {
  volume: [0, 1.5],
  pan: [-1, 1],
}

function AutomationLaneView({
  track, zoomX, width, beatAtClientX,
}: {
  track: Track
  zoomX: number
  width: number
  beatAtClientX: (x: number) => number
}) {
  const [param, setParam] = useState<AutomationLane['param']>('volume')
  const lane = track.automation.find((l) => l.param === param)
  const [lo, hi] = PARAM_RANGE[param]
  const fallback = param === 'volume' ? track.volume : track.pan

  const valToY = (v: number) => AUTO_H - 4 - ((v - lo) / (hi - lo)) * (AUTO_H - 8)
  const yToVal = (y: number) => Math.max(lo, Math.min(hi, lo + ((AUTO_H - 4 - y) / (AUTO_H - 8)) * (hi - lo)))

  const onLanePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).classList.contains('auto-pt')) return
    if (!lane) {
      getOrCreateLane(track.id, param)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const beat = beatAtClientX(e.clientX)
    const value = yToVal(e.clientY - rect.top)
    beginGesture()
    const pid = addAutomationPoint(track.id, lane.id, beat, value)
    const move = (ev: PointerEvent) => {
      updateAutomationPoint(track.id, lane.id, pid, beatAtClientX(ev.clientX), yToVal(ev.clientY - rect.top))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const pts = lane?.points ?? []
  const path =
    pts.length > 0
      ? `M 0 ${valToY(pts[0].value)} ` +
        pts.map((p) => `L ${p.beat * zoomX} ${valToY(p.value)}`).join(' ') +
        ` L ${width} ${valToY(pts[pts.length - 1].value)}`
      : `M 0 ${valToY(fallback)} L ${width} ${valToY(fallback)}`

  return (
    <div className="auto-lane" style={{ height: AUTO_H, position: 'relative' }} onPointerDown={onLanePointerDown}>
      <div style={{ position: 'absolute', left: 4, top: 2, zIndex: 3, display: 'flex', gap: 4 }}>
        <select
          value={param}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const pr = e.target.value as AutomationLane['param']
            setParam(pr)
            getOrCreateLane(track.id, pr)
          }}
          style={{ fontSize: 9, padding: '1px 2px' }}
        >
          <option value="volume">volume</option>
          <option value="pan">pan</option>
        </select>
      </div>
      <svg width={width} height={AUTO_H} style={{ position: 'absolute', inset: 0 }}>
        <path d={path} stroke={track.color} strokeWidth={1.5} fill="none" />
      </svg>
      {pts.map((p) => (
        <div
          key={p.id}
          className="auto-pt"
          style={{ left: p.beat * zoomX - 4, top: valToY(p.value) - 4, borderColor: track.color }}
          onPointerDown={(e) => {
            e.stopPropagation()
            beginGesture()
            const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
            const move = (ev: PointerEvent) => {
              updateAutomationPoint(track.id, lane!.id, p.id, beatAtClientX(ev.clientX), yToVal(ev.clientY - rect.top))
            }
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            beginGesture()
            removeAutomationPoint(track.id, lane!.id, p.id)
          }}
        />
      ))}
    </div>
  )
}
