import { engine } from '../audio/engine'
import { getState, setUI } from '../state/store'

/**
 * Web MIDI input with MPE support (ROLI Seaboard / BLOCKS, LinnStrument, etc).
 *
 * MPE lower zone: channel 1 (index 0) is the master channel; channels 2-16
 * carry one note each with per-note pitch bend (±48 semitones default),
 * channel pressure (strike/press) and CC74 (slide / timbre).
 *
 * Bluetooth MIDI controllers appear here automatically once paired at the OS
 * level (iPadOS/macOS/Android); Chrome also exposes BLE-MIDI directly — see bleMidi.ts.
 */

export interface MidiDeviceInfo {
  id: string
  name: string
  manufacturer: string
}

let access: MIDIAccess | null = null

export function handleMidiMessage(data: Uint8Array | number[]): void {
  const status = data[0]
  if (status === undefined) return
  const type = status & 0xf0
  const channel = status & 0x0f // 0-based
  const { mpeEnabled } = getState().ui
  // In MPE mode note channels are 2-16 (index 1-15); we keep the channel so
  // per-note expression reaches only that voice. Non-MPE collapses to 0.
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
      // pitch bend: 14-bit
      const value = ((data[2] << 7) | data[1]) - 8192
      const range = mpeEnabled && channel !== 0 ? getBendRange() : 2
      engine.livePitchBend((value / 8192) * range, voiceChannel)
      break
    }
    case 0xd0: {
      // channel pressure (ROLI "press")
      engine.livePressure(data[1] / 127, voiceChannel)
      break
    }
    case 0xa0: {
      // poly aftertouch
      engine.livePressure(data[2] / 127, voiceChannel)
      break
    }
    case 0xb0: {
      const cc = data[1]
      const value = data[2]
      if (cc === 74) engine.liveTimbre(value / 127, voiceChannel) // MPE slide
      if (cc === 64) {
        /* sustain pedal — future */
      }
      if (cc === 120 || cc === 123) {
        /* all notes off */
      }
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
