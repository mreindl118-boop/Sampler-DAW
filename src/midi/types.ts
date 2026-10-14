export type MidiTransport = 'web' | 'native' | 'ble'
export interface MidiPortInfo { id: string; name: string; manufacturer?: string; state?: 'connected' | 'disconnected'; connection?: 'open' | 'closed' | 'pending' }
export interface MidiPorts { inputs: MidiPortInfo[]; outputs: MidiPortInfo[] }
export interface MidiStatus extends MidiPorts {
  phase: 'idle' | 'connecting' | 'connected' | 'waiting' | 'denied' | 'unsupported' | 'error'
  transport: MidiTransport | null
  supported: boolean
  selectedInputId: string | null
  selectedOutputId: string | null
  sysexEnabled: boolean
  messageCount: number
  lastMessageAt: number | null
  lastNote: { pitch: number; velocity: number; channel: number; at: number } | null
  error: string | null
  lightsError: string | null
}
export type MidiAdapterEvent =
  | ({ type: 'ports' } & MidiPorts)
  | { type: 'message'; inputId: string; data: number[] | Uint8Array; timestamp?: number }
  | { type: 'error'; message: string; recoverable?: boolean; inputId?: string }
export interface MidiConnectResult extends MidiPorts { granted: boolean; sysexEnabled: boolean }
export interface MidiAdapter {
  readonly kind: MidiTransport
  readonly supported: boolean
  connect(options: { sysex: boolean; restoreOnly: boolean }): Promise<MidiConnectResult>
  subscribe(listener: (event: MidiAdapterEvent) => void): () => void
  disconnect(): void
  send(id: string, data: number[], timestamp?: number): void
  selectInput?(id: string | null): Promise<boolean>
  bluetooth?(): void
}
export interface MidiSelection { id: string; name: string; manufacturer?: string }
export interface MidiPreferences { input?: MidiSelection | null; output?: MidiSelection | null }
