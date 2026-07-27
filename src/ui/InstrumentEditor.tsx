import { useRef } from 'react'
import type { ADSR, OscWave, SamplerParams, SynthParams, Track } from '../state/types'
import { engine } from '../audio/engine'
import { SYNTH_PRESETS } from '../state/presets'
import { beginGesture, findTrack, mapTrack, useStore } from '../state/store'
import { midiToName } from '../music/theory'

export function InstrumentEditor() {
  const selectedTrackId = useStore((s) => s.ui.selectedTrackId)
  useStore((s) => s.project)
  const track = findTrack(selectedTrackId)
  if (!track) return <Center msg="Select a track." />
  if (track.kind === 'synth' && track.synth) return <SynthEditor track={track} params={track.synth} />
  if (track.kind === 'sampler' && track.sampler) return <SamplerEditor track={track} params={track.sampler} />
  if (track.kind === 'drums' && track.drums) return <DrumEditor track={track} />
  return <Center msg="Audio tracks have no instrument — use the Mixer for level, pan and FX." />
}

function Center({ msg }: { msg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
      {msg}
    </div>
  )
}

function Param({
  label, value, min, max, step, fmt, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  fmt?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="param">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </div>
  )
}

function EnvEditor({ env, onChange }: { env: ADSR; onChange: (env: ADSR) => void }) {
  return (
    <>
      <Param label="Attack" value={env.a} min={0.001} max={3} step={0.001} fmt={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(a) => onChange({ ...env, a })} />
      <Param label="Decay" value={env.d} min={0.001} max={3} step={0.001} fmt={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(d) => onChange({ ...env, d })} />
      <Param label="Sustain" value={env.s} min={0} max={1} step={0.01} onChange={(s) => onChange({ ...env, s })} />
      <Param label="Release" value={env.r} min={0.005} max={4} step={0.005} fmt={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(r) => onChange({ ...env, r })} />
    </>
  )
}

const WAVES: OscWave[] = ['sine', 'triangle', 'sawtooth', 'square']

function SynthEditor({ track, params }: { track: Track; params: SynthParams }) {
  const set = (patch: Partial<SynthParams>) => mapTrack(track.id, (t) => ({ ...t, synth: { ...t.synth!, ...patch } }))

  const oscEditor = (which: 'osc1' | 'osc2') => {
    const o = params[which]
    return (
      <div className="inst-group" key={which}>
        <h4>{which === 'osc1' ? 'Oscillator 1' : 'Oscillator 2'}</h4>
        <div className="param">
          <label>Wave</label>
          <select value={o.wave} onChange={(e) => set({ [which]: { ...o, wave: e.target.value as OscWave } } as Partial<SynthParams>)}>
            {WAVES.map((w) => <option key={w}>{w}</option>)}
          </select>
        </div>
        <Param label="Octave" value={o.octave} min={-3} max={3} step={1} fmt={(v) => `${v}`} onChange={(octave) => set({ [which]: { ...o, octave } } as Partial<SynthParams>)} />
        <Param label="Detune" value={o.detune} min={-50} max={50} step={1} fmt={(v) => `${v}¢`} onChange={(detune) => set({ [which]: { ...o, detune } } as Partial<SynthParams>)} />
        <Param label="Level" value={o.level} min={0} max={1} step={0.01} onChange={(level) => set({ [which]: { ...o, level } } as Partial<SynthParams>)} />
      </div>
    )
  }

  return (
    <div className="inst">
      <div className="inst-group" style={{ minWidth: 230 }}>
        <h4>Preset</h4>
        <select
          style={{ width: '100%' }}
          value=""
          onChange={(e) => {
            const preset = SYNTH_PRESETS.find((p) => p.name === e.target.value)
            if (preset) {
              beginGesture()
              mapTrack(track.id, (t) => ({ ...t, synth: JSON.parse(JSON.stringify(preset.params)) as SynthParams }))
            }
          }}
        >
          <option value="">Load preset…</option>
          {SYNTH_PRESETS.map((p) => <option key={p.name}>{p.name}</option>)}
        </select>
        <div style={{ height: 8 }} />
        <Param label="Gain" value={params.gain} min={0} max={1.2} step={0.01} onChange={(gain) => set({ gain })} />
        <Param label="Glide" value={params.glide} min={0} max={0.5} step={0.005} fmt={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(glide) => set({ glide })} />
        <Param label="Unison" value={params.unison} min={1} max={4} step={1} fmt={(v) => `${v}x`} onChange={(unison) => set({ unison })} />
        <Param label="Spread" value={params.unisonSpread} min={0} max={50} step={1} fmt={(v) => `${v}¢`} onChange={(unisonSpread) => set({ unisonSpread })} />
        <Param label="Bend Rng" value={params.bendRange} min={1} max={48} step={1} fmt={(v) => `±${v}st`} onChange={(bendRange) => set({ bendRange })} />
        <div className="hint">Bend range ±48 matches ROLI MPE defaults.</div>
      </div>
      {oscEditor('osc1')}
      {oscEditor('osc2')}
      <div className="inst-group">
        <h4>Filter</h4>
        <div className="param">
          <label>Type</label>
          <select
            value={params.filter.type}
            onChange={(e) => set({ filter: { ...params.filter, type: e.target.value as SynthParams['filter']['type'] } })}
          >
            <option value="lowpass">lowpass</option>
            <option value="highpass">highpass</option>
            <option value="bandpass">bandpass</option>
          </select>
        </div>
        <Param label="Cutoff" value={params.filter.cutoff} min={40} max={16000} step={10} fmt={(v) => `${v.toFixed(0)}Hz`} onChange={(cutoff) => set({ filter: { ...params.filter, cutoff } })} />
        <Param label="Reso" value={params.filter.q} min={0.1} max={20} step={0.1} onChange={(q) => set({ filter: { ...params.filter, q } })} />
        <Param label="Env Amt" value={params.filter.envAmount} min={0} max={8000} step={50} fmt={(v) => `${v.toFixed(0)}Hz`} onChange={(envAmount) => set({ filter: { ...params.filter, envAmount } })} />
        <Param label="Noise" value={params.noise} min={0} max={1} step={0.01} onChange={(noise) => set({ noise })} />
      </div>
      <div className="inst-group">
        <h4>Amp Envelope</h4>
        <EnvEditor env={params.ampEnv} onChange={(ampEnv) => set({ ampEnv })} />
      </div>
      <div className="inst-group">
        <h4>Filter Envelope</h4>
        <EnvEditor env={params.filterEnv} onChange={(filterEnv) => set({ filterEnv })} />
      </div>
      <div className="inst-group">
        <h4>LFO</h4>
        <Param label="Rate" value={params.lfo.rate} min={0.05} max={20} step={0.05} fmt={(v) => `${v.toFixed(2)}Hz`} onChange={(rate) => set({ lfo: { ...params.lfo, rate } })} />
        <Param label="Depth" value={params.lfo.depth} min={0} max={100} step={1} onChange={(depth) => set({ lfo: { ...params.lfo, depth } })} />
        <div className="param">
          <label>Target</label>
          <select
            value={params.lfo.target}
            onChange={(e) => set({ lfo: { ...params.lfo, target: e.target.value as SynthParams['lfo']['target'] } })}
          >
            <option value="pitch">pitch (vibrato)</option>
            <option value="filter">filter (wah)</option>
            <option value="amp">amp (tremolo)</option>
          </select>
        </div>
      </div>
    </div>
  )
}

