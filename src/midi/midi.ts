import { engine } from '../audio/engine'
import { getState, setUI } from '../state/store'
import { getSettings, updateSettings } from '../state/settings'
import { toast } from '../state/toasts'

/**
 * Web MIDI input & output with MPE support (ROLI Seaboard / BLOCKS, LinnStrument…)
 * and controller integration for outboard gear like the Line 6 Helix Stadium XL:
 *
 *  - Inbound: notes/expression to instruments, plus MIDI-learn so footswitch
 *    CC/PC messages drive the transport (play/stop/record/loop/markers/undo).
 *  - Outbound: per-track note routing to hardware ports, marker-triggered
 *    Program Change / CC (preset & snapshot switching), and MIDI clock (24 PPQN)
 *    at the project tempo so tempo-synced effects follow the session.
 *
 * Bluetooth MIDI controllers appear here automatically once paired at the OS
 * level; Chrome also exposes BLE-MIDI directly — see bleMidi.ts.
 */

export interface MidiPortInfo {
  id: string
  name: string
}

let access: MIDIAccess | null = null

// ---------- MIDI learn ----------

let learnTarget: string | null = null
let learnResolve: ((mapping: string) => void) | null = null

export function startMidiLearn(action: string): Promise<string> {
  learnTarget = action
  return new Promise((resolve) => {
    learnResolve = resolve
  })
}

export function cancelMidiLearn(): void {
  learnTarget = null
  learnResolve = null
}

function tryLearn(key: string): boolean {
  if (!learnTarget) return false
  const map = { ...getSettings().midiMap }
  // remove existing binding of this key or of this action
  for (const k of Object.keys(map)) if (map[k] === learnTarget || k === key) delete map[k]
  map[key] = learnTarget
  updateSettings({ midiMap: map })
  toast(`Mapped ${key.toUpperCase()} → ${learnTarget}`, 'info')
  learnResolve?.(key)
  learnTarget = null
  learnResolve = null
  return true
}

// transport actions are injected to avoid circular imports
let actionHandlers: Record<string, () => void> = {}
export function registerMidiActions(handlers: Record<string, () => void>): void {
  actionHandlers = handlers
}

function runMapped(key: string): boolean {
  const action = getSettings().midiMap[key]
  if (action && actionHandlers[action]) {
    actionHandlers[action]()
    return true
  }
  return false
}

// ---------- inbound ----------

export function handleMidiMessage(data: Uint8Array | number[]): void {
  const status = data[0]
  if (status === undefined) return
  const type = status & 0xf0
  const channel = status & 0x0f // 0-based
  const { mpeEnabled } = getState().ui
  const voiceChannel = mpeEnabled ? channel : 0

  switch (type) {
    case 0x90: {
      const [, pitch, vel] = data
      if (vel > 0) engine.liveNoteOn(pitch, vel / 127, voiceChannel)
      else engine.liveNoteOff(pitch, voiceChannel)
      break
    }
    case 0x80: {
      engine.liveNoteOff(data[1], voiceChannel)
      break
    }
    case 0xe0: {
      const value = ((data[2] << 7) | data[1]) - 8192
      const range = mpeEnabled && channel !== 0 ? getBendRange() : 2
      engine.livePitchBend((value / 8192) * range, voiceChannel)
      break
    }
    case 0xd0: {
      engine.livePressure(data[1] / 127, voiceChannel)
      break
    }
    case 0xa0: {
      engine.livePressure(data[2] / 127, voiceChannel)
      break
    }
    case 0xc0: {
      // Program Change — learnable, otherwise ignored
      if (tryLearn(`pc:${data[1]}`)) break
      runMapped(`pc:${data[1]}`)
      break
    }
    case 0xb0: {
      const cc = data[1]
      const value = data[2]
      // MIDI-learn / mapped transport controls first (footswitches send momentary CCs)
      if (value >= 64 && tryLearn(`cc:${cc}`)) break
      if (value >= 64 && runMapped(`cc:${cc}`)) break
      if (cc === 74) engine.liveTimbre(value / 127, voiceChannel) // MPE slide
      break
    }
  }
}

function getBendRange(): number {
  const { project, ui } = getState()
  const track =
    project.tracks.find((t) => t.armed && t.kind === 'synth') ??
    project.tracks.find((t) => t.id === ui.selectedTrackId && t.kind === 'synth')
  return track?.synth?.bendRange ?? 48
}

// ---------- outbound ----------

export function midiOutputs(): MidiPortInfo[] {
  const out: MidiPortInfo[] = []
  access?.outputs.forEach((o) => out.push({ id: o.id, name: `${o.name ?? 'MIDI out'}${o.manufacturer ? ` (${o.manufacturer})` : ''}` }))
  return out
}

export function midiInputsInfo(): MidiPortInfo[] {
  const out: MidiPortInfo[] = []
  access?.inputs.forEach((i) => out.push({ id: i.id, name: i.name ?? 'MIDI in' }))
  return out
}

/** Send raw bytes to an output, optionally scheduled at a DOMHighRes timestamp. */
export function sendMidi(outId: string, data: number[], atPerfTime?: number): void {
  if (!access) return
  const port = access.outputs.get(outId)
  if (!port) return
  try {
    if (atPerfTime !== undefined) port.send(data, atPerfTime)
    else port.send(data)
  } catch {
    /* invalid data / closed port */
  }
}

export function sendProgramChange(outId: string, channel: number, program: number, atPerfTime?: number): void {
  sendMidi(outId, [0xc0 | (channel & 0x0f), program & 0x7f], atPerfTime)
}

export function sendControlChange(outId: string, channel: number, cc: number, value: number, atPerfTime?: number): void {
  sendMidi(outId, [0xb0 | (channel & 0x0f), cc & 0x7f, value & 0x7f], atPerfTime)
}

export function sendNoteOn(outId: string, channel: number, pitch: number, vel: number, atPerfTime?: number): void {
  sendMidi(outId, [0x90 | (channel & 0x0f), pitch & 0x7f, Math.max(1, Math.min(127, Math.round(vel * 127)))], atPerfTime)
}

export function sendNoteOff(outId: string, channel: number, pitch: number, atPerfTime?: number): void {
  sendMidi(outId, [0x80 | (channel & 0x0f), pitch & 0x7f, 0], atPerfTime)
}

export const MIDI_CLOCK = 0xf8
export const MIDI_START = 0xfa
export const MIDI_CONTINUE = 0xfb
export const MIDI_STOP = 0xfc

export function sendRealtime(outId: string, byte: number, atPerfTime?: number): void {
  sendMidi(outId, [byte], atPerfTime)
}

// ---------- setup ----------

function refreshInputs(): void {
  if (!access) return
  const names: string[] = []
  access.inputs.forEach((input) => {
    names.push(`${input.name ?? 'MIDI device'}${input.manufacturer ? ` (${input.manufacturer})` : ''}`)
    input.onmidimessage = (e: MIDIMessageEvent) => {
      if (e.data) handleMidiMessage(e.data)
    }
  })
  setUI({ midiInputs: names })
}

export async function initMidi(): Promise<boolean> {
  if (!('requestMIDIAccess' in navigator)) return false
  try {
    access = await navigator.requestMIDIAccess({ sysex: false })
    refreshInputs()
    access.onstatechange = () => refreshInputs()
    return true
  } catch {
    return false
  }
}

export function midiSupported(): boolean {
  return 'requestMIDIAccess' in navigator
}
