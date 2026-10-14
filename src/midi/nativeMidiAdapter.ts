import type { MidiAdapter, MidiAdapterEvent, MidiConnectResult, MidiPortInfo, MidiPorts } from './types.ts'
export interface NativeMidiEnvironment { events: EventTarget; post(message: Record<string, unknown>): void }
interface NativeHostWindow extends Window {
  webkit?: { messageHandlers?: { soundlabMidi?: { postMessage(message: unknown): void } } }
  SoundLabMidi?: { postMessage(message: string): void }
}
export function nativeMidiEnvironment(): NativeMidiEnvironment | undefined {
  if (typeof window === 'undefined') return undefined
  const host = window as NativeHostWindow
  if (host.webkit?.messageHandlers?.soundlabMidi) return { events: host, post: message => host.webkit!.messageHandlers!.soundlabMidi!.postMessage(message) }
  if (host.SoundLabMidi) return { events: host, post: message => host.SoundLabMidi!.postMessage(JSON.stringify(message)) }
  return undefined
}
function ports(value: unknown): MidiPortInfo[] | null {
  if (!Array.isArray(value) || value.length > 1024) return null
  const result: MidiPortInfo[] = [], ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const p = item as Record<string, unknown>
    if (typeof p.id !== 'string' || !p.id || p.id.length > 512 || typeof p.name !== 'string' || p.name.length > 1024 || p.state !== 'connected' || ids.has(p.id)) continue
    ids.add(p.id); result.push({ id: p.id, name: p.name, manufacturer: typeof p.manufacturer === 'string' ? p.manufacturer : undefined, state: 'connected' })
  }
  return result
}
export class NativeMidiAdapter implements MidiAdapter {
  readonly kind = 'native' as const
  readonly supported: boolean
  private readonly environment: NativeMidiEnvironment | undefined
  private installed = false
  private available: MidiPorts = { inputs: [], outputs: [] }
  private readonly listeners = new Set<(event: MidiAdapterEvent) => void>()
  constructor(environment = nativeMidiEnvironment()) { this.environment = environment; this.supported = !!environment }
  subscribe(listener: (event: MidiAdapterEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(event: MidiAdapterEvent): void { for (const listener of this.listeners) listener(event) }
  private readonly receive = (event: Event): void => {
    let detail: unknown = (event as CustomEvent).detail
    if (typeof detail === 'string') { if (detail.length > 1048576) return; try { detail = JSON.parse(detail) } catch { return } }
    if (!detail || typeof detail !== 'object') return
    const message = detail as Record<string, unknown>
    if (message.type === 'ports') {
      const inputs = ports(message.inputs), outputs = ports(message.outputs)
      if (!inputs || !outputs) return
      this.available = { inputs, outputs }; this.emit({ type: 'ports', ...this.available })
    } else if (message.type === 'message') {
      if (typeof message.inputId !== 'string' || !this.available.inputs.some(p => p.id === message.inputId)) return
      if (!(Array.isArray(message.data) || message.data instanceof Uint8Array) || message.data.length > 65536 || !Array.from(message.data).every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return
      this.emit({ type: 'message', inputId: message.inputId, data: Array.from(message.data), timestamp: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) ? message.timestamp : undefined })
    } else if (message.type === 'error' && typeof message.message === 'string') {
      this.emit({ type: 'error', message: message.message.slice(0, 4096), recoverable: message.recoverable === true })
    }
  }
  async connect(options: { sysex: boolean; restoreOnly: boolean }): Promise<MidiConnectResult> {
    if (!this.environment) return { inputs: [], outputs: [], granted: false, sysexEnabled: false }
    if (!this.installed) {
      // Native may respond synchronously, so the listener must be present first.
      this.environment.events.addEventListener('soundlab-midi', this.receive); this.installed = true
    }
    // Native start is idempotent and also retries a previous client/port failure.
    if (!options.sysex || !this.available.inputs.length) {
      try { this.environment.post({ action: 'start' }) } catch (error) { this.disconnect(); throw error }
    }
    return { ...this.available, granted: true, sysexEnabled: true }
  }
  disconnect(): void {
    if (!this.installed) return
    this.environment?.events.removeEventListener('soundlab-midi', this.receive); this.installed = false
    this.available = { inputs: [], outputs: [] }
    try { this.environment?.post({ action: 'stop' }) } catch { /* native host shutting down */ }
  }
  send(id: string, data: number[], timestamp?: number): void {
    if (!this.installed || !this.available.outputs.some(p => p.id === id)) return
    this.environment?.post({ action: 'send', id, data, ...(timestamp === undefined ? {} : { timestamp }) })
  }
  bluetooth(): void { if (this.installed) this.environment?.post({ action: 'bluetooth' }) }
}
