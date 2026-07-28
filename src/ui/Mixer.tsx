import { useEffect, useRef, useState } from 'react'
import type { AudioClip, FxType, FxUnit, Track } from '../state/types'
import { FX_TYPES, makeFx } from '../state/presets'
import { beginGesture, findClip, mapClip, mapTrack, setProject, setUI, useStore } from '../state/store'
import { engine } from '../audio/engine'
import { audioIO, HELIX_STADIUM } from '../audio/audioIO'
import { midiOutputs } from '../midi/midi'
import { Ic } from './icons'

function useMeter(trackId: string | null): number {
  const [level, setLevel] = useState(0)
  const peakRef = useRef(0)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const p = engine.meterPeak(trackId)
      // fast attack, slow decay
      peakRef.current = p > peakRef.current ? p : peakRef.current * 0.92
      setLevel(peakRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [trackId])
  return level
}

function VMeter({ trackId }: { trackId: string | null }) {
  const level = useMeter(trackId)
  const pct = Math.min(1, level) * 100
  return (
    <div className="vmeter">
      <div className="vmeter-fill" style={{ height: `${pct}%`, background: level >= 0.99 ? 'var(--red)' : level > 0.75 ? 'var(--yellow)' : 'var(--green)' }} />
    </div>
  )
}

const INPUT_OPTIONS: { label: string; channels: number[] }[] = [
  { label: 'In 1/2 (stereo)', channels: [0, 1] },
  { label: 'In 3/4 (stereo)', channels: [2, 3] },
  { label: 'In 5/6 (stereo)', channels: [4, 5] },
  { label: 'In 7/8 (stereo)', channels: [6, 7] },
  ...Array.from({ length: 8 }, (_, i) => ({ label: `In ${i + 1} (mono)`, channels: [i] })),
]

export function Mixer() {
  const tracks = useStore((s) => s.project.tracks)
  const masterVol = useStore((s) => s.project.master.volume)
  const masterPair = useStore((s) => s.project.master.outputPair)
  const selectedTrackId = useStore((s) => s.ui.selectedTrackId)
  const selectedClipId = useStore((s) => s.ui.selectedClipId)
  const [fxEdit, setFxEdit] = useState<{ trackId: string; fxId: string } | null>(null)
  const pairCount = audioIO.outputPairCount()
  const clipSel = findClip(selectedClipId)

  return (
    <div className="mixer">
      {clipSel && clipSel.clip.kind === 'audio' && <ClipInspector trackId={clipSel.track.id} clipId={clipSel.clip.id} />}
      {tracks.map((t) => (
        <Strip key={t.id} track={t} selected={t.id === selectedTrackId} pairCount={pairCount} onEditFx={(fxId) => setFxEdit({ trackId: t.id, fxId })} />
      ))}
      <div className="strip" style={{ borderColor: 'var(--green)' }}>
        <div className="name">Master</div>
        <div style={{ display: 'flex', gap: 4, height: 110, alignItems: 'stretch' }}>
          <input
            className="fader"
            type="range" min={0} max={1.2} step={0.01} value={masterVol}
            onChange={(e) => setProject((p) => ({ ...p, master: { ...p.master, volume: Number(e.target.value) } }))}
          />
          <VMeter trackId={null} />
        </div>
        <div className="hint">{Math.round(masterVol * 100)}%</div>
        {pairCount > 1 && (
          <select
            value={masterPair}
            title="Master hardware output pair"
            onChange={(e) => setProject((p) => ({ ...p, master: { ...p.master, outputPair: Number(e.target.value) } }))}
            style={{ fontSize: 10, width: '100%' }}
          >
            {Array.from({ length: pairCount }, (_, i) => (
              <option key={i} value={i}>Out {i * 2 + 1}/{i * 2 + 2}</option>
            ))}
          </select>
        )}
      </div>
      {fxEdit && <FxEditor trackId={fxEdit.trackId} fxId={fxEdit.fxId} onClose={() => setFxEdit(null)} />}
    </div>
  )
}

