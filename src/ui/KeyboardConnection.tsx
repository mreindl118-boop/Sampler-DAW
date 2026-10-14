import { useEffect, useState, useSyncExternalStore } from 'react'
import { engine } from '../audio/engine'
import {
  connectMidi, connectNativeBluetooth, disconnectMidi, enableMidiLights, getMidiStatus,
  selectMidiInput, selectMidiOutput, subscribeMidiStatus,
} from '../midi/midi'
import { bleSupported, connectBleMidi } from '../midi/bleMidi'

export function keyboardPlatform(): 'ipad' | 'android' | 'windows' | 'mac' | 'linux' | 'other' {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad'
  if (/Android/.test(ua)) return 'android'
  if (/Windows/.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Linux/.test(ua)) return 'linux'
  return 'other'
}

function KeyboardHelp({ platform }: { platform: ReturnType<typeof keyboardPlatform> }) {
  return <div className="keyboard-help">
    <p>Use a USB <b>data cable</b>, turn the keyboard on, then tap <b>Connect keyboard</b> once.
      Allow MIDI when asked. SoundLAB remembers your keyboard and reconnects when it returns.</p>
    {platform === 'windows' && <>
      <p>For LUMI on Windows, start with USB. A Bluetooth entry in Settings can exist without a usable MIDI connection.</p>
      <details>
        <summary>Windows recognizes LUMI, but no keys reach the app</summary>
        <p>If Device Manager reports <b>Code 10 / STATUS_DEVICE_DATA_ERROR</b> for the LUMI, the driver needs attention.</p>
        <ol>
          <li>Open Device Manager → <b>Sound, video and game controllers</b>.</li>
          <li>Find your LUMI. It may be called <b>USB Audio Device</b>; use <b>View → Show hidden devices</b> if it disappears.
            Confirm that it is the keyboard before changing its driver. LUMI hardware IDs contain <code>VID_2AF4&amp;PID_0E00</code>.</li>
          <li>Choose <b>Update driver → Browse my computer → Let me pick from a list</b>.</li>
          <li>Select <b>USBMidi2-ACX → Next</b>. If needed, unplug, restart Windows, reconnect, and tap Connect keyboard.</li>
        </ol>
        <p>The alternative driver is already included in current Windows MIDI Services installations.
          If it is unavailable or does not work with your device, use Microsoft's guidance.
          You can select <b>USB Audio Device</b> through the same list to restore it.</p>
        <a href="https://microsoft.github.io/MIDI/kb/how-to-switch-between-class-drivers/" target="_blank" rel="noreferrer">Microsoft's MIDI driver instructions ↗</a>
      </details>
    </>}
    {platform === 'ipad' && <p>Safari and Home Screen web apps cannot read a hardware MIDI keyboard.
      Use the <b>SoundLAB native iPad build</b> for USB MIDI or its Bluetooth MIDI chooser.
      The on-screen piano works in Safari. A powered USB adapter may be needed for your keyboard.</p>}
    {platform === 'android' && <p>Use Chrome for browser MIDI, or the native Android build for USB and its Bluetooth MIDI chooser.
      Your phone or tablet must support USB host mode; a USB-C adapter or powered hub may be needed.</p>}
    {platform === 'mac' && <p>Use Chrome or Edge for browser MIDI, or the desktop app.
      For Bluetooth keyboards, connect through <b>Audio MIDI Setup → MIDI Studio → Bluetooth</b>.
      Safari hardware MIDI needs a native build.</p>}
    {platform === 'linux' && <p>Use Chromium or Chrome, or the desktop app. Your keyboard must appear in the system's ALSA MIDI devices.
      If a Flatpak or Snap package hides USB/MIDI devices, use a package with access to those devices.</p>}
    <p>Blue flashing on a LUMI means it is searching for Bluetooth; it is not proof that USB MIDI is connected.
      SoundLAB's keyboard indicator and note readout show what the app actually receives.</p>
  </div>
}

