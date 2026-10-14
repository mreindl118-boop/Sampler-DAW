/** MIDI 1 byte stream, including chunks, running status, real-time and SysEx. */
export class MidiStreamParser {
  private runningStatus = 0
  private pending: number[] = []
  private expected = 0
  private sysex: number[] | null = null
  private droppingSysex = false
  private readonly maxSysexBytes: number
  constructor(maxSysexBytes = 65536) { this.maxSysexBytes = maxSysexBytes }
  reset(): void { this.runningStatus = 0; this.pending = []; this.expected = 0; this.sysex = null; this.droppingSysex = false }
  push(bytes: unknown): number[][] {
    if (!(Array.isArray(bytes) || bytes instanceof Uint8Array)) return []
    const messages: number[][] = []
    for (const byte of bytes) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) { this.reset(); continue }
      // Real-time never interrupts a partially received message or running status.
      if (byte >= 0xf8) { if (byte !== 0xf9 && byte !== 0xfd) messages.push([byte]); continue }
      if (this.sysex || this.droppingSysex) {
        if (byte === 0xf7) {
          if (this.sysex) messages.push([...this.sysex, byte])
          this.sysex = null; this.droppingSysex = false; continue
        }
        if (byte < 0x80) {
          if (this.sysex) {
            if (this.sysex.length >= this.maxSysexBytes) { this.sysex = null; this.droppingSysex = true }
            else this.sysex.push(byte)
          }
          continue
        }
        // An unexpected status aborts a malformed SysEx, then starts fresh.
        this.sysex = null; this.droppingSysex = false
      }
      if (byte >= 0x80) {
        this.pending = []; this.expected = 0
        if (byte < 0xf0) {
          this.runningStatus = byte
          this.pending = [byte]
          this.expected = midiMessageLength(byte)
        } else {
          this.runningStatus = 0
          if (byte === 0xf0) this.sysex = [byte]
          else if (byte === 0xf6) messages.push([byte])
          else if (byte === 0xf1 || byte === 0xf2 || byte === 0xf3) { this.pending = [byte]; this.expected = midiMessageLength(byte) }
        }
        continue
      }
      if (!this.pending.length && this.runningStatus) { this.pending = [this.runningStatus]; this.expected = midiMessageLength(this.runningStatus) }
      if (!this.pending.length) continue // orphan data
      this.pending.push(byte)
      if (this.pending.length === this.expected) { messages.push(this.pending); this.pending = []; this.expected = 0 }
    }
    return messages
  }
}
export function midiMessageLength(status: number): number {
  if (status < 0x80 || status > 0xff) return 0
  if (status < 0xf0) return (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 2 : 3
  if (status === 0xf1 || status === 0xf3) return 2
  if (status === 0xf2) return 3
  return 1
}
export function validMidiMessage(data: ArrayLike<number>): boolean {
  const status = data[0]
  if (!Number.isInteger(status) || status < 0x80 || status > 255) return false
  if (status === 0xf0) return data.length >= 2 && data[data.length - 1] === 0xf7 && Array.from(data).slice(1, -1).every(isDataByte)
  return data.length === midiMessageLength(status) && Array.from(data).slice(1).every(isDataByte)
}
function isDataByte(byte: number): boolean { return Number.isInteger(byte) && byte >= 0 && byte < 128 }
