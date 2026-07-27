import { handleMidiMessage } from './midi'

/**
 * Direct Web Bluetooth BLE-MIDI client (Chrome / Edge / Android).
 *
 * Most platforms surface OS-paired BLE MIDI devices through Web MIDI already
 * (iPadOS via Settings, macOS via Audio MIDI Setup, Android via MIDI BLE apps),
 * but Chrome can also connect straight to a BLE-MIDI peripheral without OS pairing.
 */

const MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700'
const MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3'

export function bleSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export async function connectBleMidi(onStatus: (s: string) => void): Promise<void> {
  const nav = navigator as Navigator & { bluetooth?: { requestDevice(opts: unknown): Promise<BluetoothDeviceLike> } }
  if (!nav.bluetooth) throw new Error('Web Bluetooth not supported in this browser')
  const device = await nav.bluetooth.requestDevice({
    filters: [{ services: [MIDI_SERVICE] }],
    optionalServices: [MIDI_SERVICE],
  })
  onStatus(`Connecting to ${device.name ?? 'BLE MIDI device'}…`)
  const server = await device.gatt!.connect()
  const service = await server.getPrimaryService(MIDI_SERVICE)
  const char = await service.getCharacteristic(MIDI_CHARACTERISTIC)
  await char.startNotifications()
  char.addEventListener('characteristicvaluechanged', (e: Event) => {
    const value = (e.target as unknown as { value: DataView }).value
    parseBlePacket(new Uint8Array(value.buffer))
  })
  onStatus(`Connected: ${device.name ?? 'BLE MIDI device'}`)
  device.addEventListener?.('gattserverdisconnected', () => onStatus('BLE MIDI disconnected'))
}

interface BluetoothDeviceLike {
  name?: string
  gatt?: {
    connect(): Promise<{
      getPrimaryService(id: string): Promise<{
        getCharacteristic(id: string): Promise<{
          startNotifications(): Promise<unknown>
          addEventListener(type: string, cb: (e: Event) => void): void
        }>
      }>
    }>
  }
  addEventListener?(type: string, cb: () => void): void
}

/**
 * BLE-MIDI packet: [header][timestamp][midi bytes…] with running status and
 * interleaved timestamp bytes (high bit set). We strip timestamps and feed
 * complete messages to the shared MIDI handler.
 */
function parseBlePacket(packet: Uint8Array): void {
  if (packet.length < 3) return
  let i = 1 // skip header
  let runningStatus = 0
  while (i < packet.length) {
    // timestamp byte(s) have the high bit set and precede status/messages
    if (packet[i] & 0x80) {
      i++
      if (i >= packet.length) break
      if (packet[i] & 0x80) {
        runningStatus = packet[i]
        i++
      }
    }
    if (runningStatus === 0) break
    const needed = messageLength(runningStatus)
    const dataBytes: number[] = []
    while (dataBytes.length < needed - 1 && i < packet.length && !(packet[i] & 0x80)) {
      dataBytes.push(packet[i])
      i++
    }
    if (dataBytes.length === needed - 1) {
      handleMidiMessage([runningStatus, ...dataBytes])
    }
  }
}

function messageLength(status: number): number {
  const type = status & 0xf0
  if (type === 0xc0 || type === 0xd0) return 2
  return 3
}
