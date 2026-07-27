import { useState } from 'react'
import type { FxType, FxUnit, Track } from '../state/types'
import { FX_TYPES, makeFx } from '../state/presets'
import { beginGesture, mapTrack, setProject, setUI, useStore } from '../state/store'

export function Mixer() {
  const tracks = useStore((s) => s.project.tracks)
  const masterVol = useStore((s) => s.project.master.volume)
  const selectedTrackId = useStore((s) => s.ui.selectedTrackId)
  const [fxEdit, setFxEdit] = useState<{ trackId: string; fxId: string } | null>(null)

  return (
    <div className="mixer">
      {tracks.map((t) => (
        <Strip key={t.id} track={t} selected={t.id === selectedTrackId} onEditFx={(fxId) => setFxEdit({ trackId: t.id, fxId })} />
      ))}
      <div className="strip" style={{ borderColor: 'var(--green)' }}>
        <div className="name">Master</div>
        <input
          className="fader"
          type="range" min={0} max={1.2} step={0.01} value={masterVol}
          onChange={(e) => setProject((p) => ({ ...p, master: { ...p.master, volume: Number(e.target.value) } }))}
        />
        <div className="hint">{Math.round(masterVol * 100)}%</div>
      </div>
      {fxEdit && <FxEditor trackId={fxEdit.trackId} fxId={fxEdit.fxId} onClose={() => setFxEdit(null)} />}
    </div>
  )
}

function Strip({ track, selected, onEditFx }: { track: Track; selected: boolean; onEditFx: (fxId: string) => void }) {
  return (
    <div className={`strip ${selected ? 'selected' : ''}`} onClick={() => setUI({ selectedTrackId: track.id })}>
      <div className="name" style={{ color: track.color }}>{track.name}</div>
      <input
        className="fader"
        type="range" min={0} max={1.5} step={0.01} value={track.volume}
        onChange={(e) => mapTrack(track.id, (t) => ({ ...t, volume: Number(e.target.value) }))}
      />
      <input
        type="range" min={-1} max={1} step={0.01} value={track.pan} style={{ width: '90%' }}
        title="Pan"
        onChange={(e) => mapTrack(track.id, (t) => ({ ...t, pan: Number(e.target.value) }))}
        onDoubleClick={() => mapTrack(track.id, (t) => ({ ...t, pan: 0 }))}
      />
      <div className="btns">
        <button className={track.mute ? 'active' : ''} onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, mute: !t.mute })) }}>M</button>
        <button className={track.solo ? 'active' : ''} onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, solo: !t.solo })) }}>S</button>
      </div>
      <div className="fx-list">
        {track.fx.map((fx) => (
          <div
            key={fx.id}
            className={`fx-chip ${fx.enabled ? '' : 'off'}`}
            onClick={(e) => { e.stopPropagation(); onEditFx(fx.id) }}
          >
            <span>{FX_TYPES.find((f) => f.type === fx.type)?.label ?? fx.type}</span>
            <span
              onClick={(e) => {
                e.stopPropagation()
                beginGesture()
                mapTrack(track.id, (t) => ({ ...t, fx: t.fx.filter((f) => f.id !== fx.id) }))
              }}
            >✕</span>
          </div>
        ))}
        <select
          value=""
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const type = e.target.value as FxType
            if (!type) return
            beginGesture()
            mapTrack(track.id, (t) => ({ ...t, fx: [...t.fx, makeFx(type)] }))
            e.target.value = ''
          }}
          style={{ fontSize: 10, width: '100%' }}
        >
          <option value="">+ FX…</option>
          {FX_TYPES.map((f) => (
            <option key={f.type} value={f.type}>{f.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

const FX_PARAM_RANGES: Record<string, Record<string, [number, number, number]>> = {
  delay: { time: [0.02, 1.5, 0.005], feedback: [0, 0.95, 0.01], mix: [0, 1, 0.01] },
  reverb: { size: [0.2, 6, 0.1], decay: [0.5, 8, 0.1], mix: [0, 1, 0.01] },
  distortion: { drive: [0, 1, 0.01], mix: [0, 1, 0.01] },
  chorus: { rate: [0.05, 6, 0.05], depth: [0.0005, 0.02, 0.0005], mix: [0, 1, 0.01] },
  eq3: { low: [-18, 18, 0.5], mid: [-18, 18, 0.5], high: [-18, 18, 0.5] },
  compressor: { threshold: [-60, 0, 1], ratio: [1, 20, 0.5], attack: [0.001, 0.3, 0.001], release: [0.02, 1, 0.01] },
  filter: { freq: [40, 16000, 10], q: [0.1, 18, 0.1], type: [0, 2, 1] },
  bitcrush: { bits: [1, 12, 1], mix: [0, 1, 0.01] },
}

function FxEditor({ trackId, fxId, onClose }: { trackId: string; fxId: string; onClose: () => void }) {
  const track = useStore((s) => s.project.tracks.find((t) => t.id === trackId))
  const fx = track?.fx.find((f) => f.id === fxId)
  if (!track || !fx) return null

  const updateFx = (patch: Partial<FxUnit>) => {
    mapTrack(trackId, (t) => ({
      ...t,
      fx: t.fx.map((f) => (f.id === fxId ? { ...f, ...patch } : f)),
    }))
  }

  const ranges = FX_PARAM_RANGES[fx.type] ?? {}

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{FX_TYPES.find((f) => f.type === fx.type)?.label ?? fx.type}</h3>
        <div className="row">
          <label>Enabled</label>
          <button className={fx.enabled ? 'active' : ''} onClick={() => updateFx({ enabled: !fx.enabled })}>
            {fx.enabled ? 'On' : 'Off'}
          </button>
        </div>
        {Object.entries(fx.params).map(([key, value]) => {
          const [min, max, step] = ranges[key] ?? [0, 1, 0.01]
          return (
            <div className="row" key={key}>
              <label>{key}</label>
              <input
                type="range" min={min} max={max} step={step} value={value}
                style={{ flex: 1 }}
                onChange={(e) => updateFx({ params: { ...fx.params, [key]: Number(e.target.value) } })}
              />
              <span style={{ width: 60, textAlign: 'right', fontSize: 11 }}>{Number(value).toFixed(3)}</span>
            </div>
          )
        })}
        <div className="hint">Parameter changes rebuild the effect in real time.</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