function ClipInspector({ trackId, clipId }: { trackId: string; clipId: string }) {
  const clip = useStore((s) => {
    const t = s.project.tracks.find((tr) => tr.id === trackId)
    return t?.clips.find((c) => c.id === clipId)
  })
  if (!clip || clip.kind !== 'audio') return null
  const set = (patch: Partial<AudioClip>) =>
    mapClip(trackId, clipId, (c) => (c.kind === 'audio' ? { ...c, ...patch } : c))
  return (
    <div className="strip" style={{ borderColor: 'var(--accent)', width: 130 }}>
      <div className="name">Clip: {clip.name}</div>
      <label className="hint">Gain {Math.round(clip.gain * 100)}%</label>
      <input type="range" min={0} max={2} step={0.01} value={clip.gain} style={{ width: '92%' }}
        onChange={(e) => set({ gain: Number(e.target.value) })} />
      <label className="hint">Fade in {clip.fadeIn.toFixed(2)} beats</label>
      <input type="range" min={0} max={Math.max(0.5, clip.length / 2)} step={0.05} value={clip.fadeIn} style={{ width: '92%' }}
        onChange={(e) => set({ fadeIn: Number(e.target.value) })} />
      <label className="hint">Fade out {clip.fadeOut.toFixed(2)} beats</label>
      <input type="range" min={0} max={Math.max(0.5, clip.length / 2)} step={0.05} value={clip.fadeOut} style={{ width: '92%' }}
        onChange={(e) => set({ fadeOut: Number(e.target.value) })} />
      <div className="hint">Select clips in the arranger; fades render live and in exports.</div>
    </div>
  )
}

function Strip({ track, selected, pairCount, onEditFx }: { track: Track; selected: boolean; pairCount: number; onEditFx: (fxId: string) => void }) {
  const isAudio = track.kind === 'audio'
  const isMidi = !isAudio
  const outs = isMidi ? midiOutputs() : []
  return (
    <div className={`strip ${selected ? 'selected' : ''}`} onClick={() => setUI({ selectedTrackId: track.id })}>
      <div className="name" style={{ color: track.color }}>{track.name}</div>
      <div style={{ display: 'flex', gap: 4, height: 110, alignItems: 'stretch' }}>
        <input
          className="fader"
          type="range" min={0} max={1.5} step={0.01} value={track.volume}
          onChange={(e) => mapTrack(track.id, (t) => ({ ...t, volume: Number(e.target.value) }))}
        />
        <VMeter trackId={track.id} />
      </div>
      <input
        type="range" min={-1} max={1} step={0.01} value={track.pan} style={{ width: '90%' }}
        title="Pan"
        onChange={(e) => mapTrack(track.id, (t) => ({ ...t, pan: Number(e.target.value) }))}
        onDoubleClick={() => mapTrack(track.id, (t) => ({ ...t, pan: 0 }))}
      />
      <div className="btns">
        <button className={track.mute ? 'active' : ''} onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, mute: !t.mute })) }}>M</button>
        <button className={track.solo ? 'active' : ''} onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, solo: !t.solo })) }}>S</button>
        <button className={track.armed ? 'rec-active' : ''} onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, armed: !t.armed })) }}>●</button>
        {isAudio && (
          <button
            className={track.monitor ? 'active' : ''}
            title="Software input monitoring (hear the input through this track while armed)"
            onClick={(e) => { e.stopPropagation(); mapTrack(track.id, (t) => ({ ...t, monitor: !t.monitor })) }}
          ><Ic n="phones" size={11} /></button>
        )}
      </div>
      {isAudio && (
        <select
          value={JSON.stringify(track.inputChannels)}
          title={`Input source${audioIO.activeProfile() ? ` — ${HELIX_STADIUM.name}: 1/2 = processed, 7 = dry DI` : ''}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const channels = JSON.parse(e.target.value) as number[]
            mapTrack(track.id, (t) => ({ ...t, inputChannels: channels }))
          }}
          style={{ fontSize: 10, width: '100%' }}
        >
          {INPUT_OPTIONS.map((o) => (
            <option key={o.label} value={JSON.stringify(o.channels)}>{o.label}</option>
          ))}
        </select>
      )}
      {pairCount > 1 && (
        <select
          value={track.outputPair}
          title="Hardware output routing"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => mapTrack(track.id, (t) => ({ ...t, outputPair: Number(e.target.value) }))}
          style={{ fontSize: 10, width: '100%' }}
        >
          <option value={-1}>→ Master</option>
          {Array.from({ length: pairCount }, (_, i) => (
            <option key={i} value={i}>→ Out {i * 2 + 1}/{i * 2 + 2}</option>
          ))}
        </select>
      )}
      {isMidi && outs.length > 0 && (
        <select
          value={track.midiOutId}
          title="External MIDI output (hardware synths, Helix MIDI in)"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => mapTrack(track.id, (t) => ({ ...t, midiOutId: e.target.value }))}
          style={{ fontSize: 10, width: '100%' }}
        >
          <option value="">MIDI: internal</option>
          {outs.map((o) => (
            <option key={o.id} value={o.id}>→ {o.name}</option>
          ))}
        </select>
      )}
      <div className="fx-list">
        {track.fx.map((fx) => (
          <div key={fx.id} className={`fx-chip ${fx.enabled ? '' : 'off'}`} onClick={(e) => { e.stopPropagation(); onEditFx(fx.id) }}>
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
            {fx.enabled ? 'On' : 'Bypassed'}
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
