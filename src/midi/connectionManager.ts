import { MidiStreamParser } from './streamParser.ts'
import type { MidiAdapter, MidiAdapterEvent, MidiPortInfo, MidiPorts, MidiPreferences, MidiSelection, MidiStatus, MidiTransport } from './types.ts'

interface ManagerOptions {
  adapter: MidiAdapter
  onMessage(data: number[], inputId: string): void
  onRelease?(inputId: string): void
  loadPreferences?(): MidiPreferences
  savePreferences?(preferences: MidiPreferences): void
  now?(): number
}
const emptyPorts = (): MidiPorts => ({ inputs: [], outputs: [] })
const label = (name: string): string => name.toLowerCase().replace(/\([^)]*\)|\b(?:bluetooth midi|midi|input|output|in|out)\b|\[\d+\]/g, '').replace(/[^a-z0-9]/g, '')
function remembered(ports: MidiPortInfo[], preference?: MidiSelection | null): MidiPortInfo | undefined {
  return ports.find(p => p.id === preference?.id) ?? ports.find(p => preference && p.name === preference.name && (!preference.manufacturer || p.manufacturer === preference.manufacturer))
}
function choice(ports: MidiPortInfo[], preference?: MidiSelection | null): MidiPortInfo | undefined {
  if (preference === null) return undefined
  return remembered(ports, preference) ?? ports.find(p => /lumi|roli/i.test(`${p.name} ${p.manufacturer ?? ''}`)) ?? ports[0]
}
function isSynth(port: MidiPortInfo): boolean { return /microsoft gs|wavetable|software synth/i.test(port.name) }
function pairOutput(input: MidiPortInfo | undefined, outputs: MidiPortInfo[]): MidiPortInfo | undefined {
  if (!input) return undefined
  return outputs.find(p => !isSynth(p) && (p.id === input.id || (label(p.name) && label(p.name) === label(input.name))))
    ?? outputs.find(p => !isSynth(p) && /lumi|roli/i.test(p.name) && /lumi|roli/i.test(input.name))
}

