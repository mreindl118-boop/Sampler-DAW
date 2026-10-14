import { receiveBleMidi, registerBleDisconnectCleanup, registerBleInput, unregisterBleInput } from './midi'
import { BleMidiPacketParser, encodeBleMidi } from './blePacketParser'
const MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700'
const MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3'
interface Characteristic extends EventTarget {
  value?: DataView
  properties?: { writeWithoutResponse?: boolean; write?: boolean }
  startNotifications(): Promise<unknown>
  stopNotifications?(): Promise<unknown>
  writeValueWithoutResponse?(data: Uint8Array<ArrayBuffer>): Promise<void>
  writeValueWithResponse?(data: Uint8Array<ArrayBuffer>): Promise<void>
}
interface BluetoothDeviceLike extends EventTarget {
  id?: string; name?: string
  gatt?: { connected?: boolean; disconnect(): void; connect(): Promise<{ getPrimaryService(id: string): Promise<{ getCharacteristic(id: string): Promise<Characteristic> }> }> }
}
let pending: Promise<void> | null = null
let closeCurrent: (() => void) | null = null
let connectionGeneration = 0
export function bleSupported(): boolean { return typeof navigator !== 'undefined' && 'bluetooth' in navigator }
export function disconnectBleMidi(): void { connectionGeneration++; closeCurrent?.(); closeCurrent = null }
export function connectBleMidi(onStatus: (status: string) => void): Promise<void> {
  if (pending) return pending
  if (closeCurrent) { onStatus('BLE MIDI is connected'); return Promise.resolve() }
  const attempt = ++connectionGeneration
  const task = connect(attempt, onStatus)
  pending = task
  void task.finally(() => { if (pending === task) pending = null }).catch(() => {})
  return task
}
async function connect(attempt: number, onStatus: (status: string) => void): Promise<void> {
  const nav = navigator as Navigator & { bluetooth?: { requestDevice(options: unknown): Promise<BluetoothDeviceLike> } }
  if (!nav.bluetooth) throw new Error('Direct Bluetooth MIDI is unavailable in this browser. Use native Bluetooth or USB MIDI.')
  let device: BluetoothDeviceLike | undefined, characteristic: Characteristic | undefined, id = '', closed = false
  const parser = new BleMidiPacketParser(), timers = new Set<ReturnType<typeof setTimeout>>()
  let writes = Promise.resolve()
  const cleanup = (): void => {
    if (closed) return
    closed = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear(); parser.reset()
    characteristic?.removeEventListener('characteristicvaluechanged', receive)
    device?.removeEventListener('gattserverdisconnected', disconnected)
    try { device?.gatt?.disconnect() } catch { /* gone */ }
    if (id) unregisterBleInput(id)
    if (closeCurrent === cleanup) closeCurrent = null
    removeDisconnectCleanup()
  }
  const removeDisconnectCleanup = registerBleDisconnectCleanup(() => { connectionGeneration++; cleanup() })
  const ensureCurrent = (): void => { if (closed || attempt !== connectionGeneration) throw new DOMException('Bluetooth connection canceled', 'AbortError') }
  const receive = (event: Event): void => {
    if (closed || !id) return
    const value = (event.target as Characteristic).value
    if (!value) return
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    for (const message of parser.push(bytes)) receiveBleMidi(id, message)
  }
  const disconnected = (): void => { cleanup(); onStatus('BLE MIDI disconnected. Reconnect when the keyboard is ready.') }
  try {
    device = await nav.bluetooth.requestDevice({ filters: [{ services: [MIDI_SERVICE] }], optionalServices: [MIDI_SERVICE] })
    ensureCurrent()
    if (!device.gatt) throw new Error('The keyboard did not expose a Bluetooth MIDI connection.')
    onStatus(`Connecting to ${device.name ?? 'BLE MIDI device'}…`)
    device.addEventListener('gattserverdisconnected', disconnected)
    const server = await device.gatt.connect(); ensureCurrent()
    const service = await server.getPrimaryService(MIDI_SERVICE); ensureCurrent()
    characteristic = await service.getCharacteristic(MIDI_CHARACTERISTIC); ensureCurrent()
    id = `ble:${device.id ?? device.name ?? 'keyboard'}`
    const canWrite = !!(characteristic.properties?.writeWithoutResponse && characteristic.writeValueWithoutResponse) || !!(characteristic.properties?.write && characteristic.writeValueWithResponse)
    const send = canWrite ? (data: number[], at?: number): void => {
      const write = (): void => {
        if (closed) return
        const packets = encodeBleMidi(data, performance.now())
        writes = writes.then(async () => {
          for (const packet of packets) {
            if (closed) return
            const bytes = new Uint8Array(packet)
            if (characteristic!.properties?.writeWithoutResponse && characteristic!.writeValueWithoutResponse) await characteristic!.writeValueWithoutResponse(bytes)
            else await characteristic!.writeValueWithResponse!(bytes)
          }
        }).catch(() => { if (!closed) onStatus('BLE MIDI output failed. Reconnect the keyboard.') })
      }
      const delay = Number.isFinite(at) ? Math.max(0, Math.min(5000, at! - performance.now())) : 0
      if (!delay) write()
      else { const timer = setTimeout(() => { timers.delete(timer); write() }, delay); timers.add(timer) }
    } : undefined
    closeCurrent = cleanup
    registerBleInput({ id, name: device.name ?? 'BLE MIDI keyboard', state: 'connected' }, { close: cleanup, send })
    characteristic.addEventListener('characteristicvaluechanged', receive)
    await characteristic.startNotifications(); ensureCurrent()
    onStatus(`Connected: ${device.name ?? 'BLE MIDI device'}`)
  } catch (error) { cleanup(); throw error }
}