export function KeyboardConnection({ expanded = false }: { expanded?: boolean }) {
  const midi = useSyncExternalStore(subscribeMidiStatus, getMidiStatus, getMidiStatus)
  const [busy, setBusy] = useState(false)
  const [soundOn, setSoundOn] = useState(engine.ctx?.state === 'running')
  const [feedback, setFeedback] = useState('')
  const platform = keyboardPlatform()
  const ctx = engine.ctx
  useEffect(() => {
    const sync = () => setSoundOn(ctx?.state === 'running')
    sync()
    ctx?.addEventListener('statechange', sync)
    return () => ctx?.removeEventListener('statechange', sync)
  }, [ctx])
  const selected = midi.inputs.find(p => p.id === midi.selectedInputId)
  const ready = midi.phase === 'connected'
  const titles = {
    idle: 'Connect your keyboard', connecting: 'Connecting keyboard…', connected: selected?.name ?? 'Keyboard connected',
    waiting: 'Waiting for your keyboard', denied: 'MIDI access needs permission', unsupported: 'Hardware MIDI needs a supported app',
    error: 'Keyboard connection needs attention',
  }
  const enableSound = async () => {
    try {
      const context = engine.ensure()
      await context.resume()
      setSoundOn(context.state === 'running')
    } catch { setFeedback('Sound is paused. Tap Enable sound again to resume it.') }
  }
  const connect = async () => {
    setBusy(true)
    setFeedback('')
    const sound = enableSound()
    try { await connectMidi(); await sound } finally { setBusy(false) }
  }
  const bluetooth = async () => {
    setBusy(true)
    setFeedback('')
    void enableSound()
    try {
      if (midi.transport === 'native') await connectNativeBluetooth()
      else await connectBleMidi(setFeedback)
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Bluetooth connection did not finish.') }
    finally { setBusy(false) }
  }
  return <details className={`keyboard-connection ${ready ? 'keyboard-ready' : ''}`} open={expanded || undefined}>
    <summary>
      <span className="keyboard-dot" />
      <strong>KEYBOARD</strong>
      <span className="keyboard-title">{titles[midi.phase]}</span>
      {ready && <span className="keyboard-signal">{soundOn ? 'Sound ready' : 'Tap to enable sound'}</span>}
      {ready && !soundOn && <button className="small active" onClick={e => { e.preventDefault(); void enableSound() }}>Enable sound</button>}
      <span className="keyboard-expand">Setup</span>
    </summary>
    <div className="keyboard-body">
      <div className="keyboard-actions">
        <button className="active" disabled={busy || !midi.supported} onClick={() => void connect()}>
          {busy ? 'Connecting…' : ready ? 'Reconnect keyboard' : 'Connect keyboard'}
        </button>
        <button onClick={() => void enableSound()}>{soundOn ? 'Sound enabled' : 'Enable sound'}</button>
        {(midi.transport === 'native' || (bleSupported() && platform !== 'windows')) &&
          <button disabled={busy} onClick={() => void bluetooth()}>Bluetooth MIDI…</button>}
        {ready && <button onClick={disconnectMidi}>Disconnect</button>}
      </div>
      <div className="keyboard-selects">
        <label>Keyboard input
          <select aria-label="Keyboard input" value={midi.selectedInputId ?? ''} onChange={e => selectMidiInput(e.target.value)}>
            <option value="">{midi.inputs.length ? 'Choose a keyboard' : 'No MIDI input yet'}</option>
            {midi.inputs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Keyboard output
          <select aria-label="Keyboard output" value={midi.selectedOutputId ?? ''} onChange={e => selectMidiOutput(e.target.value)}>
            <option value="">No keyboard output</option>
            {midi.outputs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="keyboard-readout" aria-live="polite">
        {ready && midi.lastNote ? `Last note: ${midi.lastNote.pitch} · velocity ${midi.lastNote.velocity} · channel ${midi.lastNote.channel + 1}`
          : ready ? 'Play a key to test the connection.' : 'No key messages received yet.'}
      </div>
      {midi.selectedOutputId && <div className="keyboard-light-permission">
        <button disabled={busy || midi.sysexEnabled} onClick={() => void enableMidiLights()}>
          {midi.sysexEnabled ? 'Advanced keyboard output enabled' : 'Allow advanced keyboard output'}
        </button>
        <span className="hint">Optional permission for device settings and key lights. Note input keeps working if declined.</span>
      </div>}
      {(feedback || midi.error || midi.lightsError) && <p className="keyboard-feedback" role="status">{feedback || midi.error || midi.lightsError}</p>}
      <KeyboardHelp platform={platform} />
    </div>
  </details>
}