/** Transport-independent state machine. Snapshot identity changes only on updates. */
export class MidiConnectionManager {
  private readonly options: ManagerOptions
  private readonly adapter: MidiAdapter
  private preferences: MidiPreferences
  private readonly listeners = new Set<() => void>()
  private readonly parsers = new Map<string, MidiStreamParser>()
  private readonly activeNotes = new Map<string, number[]>()
  private readonly external = new Map<string, { port: MidiPortInfo; send?: (data: number[], at?: number) => void; close?: () => void }>()
  private readonly disconnectCleanups = new Set<() => void>()
  private ports: MidiPorts = emptyPorts()
  private state: MidiStatus
  private readonly unsubscribeAdapter: () => void
  private passivePromise: Promise<boolean> | null = null
  private connectPromise: Promise<boolean> | null = null
  private lightsPromise: Promise<boolean> | null = null
  private generation = 0
  private enabled = false
  private disposed = false
  private granted = false
  constructor(options: ManagerOptions) {
    this.options = options; this.adapter = options.adapter
    try { this.preferences = options.loadPreferences?.() ?? {} } catch { this.preferences = {} }
    this.state = { ...emptyPorts(), phase: this.adapter.supported ? 'idle' : 'unsupported', transport: null, supported: this.adapter.supported, selectedInputId: null, selectedOutputId: null, sysexEnabled: false, messageCount: 0, lastMessageAt: null, lastNote: null, error: null, lightsError: null }
    this.unsubscribeAdapter = this.adapter.subscribe(event => { if (this.enabled && !this.disposed) this.handleEvent(event) })
  }
  getStatus = (): MidiStatus => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(patch: Partial<MidiStatus>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  init(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (!this.passivePromise) this.passivePromise = this.start(true)
    return this.passivePromise
  }
  connect(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (!this.connectPromise) {
      const generation = this.generation
      const task = (async () => {
        if (this.passivePromise) await this.passivePromise
        if (this.disposed || generation !== this.generation) return false
        if (this.granted && this.adapter.kind !== 'native') { this.enabled = true; this.refresh(); return true }
        return this.start(false)
      })()
      this.connectPromise = task
      void task.finally(() => { if (this.connectPromise === task) this.connectPromise = null })
    }
    return this.connectPromise
  }
  private async start(restoreOnly: boolean): Promise<boolean> {
    if (!this.adapter.supported) { this.publish({ phase: this.external.size ? 'connected' : 'unsupported' }); return false }
    const generation = this.generation
    this.enabled = true
    if (!restoreOnly) this.publish({ phase: 'connecting', error: null })
    try {
      const result = await this.adapter.connect({ sysex: false, restoreOnly })
      if (this.disposed || generation !== this.generation) return false
      this.granted = result.granted; this.ports = { inputs: result.inputs, outputs: result.outputs }
      this.publish({ sysexEnabled: result.sysexEnabled })
      this.refresh()
      return result.granted
    } catch (error) {
      if (this.disposed || generation !== this.generation) return false
      const message = error instanceof Error ? error.message : String(error)
      const denied = error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      this.publish({ phase: this.state.selectedInputId ? 'connected' : denied ? 'denied' : 'error', error: message })
      return false
    }
  }
  enableLights(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (!this.lightsPromise) {
      const generation = this.generation
      const task = (async () => {
        if (!await this.connect() || generation !== this.generation) return false
        try {
          const result = await this.adapter.connect({ sysex: true, restoreOnly: false })
          if (this.disposed || generation !== this.generation) return false
          this.ports = { inputs: result.inputs, outputs: result.outputs }
          this.publish({ sysexEnabled: result.sysexEnabled, lightsError: result.sysexEnabled ? null : 'This connection does not support MIDI lights.' })
          this.refresh(); return result.sysexEnabled
        } catch (error) {
          if (this.disposed || generation !== this.generation) return false
          // Keep the previously granted notes connection and every held voice.
          this.publish({ lightsError: error instanceof Error ? error.message : String(error) })
          return false
        }
      })()
      this.lightsPromise = task
      void task.finally(() => { if (this.lightsPromise === task) this.lightsPromise = null })
    }
    return this.lightsPromise
  }
  private handleEvent(event: MidiAdapterEvent): void {
    if (event.type === 'ports') { this.ports = event; this.refresh() }
    else if (event.type === 'message') this.receive(event.inputId, event.data, event.timestamp)
    else this.publish({ error: event.message, phase: this.state.selectedInputId ? 'connected' : 'error' })
  }
  private refresh(): void {
    const inputs: MidiPortInfo[] = this.ports.inputs.filter(p => !p.state || p.state === 'connected').map(p => ({ ...p, state: 'connected' as const }))
    const outputs: MidiPortInfo[] = this.ports.outputs.filter(p => !p.state || p.state === 'connected').map(p => ({ ...p, state: 'connected' as const }))
    for (const item of this.external.values()) { inputs.push(item.port); if (item.send) outputs.push(item.port) }
    const input = choice(inputs, this.preferences.input)
    if (input && this.preferences.input === undefined) {
      this.preferences = { ...this.preferences, input: { id: input.id, name: input.name, manufacturer: input.manufacturer } }
      this.save()
    }
    const output = this.preferences.output === null ? undefined
      : remembered(outputs, this.preferences.output) ?? pairOutput(input, outputs)
    if (this.state.selectedInputId && this.state.selectedInputId !== input?.id) this.release(this.state.selectedInputId)
    for (const id of this.parsers.keys()) if (!inputs.some(p => p.id === id)) this.parsers.delete(id)
    const inputChanged = this.state.selectedInputId !== (input?.id ?? null)
    this.publish({ inputs, outputs, selectedInputId: input?.id ?? null, selectedOutputId: output?.id ?? null,
      ...(inputChanged ? { lastNote: null, lastMessageAt: null, messageCount: 0 } : {}),
      transport: input ? this.external.has(input.id) ? 'ble' : this.adapter.kind : this.granted ? this.adapter.kind : null,
      phase: input ? 'connected' : this.state.error ? 'error' : this.granted ? 'waiting' : this.adapter.supported ? 'idle' : 'unsupported',
      error: input ? null : this.state.error })
  }
  selectInput(id: string): void {
    const port = this.state.inputs.find(p => p.id === id)
    if (id && !port) return
    this.preferences = { ...this.preferences, input: port ? { id: port.id, name: port.name, manufacturer: port.manufacturer } : null }
    this.save(); this.refresh()
  }
  selectOutput(id: string): void {
    const port = this.state.outputs.find(p => p.id === id)
    if (id && !port) return
    this.preferences = { ...this.preferences, output: port ? { id: port.id, name: port.name, manufacturer: port.manufacturer } : null }
    this.save(); this.refresh()
  }
  private save(): void { try { this.options.savePreferences?.(this.preferences) } catch { /* storage unavailable */ } }
  receive(inputId: string, bytes: unknown, timestamp?: number): void {
    if (this.disposed || (!this.enabled && !this.external.has(inputId)) || inputId !== this.state.selectedInputId) return
    let parser = this.parsers.get(inputId)
    if (!parser) { parser = new MidiStreamParser(); this.parsers.set(inputId, parser) }
    for (const data of parser.push(bytes)) {
      const at = Number.isFinite(timestamp) && timestamp! >= 0 ? timestamp! : this.options.now?.() ?? Date.now()
      let lastNote = this.state.lastNote
      if ((data[0] & 0xf0) === 0x90 && data[2] > 0) { lastNote = { pitch: data[1], velocity: data[2], channel: data[0] & 0x0f, at }; this.activeNotes.set(`${data[0] & 15}:${data[1]}`, [data[0] & 15, data[1]]) }
      else if ((data[0] & 0xf0) === 0x80 || ((data[0] & 0xf0) === 0x90 && data[2] === 0)) this.activeNotes.delete(`${data[0] & 15}:${data[1]}`)
      this.publish({ messageCount: this.state.messageCount + 1, lastMessageAt: at, lastNote })
      this.options.onMessage(data, inputId)
    }
  }
  private release(inputId: string): void {
    const hadNotes = this.activeNotes.size > 0
    for (const [channel, pitch] of this.activeNotes.values()) this.options.onMessage([0x80 | channel, pitch, 0], inputId)
    this.activeNotes.clear(); this.parsers.delete(inputId); if (hadNotes) this.options.onRelease?.(inputId)
  }
  attachExternal(port: MidiPortInfo, options: { send?: (data: number[], at?: number) => void; close?: () => void } = {}): void {
    if (this.disposed) { options.close?.(); return }
    this.external.set(port.id, { port: { ...port, state: 'connected' }, ...options }); this.refresh()
  }
  detachExternal(id: string): void {
    const item = this.external.get(id)
    if (!item) return
    this.external.delete(id); this.refresh()
  }
  addDisconnectCleanup(cleanup: () => void): () => void { this.disconnectCleanups.add(cleanup); return () => { this.disconnectCleanups.delete(cleanup) } }
  send(id: string, data: number[], timestamp?: number): void {
    if (!this.state.outputs.some(p => p.id === id) || !data.length || data.length > 65535 || data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255) || (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp < 0))) return
    if (data.includes(0xf0) && this.adapter.kind === 'web' && !this.external.has(id) && !this.state.sysexEnabled) return
    try { const external = this.external.get(id); if (external) external.send?.(data, timestamp); else this.adapter.send(id, data, timestamp) } catch { /* unplug or invalid schedule */ }
  }
  bluetooth(): Promise<boolean> {
    if (!this.adapter.bluetooth) return Promise.resolve(false)
    return this.connect().then(connected => { if (connected && !this.disposed) this.adapter.bluetooth?.(); return connected })
  }
  disconnect(): void {
    this.generation++; this.enabled = false; this.granted = false
    if (this.state.selectedInputId) this.release(this.state.selectedInputId)
    this.adapter.disconnect()
    for (const cleanup of this.disconnectCleanups) cleanup()
    this.disconnectCleanups.clear()
    for (const item of this.external.values()) item.close?.()
    this.external.clear(); this.ports = emptyPorts(); this.passivePromise = null; this.connectPromise = null; this.lightsPromise = null
    this.publish({ ...emptyPorts(), phase: this.adapter.supported ? 'idle' : 'unsupported', transport: null, selectedInputId: null, selectedOutputId: null, sysexEnabled: false, error: null, lightsError: null, lastNote: null, lastMessageAt: null, messageCount: 0 })
  }
  dispose(): void { if (this.disposed) return; this.disconnect(); this.disposed = true; this.unsubscribeAdapter(); this.listeners.clear() }
}