function SamplerEditor({ track, params }: { track: Track; params: SamplerParams }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const samples = useStore((s) => s.project.samples)
  const set = (patch: Partial<SamplerParams>) => mapTrack(track.id, (t) => ({ ...t, sampler: { ...t.sampler!, ...patch } }))

  return (
    <div className="inst">
      <div className="inst-group" style={{ minWidth: 250 }}>
        <h4>Sample</h4>
        <div className="param">
          <label>Source</label>
          <select value={params.sampleId ?? ''} onChange={(e) => set({ sampleId: e.target.value || null })} style={{ flex: 1 }}>
            <option value="">— none —</option>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.duration.toFixed(1)}s)</option>
            ))}
          </select>
        </div>
        <button onClick={() => fileRef.current?.click()}>Import audio file…</button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) {
              const id = await engine.importSample(f)
              set({ sampleId: id })
            }
            e.target.value = ''
          }}
        />
        <div className="hint" style={{ marginTop: 6 }}>
          WAV, MP3, OGG, FLAC… anything the browser can decode. Record your own on an Audio track, then pick it here.
        </div>
      </div>
      <div className="inst-group">
        <h4>Playback</h4>
        <Param label="Root" value={params.rootNote} min={24} max={96} step={1} fmt={(v) => midiToName(v)} onChange={(rootNote) => set({ rootNote })} />
        <Param label="Start" value={params.start} min={0} max={1} step={0.001} onChange={(start) => set({ start: Math.min(start, params.end - 0.001) })} />
        <Param label="End" value={params.end} min={0} max={1} step={0.001} onChange={(end) => set({ end: Math.max(end, params.start + 0.001) })} />
        <div className="param">
          <label>Loop</label>
          <button className={params.loop ? 'active' : ''} onClick={() => set({ loop: !params.loop })}>
            {params.loop ? 'On' : 'Off'}
          </button>
        </div>
        <Param label="Gain" value={params.gain} min={0} max={1.5} step={0.01} onChange={(gain) => set({ gain })} />
      </div>
      <div className="inst-group">
        <h4>Envelope</h4>
        <EnvEditor env={params.env} onChange={(env) => set({ env })} />
      </div>
    </div>
  )
}

function DrumEditor({ track }: { track: Track }) {
  const lanes = track.drums!.lanes
  return (
    <div className="inst">
      {lanes.map((lane, i) => (
        <div className="inst-group" key={i} style={{ minWidth: 170 }}>
          <h4
            style={{ cursor: 'pointer' }}
            onClick={() => {
              engine.ensure()
              engine.liveNoteOn(i, 0.9)
            }}
          >
            {lane.name} ▸
          </h4>
          <Param
            label="Tune" value={lane.tune} min={-12} max={12} step={0.5} fmt={(v) => `${v}st`}
            onChange={(tune) => mapTrack(track.id, (t) => ({
              ...t,
              drums: { ...t.drums!, lanes: t.drums!.lanes.map((l, li) => (li === i ? { ...l, tune } : l)) },
            }))}
          />
          <Param
            label="Decay" value={lane.decay} min={0} max={1} step={0.01}
            onChange={(decay) => mapTrack(track.id, (t) => ({
              ...t,
              drums: { ...t.drums!, lanes: t.drums!.lanes.map((l, li) => (li === i ? { ...l, decay } : l)) },
            }))}
          />
          <Param
            label="Level" value={lane.level} min={0} max={1} step={0.01}
            onChange={(level) => mapTrack(track.id, (t) => ({
              ...t,
              drums: { ...t.drums!, lanes: t.drums!.lanes.map((l, li) => (li === i ? { ...l, level } : l)) },
            }))}
          />
        </div>
      ))}
    </div>
  )
}
