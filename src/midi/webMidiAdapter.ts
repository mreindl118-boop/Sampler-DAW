import type { MidiAdapter, MidiAdapterEvent, MidiConnectResult, MidiPortInfo } from './types.ts'
interface MidiNavigator {
  requestMIDIAccess?: (options?: MIDIOptions) => Promise<MIDIAccess>
  permissions?: { query(descriptor: PermissionDescriptor): Promise<PermissionStatus> }
}
const unavailable = (): MidiConnectResult => ({ granted: false, sysexEnabled: false, inputs: [], outputs: [] })

export class WebMidiAdapter implements MidiAdapter {
  readonly kind = 'web' as const
  readonly supported: boolean
  private readonly navigator: MidiNavigator | undefined
  private access: MIDIAccess | null = null
  private generation = 0
  private readonly listeners = new Set<(event: MidiAdapterEvent) => void>()
  private readonly attached = new Map<MIDIInput, (event: MIDIMessageEvent) => void>()
  constructor(nav: MidiNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator) {
    this.navigator = nav; this.supported = typeof nav?.requestMIDIAccess === 'function'
  }
  subscribe(listener: (event: MidiAdapterEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(event: MidiAdapterEvent): void { for (const listener of this.listeners) listener(event) }
  private readonly stateChanged = (): void => { this.refresh() }
  private info(port: MIDIPort): MidiPortInfo { return { id: port.id, name: port.name ?? 'MIDI device', manufacturer: port.manufacturer ?? undefined, state: 'connected' } }
  private refresh(): MidiConnectResult {
    const inputs: MidiPortInfo[] = [], outputs: MidiPortInfo[] = []
    const active = new Set<MIDIInput>()
    this.access?.inputs.forEach(input => {
      if (input.state !== 'connected') return
      inputs.push(this.info(input)); active.add(input)
      if (!this.attached.has(input)) {
        const listener = (event: MIDIMessageEvent): void => { if (event.data && input.state === 'connected') this.emit({ type: 'message', inputId: input.id, data: event.data, timestamp: event.timeStamp }) }
        input.addEventListener('midimessage', listener); this.attached.set(input, listener)
      }
    })
    for (const [input, listener] of this.attached) if (!active.has(input)) { input.removeEventListener('midimessage', listener); this.attached.delete(input) }
    this.access?.outputs.forEach(output => { if (output.state === 'connected') outputs.push(this.info(output)) })
    this.emit({ type: 'ports', inputs, outputs })
    return { inputs, outputs, granted: !!this.access, sysexEnabled: this.access?.sysexEnabled ?? false }
  }
  private detach(): void {
    this.access?.removeEventListener('statechange', this.stateChanged)
    for (const [input, listener] of this.attached) input.removeEventListener('midimessage', listener)
    this.attached.clear()
  }
  async connect(options: { sysex: boolean; restoreOnly: boolean }): Promise<MidiConnectResult> {
    if (!this.navigator?.requestMIDIAccess) return unavailable()
    if (this.access && (!options.sysex || this.access.sysexEnabled)) return this.refresh()
    const generation = ++this.generation
    if (options.restoreOnly) {
      if (!this.navigator.permissions) return unavailable()
      try {
        const permission = await this.navigator.permissions.query({ name: 'midi', sysex: false } as unknown as PermissionDescriptor)
        if (permission.state !== 'granted' || generation !== this.generation) return unavailable()
      } catch { return unavailable() }
    }
    // A denied optional SysEx request never removes the existing notes access.
    const access = await this.navigator.requestMIDIAccess({ sysex: options.sysex })
    if (generation !== this.generation) return unavailable()
    this.detach(); this.access = access
    access.addEventListener('statechange', this.stateChanged)
    return this.refresh()
  }
  disconnect(): void {
    this.generation++
    const access = this.access
    this.detach(); this.access = null
    access?.inputs.forEach(input => { void input.close().catch(() => {}) })
    access?.outputs.forEach(output => { void output.close().catch(() => {}) })
  }
  send(id: string, data: number[], timestamp?: number): void {
    const output = this.access?.outputs.get(id)
    if (output?.state === 'connected') output.send(data, timestamp)
  }
}
