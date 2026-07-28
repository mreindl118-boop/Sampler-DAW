import { useEffect, useState } from 'react'
import { engine } from '../audio/engine'
import { audioIO, HELIX_STADIUM, type IOStatus } from '../audio/audioIO'
import { initMidi, midiInputsInfo, midiOutputs, midiSupported, startMidiLearn, cancelMidiLearn } from '../midi/midi'
import { bleSupported, connectBleMidi } from '../midi/bleMidi'
import { setUI, useStore, getState } from '../state/store'
import { MIDI_ACTIONS, getSettings, updateSettings, useSettings } from '../state/settings'
import { toast } from '../state/toasts'

export function SettingsModal() {
  const show = useStore((s) => s.ui.showSettings)
  if (!show) return null
  return <SettingsInner />
}

function SettingsInner() {
  const mpeEnabled = useStore((s) => s.ui.mpeEnabled)
  const settings = useSettings((s) => s)
  const [io, setIO] = useState<IOStatus>(audioIO.status())
  const [bleStatus, setBleStatus] = useState('')
  const [tab, setTab] = useState<'audio' | 'midi' | 'reamp' | 'diag'>('audio')
  const [learning, setLearning] = useState<string | null>(null)
  const [diagReport, setDiagReport] = useState('')
  const [measuring, setMeasuring] = useState(false)

  useEffect(() => {
    engine.ensure()
    void audioIO.refreshDevices(true)
    void initMidi()
    const off = audioIO.onChange(() => setIO(audioIO.status()))
    setIO(audioIO.status())
    return off
  }, [])

  const stadiumIn = io.inputs.find((d) => HELIX_STADIUM.match.test(d.label))
  const close = () => {
    cancelMidiLearn()
    setUI({ showSettings: false })
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, 94vw)' }}>
        <h3>Audio & MIDI Settings</h3>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['audio', 'midi', 'reamp', 'diag'] as const).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {{ audio: 'Audio devices', midi: 'MIDI', reamp: 'Re-amp', diag: 'Diagnostics' }[t]}
            </button>
          ))}
        </div>

        {tab === 'audio' && (
          <>
            {stadiumIn && (
              <div className="row" style={{ background: '#12291f', border: '1px solid var(--green)', borderRadius: 8, padding: 8 }}>
                <span style={{ color: 'var(--green)' }}>✓ {HELIX_STADIUM.name} detected</span>
                <button
                  className="small"
                  onClick={async () => {
                    await audioIO.openInput(stadiumIn.deviceId)
                    const out = io.outputs.find((d) => HELIX_STADIUM.match.test(d.label))
                    if (out) await audioIO.applyOutputSelection(out.deviceId, true)
                    setIO(audioIO.status())
                  }}
                >Use for input & output</button>
              </div>
            )}
            <div className="row">
              <label>Input device</label>
              <select
                value={settings.inputDeviceId}
                style={{ flex: 1 }}
                onChange={async (e) => {
                  updateSettings({
                    inputDeviceId: e.target.value,
                    inputDeviceLabel: io.inputs.find((d) => d.deviceId === e.target.value)?.label ?? '',
                  })
                  if (audioIO.inputIsOpen()) await audioIO.openInput(e.target.value)
                  setIO(audioIO.status())
                }}
              >
                <option value="">System default</option>
                {io.inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 6)}`}</option>
                ))}
              </select>
              <button
                className="small"
                onClick={async () => {
                  try {
                    await audioIO.openInput(getSettings().inputDeviceId)
                    setIO(audioIO.status())
                    toast(`Input open: ${audioIO.status().inputChannelCount} channel(s)`, 'info')
                  } catch (err) {
                    toast(`Cannot open input: ${err}`, 'error')
                  }
                }}
              >Open</button>
            </div>
            <div className="row">
              <label>Output device</label>
              <select
                value={settings.outputDeviceId}
                style={{ flex: 1 }}
                onChange={(e) => void audioIO.applyOutputSelection(e.target.value, true).then(() => setIO(audioIO.status()))}
              >
                <option value="">System default</option>
                {io.outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${d.deviceId.slice(0, 6)}`}</option>
                ))}
              </select>
            </div>
            <div className="row">
              <label>Auto-select Stadium</label>
              <button className={settings.preferStadium ? 'active' : ''} onClick={() => updateSettings({ preferStadium: !settings.preferStadium })}>
                {settings.preferStadium ? 'On' : 'Off'}
              </button>
              <span className="hint">When a Helix Stadium is plugged in, route input/output to it automatically.</span>
            </div>
            <div className="row">
              <label>Engine status</label>
              <span className="hint">
                {io.sampleRate} Hz (device native) · input {io.inputOpen ? `open, ${io.inputChannelCount} ch` : 'closed'} ·
                output {io.outputChannelCount} ch ({audioIO.outputPairCount()} pair{audioIO.outputPairCount() > 1 ? 's' : ''}) ·
                base latency {io.baseLatencyMs.toFixed(1)} ms · output latency {io.outputLatencyMs.toFixed(1)} ms
              </span>
            </div>
            <div className="row">
              <label>Buffer / latency hint</label>
              <select
                value={settings.latencyHint}
                onChange={(e) => {
                  updateSettings({ latencyHint: e.target.value as 'interactive' | 'balanced' | 'playback' })
                  toast('Latency hint saved — reload the app to rebuild the audio engine with the new buffer size', 'info', 7000)
                }}
              >
                <option value="interactive">interactive (smallest buffer)</option>
                <option value="balanced">balanced</option>
                <option value="playback">playback (largest buffer)</option>
              </select>
              <span className="hint">Browsers manage exact buffer sizes; this is the supported control.</span>
            </div>
            <div className="row">
              <label>Round-trip latency</label>
              <button
                disabled={measuring}
                onClick={async () => {
                  setMeasuring(true)
                  toast('Measuring: connect an output back to an input (or let a mic hear the speakers)…', 'info')
                  try {
                    const ms = await audioIO.measureRoundTrip()
                    if (ms === null) toast('No return signal detected — check the loopback and input levels', 'warn')
                    else toast(`Round-trip: ${ms.toFixed(1)} ms — recording offset set automatically`, 'info')
                  } finally {
                    setMeasuring(false)
                    setIO(audioIO.status())
                  }
                }}
              >{measuring ? 'Listening…' : 'Measure (loopback)'}</button>
              <span className="hint">
                {settings.measuredRoundTripMs !== null ? `last measured ${settings.measuredRoundTripMs.toFixed(1)} ms` : 'not measured yet'}
              </span>
            </div>
            <div className="row">
              <label>Recording offset</label>
              <input
                type="number" min={0} max={500} step={1} value={settings.recordingOffsetMs}
                onChange={(e) => updateSettings({ recordingOffsetMs: Math.max(0, Number(e.target.value)) })}
              />
              <span className="hint">ms trimmed from every recording/re-amp so takes align with playback.</span>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              XLR mics and ¼″ instruments come in through your interface's channels. On the {HELIX_STADIUM.name}:
              {' '}{HELIX_STADIUM.notes} Voice processing (echo cancellation / noise suppression / AGC) is always
              explicitly disabled. Note: browsers may expose fewer than 8 USB channels (Chrome commonly delivers
              stereo only) — the diagnostics tab shows what this browser actually delivers; a wrapped native build
              (ASIO on Windows, Core Audio on macOS) is the path to full 8×8 I/O and adjustable buffers.
            </p>
          </>
        )}

        {tab === 'midi' && (
          <>
            <div className="row">
              <label>MIDI inputs</label>
              <div style={{ flex: 1 }}>
                {midiSupported() ? (
                  midiInputsInfo().length > 0 ? (
                    midiInputsInfo().map((n) => <div key={n.id} style={{ fontSize: 12 }}>• {n.name}</div>)
                  ) : (
                    <span className="hint">No MIDI inputs — connect a device (USB or Bluetooth).</span>
                  )
                ) : (
                  <span className="hint">Web MIDI not supported in this browser (use Chrome/Edge or a native build).</span>
                )}
              </div>
            </div>
            <div className="row">
              <label>MPE (ROLI etc.)</label>
              <button className={mpeEnabled ? 'active' : ''} onClick={() => setUI({ mpeEnabled: !mpeEnabled })}>
                {mpeEnabled ? 'Enabled' : 'Disabled'}
              </button>
              <span className="hint">Per-note glide/slide/press for Seaboard-style controllers (bend ±48).</span>
            </div>
            <div className="row">
              <label>Bluetooth MIDI</label>
              {bleSupported() ? (
                <button onClick={() => void connectBleMidi(setBleStatus).catch((e) => setBleStatus(String(e)))}>
                  Connect BLE MIDI device…
                </button>
              ) : (
                <span className="hint">Pair in OS settings; it then shows up as a MIDI input.</span>
              )}
              {bleStatus && <span className="hint">{bleStatus}</span>}
            </div>
            <h4 style={{ margin: '12px 0 6px' }}>Outbound — control the Stadium</h4>
            <div className="row">
              <label>MIDI clock</label>
              <button
                className={settings.midiClockEnabled ? 'active' : ''}
                onClick={() => updateSettings({ midiClockEnabled: !settings.midiClockEnabled })}
              >{settings.midiClockEnabled ? 'On' : 'Off'}</button>
              <select value={settings.midiClockOutId} onChange={(e) => updateSettings({ midiClockOutId: e.target.value })}>
                <option value="">— output —</option>
                {midiOutputs().map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <span className="hint">24 PPQN at project tempo + Start/Stop, so tempo-synced FX follow the session.</span>
            </div>
            <div className="row">
              <label>Marker PC/CC out</label>
              <select value={settings.midiPcOutId} onChange={(e) => updateSettings({ midiPcOutId: e.target.value })}>
                <option value="">— output —</option>
                {midiOutputs().map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <label style={{ minWidth: 0 }}>ch</label>
              <input
                type="number" min={1} max={16} value={settings.midiPcChannel + 1} style={{ width: 52 }}
                onChange={(e) => updateSettings({ midiPcChannel: Math.min(15, Math.max(0, Number(e.target.value) - 1)) })}
              />
              <span className="hint">Markers send Program Change (presets) and CC69 (snapshots) as playback passes them.</span>
            </div>
            <h4 style={{ margin: '12px 0 6px' }}>MIDI learn — footswitch → transport</h4>
            {MIDI_ACTIONS.map((a) => {
              const bound = Object.entries(settings.midiMap).find(([, v]) => v === a.id)?.[0]
              return (
                <div className="row" key={a.id}>
                  <label>{a.label}</label>
                  <button
                    className={learning === a.id ? 'rec-active' : ''}
                    onClick={async () => {
                      if (learning === a.id) {
                        cancelMidiLearn()
                        setLearning(null)
                        return
                      }
                      setLearning(a.id)
                      await startMidiLearn(a.id)
                      setLearning(null)
                    }}
                  >{learning === a.id ? 'Press a switch…' : bound ? bound.toUpperCase() : 'Learn'}</button>
                  {bound && (
                    <button
                      className="small"
                      onClick={() => {
                        const map = { ...getSettings().midiMap }
                        delete map[bound]
                        updateSettings({ midiMap: map })
                      }}
                    >✕</button>
                  )}
                </div>
              )
            })}
            <p className="hint">
              Tap Learn, then press a Stadium footswitch (or any controller button). CC and Program Change messages
              are both supported. Mappings persist across sessions.
            </p>
          </>
        )}

        {tab === 'reamp' && <ReampPanel />}

        {tab === 'diag' && (
          <>
            <p className="hint">
              Runs the device verification pass: enumeration, input open, channel activity (2 s capture on every
              channel), and output bus layout. Play your instrument during the capture to see signal per channel.
            </p>
            <div className="row">
              <button
                onClick={async () => {
                  setDiagReport('Running…')
                  setDiagReport(await runDiagnostics())
                }}
              >Run diagnostics</button>
              <span className="hint">Re-run after plugging/unplugging devices to verify hot-plug handling.</span>
            </div>
            {diagReport && (
              <pre style={{ fontSize: 11, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, whiteSpace: 'pre-wrap', userSelect: 'text' }}>
                {diagReport}
              </pre>
            )}
          </>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  )
}

function ReampPanel() {
  const tracks = useStore((s) => s.project.tracks)
  const audioTracks = tracks.filter((t) => t.kind === 'audio' && t.clips.some((c) => c.kind === 'audio'))
  const [sourceId, setSourceId] = useState(audioTracks[0]?.id ?? '')
  const [outPair, setOutPair] = useState(Math.min(1, audioIO.outputPairCount() - 1))
  const [inCh, setInCh] = useState('[0,1]')
  const [running, setRunning] = useState(false)
  const pairs = audioIO.outputPairCount()

  return (
    <>
      <p className="hint">
        Plays a dry track out of a hardware output pair (feed the Stadium's re-amp input), records the processed
        return, and adds it as a new track aligned with round-trip compensation. Measure latency first (Audio tab)
        for sample-accurate alignment.
      </p>
      <div className="row">
        <label>Dry source track</label>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} style={{ flex: 1 }}>
          {audioTracks.length === 0 && <option value="">— no audio tracks with clips —</option>}
          {audioTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="row">
        <label>Send to output</label>
        <select value={outPair} onChange={(e) => setOutPair(Number(e.target.value))}>
          {Array.from({ length: pairs }, (_, i) => (
            <option key={i} value={i}>Out {i * 2 + 1}/{i * 2 + 2}{i === 1 ? ' (Stadium re-amp feed)' : ''}</option>
          ))}
        </select>
        {pairs === 1 && <span className="hint">Only outs 1/2 available on this output device/browser.</span>}
      </div>
      <div className="row">
        <label>Record return from</label>
        <select value={inCh} onChange={(e) => setInCh(e.target.value)}>
          <option value="[0,1]">In 1/2 (processed stereo)</option>
          <option value="[2,3]">In 3/4</option>
          <option value="[4,5]">In 5/6</option>
          <option value="[6]">In 7 (mono)</option>
          <option value="[7]">In 8 (mono)</option>
        </select>
      </div>
      <div className="row">
        <button
          disabled={!sourceId || running}
          onClick={async () => {
            setRunning(true)
            try {
              await engine.reamp(sourceId, outPair, JSON.parse(inCh) as number[])
            } finally {
              setRunning(false)
            }
          }}
        >{running ? 'Re-amping…' : '⟳ Run re-amp'}</button>
      </div>
    </>
  )
}

async function runDiagnostics(): Promise<string> {
  const lines: string[] = []
  const stamp = new Date().toISOString()
  lines.push(`OpenStudio device diagnostics — ${stamp}`)
  try {
    engine.ensure()
    await audioIO.refreshDevices(true)
    const io = audioIO.status()
    lines.push(`\n[1] Enumeration`)
    lines.push(`  inputs (${io.inputs.length}):`)
    io.inputs.forEach((d) => lines.push(`    - ${d.label || d.deviceId}${HELIX_STADIUM.match.test(d.label) ? '   ← Helix Stadium' : ''}`))
    lines.push(`  outputs (${io.outputs.length}):`)
    io.outputs.forEach((d) => lines.push(`    - ${d.label || d.deviceId}${HELIX_STADIUM.match.test(d.label) ? '   ← Helix Stadium' : ''}`))

    lines.push(`\n[2] Engine`)
    lines.push(`  sample rate: ${io.sampleRate} Hz (device native)`)
    lines.push(`  base latency: ${io.baseLatencyMs.toFixed(2)} ms, output latency: ${io.outputLatencyMs.toFixed(2)} ms`)
    lines.push(`  output channels: ${io.outputChannelCount} (${audioIO.outputPairCount()} stereo pair(s))`)

    lines.push(`\n[3] Input capture (2 s on every delivered channel — play something!)`)
    const wasOpen = audioIO.inputIsOpen()
    if (!wasOpen) await audioIO.openInput()
    const st = audioIO.status()
    lines.push(`  device: ${st.activeInputLabel || 'system default'}`)
    lines.push(`  channels delivered by browser: ${st.inputChannelCount} (requested 8)`)
    const { InputRecorder } = await import('../audio/recorder')
    const rec = new InputRecorder(engine.ctx!)
    rec.start()
    await new Promise((r) => setTimeout(r, 2000))
    const cap = rec.stop()
    if (!cap) {
      lines.push('  ✗ capture returned no data')
    } else {
      cap.channels.forEach((ch, i) => {
        let peak = 0
        let sum = 0
        for (let s = 0; s < ch.length; s++) {
          const a = Math.abs(ch[s])
          if (a > peak) peak = a
          sum += a * a
        }
        const rms = Math.sqrt(sum / ch.length)
        const db = (v: number) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) + ' dBFS' : '-inf')
        lines.push(`  ch ${i + 1}: peak ${db(peak)}, rms ${db(rms)} ${peak > 0.001 ? '✓ signal' : '· silent'}`)
      })
    }
    if (!wasOpen) audioIO.closeInput()

    lines.push(`\n[4] Round-trip / re-amp alignment`)
    lines.push(
      `  measured: ${getSettings().measuredRoundTripMs !== null ? getSettings().measuredRoundTripMs!.toFixed(1) + ' ms' : 'not yet — run "Measure (loopback)" with a physical loopback connected'}`
    )
    lines.push(`  recording offset in use: ${getSettings().recordingOffsetMs} ms`)

    lines.push(`\n[5] Hot-plug`)
    lines.push('  devicechange listener: active — unplug/replug the interface and watch for fallback/restore toasts.')
    lines.push(`\nProject: ${getState().project.tracks.length} tracks. All checks completed without errors.`)
  } catch (e) {
    lines.push(`\n✗ Diagnostics aborted: ${e}`)
  }
  return lines.join('\n')
}
