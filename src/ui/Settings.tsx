import { useEffect, useState } from 'react'
import { listAudioInputs } from '../audio/recorder'
import { initMidi, midiSupported } from '../midi/midi'
import { bleSupported, connectBleMidi } from '../midi/bleMidi'
import { setUI, useStore } from '../state/store'

export function SettingsModal() {
  const show = useStore((s) => s.ui.showSettings)
  const midiInputs = useStore((s) => s.ui.midiInputs)
  const mpeEnabled = useStore((s) => s.ui.mpeEnabled)
  const audioInputId = useStore((s) => s.ui.audioInputId)
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const [bleStatus, setBleStatus] = useState('')

  useEffect(() => {
    if (show) {
      void listAudioInputs().then(setInputs).catch(() => setInputs([]))
      void initMidi()
    }
  }, [show])

  if (!show) return null

  return (
    <div className="modal-backdrop" onClick={() => setUI({ showSettings: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>

        <div className="row">
          <label>Audio input</label>
          <select value={audioInputId} onChange={(e) => setUI({ audioInputId: e.target.value })} style={{ flex: 1 }}>
            <option value="">System default</option>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 6)}`}</option>
            ))}
          </select>
        </div>
        <p className="hint" style={{ marginBottom: 12 }}>
          Plug XLR mics or ¼″ (TS/TRS) instruments into a USB / USB-C audio interface (Focusrite Scarlett,
          Behringer UMC, IK iRig, etc.) — it shows up here as an input. Arm an Audio track and hit ⏺ to record.
          Recording is captured as lossless PCM at your device sample rate.
        </p>

        <div className="row">
          <label>MIDI inputs</label>
          <div style={{ flex: 1 }}>
            {midiSupported() ? (
              midiInputs.length > 0 ? (
                midiInputs.map((n) => <div key={n} style={{ fontSize: 12 }}>🎹 {n}</div>)
              ) : (
                <span className="hint">No MIDI devices detected — connect one and reopen Settings.</span>
              )
            ) : (
              <span className="hint">Web MIDI is not supported in this browser (use Chrome/Edge, or a wrapped native build).</span>
            )}
          </div>
        </div>

        <div className="row">
          <label>MPE (ROLI etc.)</label>
          <button className={mpeEnabled ? 'active' : ''} onClick={() => setUI({ mpeEnabled: !mpeEnabled })}>
            {mpeEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 12 }}>
          With MPE on, each finger on a ROLI Seaboard gets its own voice with independent <b>glide</b> (per-note pitch
          bend, ±48 semitones), <b>slide</b> (CC74 → filter brightness) and <b>press</b> (channel pressure → loudness).
          Set the synth's Bend Range to 48 to match ROLI Dashboard defaults.
        </p>

        <div className="row">
          <label>Bluetooth MIDI</label>
          {bleSupported() ? (
            <button onClick={() => void connectBleMidi(setBleStatus).catch((e) => setBleStatus(String(e)))}>
              Connect BLE MIDI device…
            </button>
          ) : (
            <span className="hint">Direct BLE not available — pair in OS settings instead (it then appears as a MIDI input).</span>
          )}
          {bleStatus && <span className="hint">{bleStatus}</span>}
        </div>
        <p className="hint" style={{ marginBottom: 12 }}>
          iPad: Settings → Bluetooth or GarageBand's Bluetooth MIDI panel. Android/Chrome: the button above connects
          directly. Paired controllers (ROLI BLOCKS, Bluetooth keyboards, pads) then play like any MIDI device.
        </p>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={() => setUI({ showSettings: false })}>Close</button>
        </div>
      </div>
    </div>
  )
}
