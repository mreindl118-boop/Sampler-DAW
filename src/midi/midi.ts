import { engine } from '../audio/engine'
import { getState, setUI } from '../state/store'
import { getSettings, updateSettings } from '../state/settings'
import { toast } from '../state/toasts'
import { MidiConnectionManager } from './connectionManager'
import { NativeMidiAdapter } from './nativeMidiAdapter'
import { WebMidiAdapter } from './webMidiAdapter'
import { validMidiMessage } from './streamParser'
import type { MidiPortInfo, MidiPreferences } from './types'
export type { MidiPortInfo, MidiStatus } from './types'

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

const native = new NativeMidiAdapter()
// A note retains the expression mode used when it began, even if UI mode changes.
const midiVoiceChannels = new Map<string, number>()
const midiManager = new MidiConnectionManager({
  adapter: native.supported ? native : new WebMidiAdapter(),
  onMessage: data => handleMidiMessage(data),
  onRelease: () => { engine.releaseLiveNotes(); midiVoiceChannels.clear() },
  now: () => performance.now(),
  loadPreferences: () => {
    try {
      const value = JSON.parse(localStorage.getItem('soundlab.midi.selection') ?? '{}') as MidiPreferences
      const valid = (selection: MidiPreferences['input']): boolean => selection === undefined || selection === null || (typeof selection.id === 'string' && typeof selection.name === 'string')
      return value && valid(value.input) && valid(value.output) ? value : {}
    } catch { return {} }
  },
  savePreferences: preferences => localStorage.setItem('soundlab.midi.selection', JSON.stringify(preferences)),
})
let displayedInputNames = ''
midiManager.subscribe(() => {
  const names = midiManager.getStatus().inputs.map(input => input.name)
  const signature = JSON.stringify(names)
  if (signature !== displayedInputNames) { displayedInputNames = signature; setUI({ midiInputs: names }) }
})

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
  if (!validMidiMessage(data)) return
  const status = data[0]
  if (status === undefined) return
  const type = status & 0xf0
  const channel = status & 0x0f // 0-based
  const { mpeEnabled } = getState().ui
  const voiceChannel = mpeEnabled ? channel : 0

  switch (type) {
    case 0x90: {
      const [, pitch, vel] = data
      const key = `${channel}:${pitch}`
      if (vel > 0) {
        const priorChannel = midiVoiceChannels.get(key)
        if (priorChannel !== undefined) engine.liveNoteOff(pitch, priorChannel)
        midiVoiceChannels.set(key, voiceChannel)
        engine.liveNoteOn(pitch, vel / 127, voiceChannel)
      } else {
        engine.liveNoteOff(pitch, midiVoiceChannels.get(key) ?? voiceChannel)
        midiVoiceChannels.delete(key)
      }
      break
    }
    case 0x80: {
      const key = `${channel}:${data[1]}`
      engine.liveNoteOff(data[1], midiVoiceChannels.get(key) ?? voiceChannel)
      midiVoiceChannels.delete(key)
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
  return midiManager.getStatus().outputs
}

export function midiInputsInfo(): MidiPortInfo[] {
  return midiManager.getStatus().inputs
}

/** Send raw bytes to an output, optionally scheduled at a DOMHighRes timestamp. */
export function sendMidi(outId: string, data: number[], atPerfTime?: number): void {
  midiManager.send(outId, data, atPerfTime)
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

export const initMidi = (): Promise<boolean> => midiManager.init()
export const connectMidi = (): Promise<boolean> => midiManager.connect()
export const enableMidiLights = (): Promise<boolean> => midiManager.enableLights()
export const connectNativeBluetooth = (): Promise<boolean> => midiManager.bluetooth()
export const disconnectMidi = (): void => midiManager.disconnect()
export const selectMidiInput = (id: string): void => midiManager.selectInput(id)
export const selectMidiOutput = (id: string): void => midiManager.selectOutput(id)
export const getMidiStatus = midiManager.getStatus
export const subscribeMidiStatus = midiManager.subscribe
export const midiSupported = (): boolean => midiManager.getStatus().supported

// Direct BLE uses the same selection, parsing, statistics and voice cleanup.
export const registerBleInput = (port: MidiPortInfo, options: { send?: (data: number[], at?: number) => void; close?: () => void }): void => {
  midiManager.attachExternal(port, options); midiManager.selectInput(port.id)
}
export const unregisterBleInput = (id: string): void => midiManager.detachExternal(id)
export const receiveBleMidi = (id: string, data: number[] | Uint8Array): void => midiManager.receive(id, data)
export const registerBleDisconnectCleanup = (cleanup: () => void): (() => void) => midiManager.addDisconnectCleanup(cleanup)
