import { midiMessageLength, validMidiMessage } from './streamParser.ts'
/** BLE MIDI 1: running status is packet-local; only SysEx spans packets. */
export class BleMidiPacketParser {
  private sysex: number[] | null = null
  reset(): void { this.sysex = null }
  push(packet: Uint8Array): number[][] {
    const messages: number[][] = []
    if (packet.length < 2 || !(packet[0] & 0x80) || (packet[0] & 0x40)) { this.reset(); return messages }
    let i = 1, running = 0
    while (i < packet.length) {
      if (this.sysex && packet[i] < 0x80) {
        if (this.sysex.length >= 65536) { this.reset(); return messages }
        this.sysex.push(packet[i++]); continue
      }
      let status = running
      if (packet[i] & 0x80) {
        i++ // timestamp-low, before each new status (including EOX/realtime)
        if (i >= packet.length) break
        if (packet[i] & 0x80) status = packet[i++]
      }
      if (status >= 0xf8) { if (status !== 0xf9 && status !== 0xfd) messages.push([status]); continue }
      if (status === 0xf7) {
        if (this.sysex) messages.push([...this.sysex, 0xf7])
        this.sysex = null; running = 0; continue
      }
      if (status === 0xf0) { this.sysex = [0xf0]; running = 0; continue }
      if (this.sysex) this.sysex = null
      if (!status) { i++; continue }
      if (status < 0xf0) running = status
      else running = 0
      if (status === 0xf4 || status === 0xf5) continue
      const message = [status], length = midiMessageLength(status)
      while (message.length < length && i < packet.length) {
        if (packet[i] < 0x80) message.push(packet[i++])
        else if (i + 1 < packet.length && packet[i + 1] >= 0xf8) {
          const realtime = packet[i + 1]; if (realtime !== 0xf9 && realtime !== 0xfd) messages.push([realtime]); i += 2
        } else break
      }
      if (message.length === length && validMidiMessage(message)) messages.push(message)
    }
    return messages
  }
}
/** Conservative default ATT payload of20bytes, preserving SysEx continuation. */
export function encodeBleMidi(data: number[], milliseconds: number): Uint8Array[] {
  if (!validMidiMessage(data)) return []
  const stamp = Math.floor(Math.max(0, milliseconds)) & 0x1fff
  const header = 0x80 | ((stamp >> 7) & 0x3f), low = 0x80 | (stamp & 0x7f)
  if (data[0] !== 0xf0) return [Uint8Array.from([header, low, ...data])]
  const chunks: Uint8Array[] = []
  const payload = data.slice(1, -1)
  // Five framing bytes are needed if the first packet also contains EOX.
  if (payload.length <= 15) return [Uint8Array.from([header, low, 0xf0, ...payload, low, 0xf7])]
  chunks.push(Uint8Array.from([header, low, 0xf0, ...payload.splice(0, 17)]))
  while (payload.length > 17) chunks.push(Uint8Array.from([header, ...payload.splice(0, 19)]))
  chunks.push(Uint8Array.from([header, ...payload, low, 0xf7]))
  return chunks
}
