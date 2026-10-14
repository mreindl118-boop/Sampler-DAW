import Foundation
import CoreFoundation
import CoreMIDI
import Darwin
import WebKit

/// CoreMIDI timestamps use Mach host ticks on iOS, not nanoseconds or macOS CoreAudio clock functions.
private enum MidiHostClock {
    static let nanosPerTick: Double = {
        var timebase = mach_timebase_info_data_t()
        mach_timebase_info(&timebase)
        return Double(timebase.numer) / Double(timebase.denom)
    }()
}

/// A MIDI 1 byte-stream bridge. The shared TypeScript parser handles running status and fragmented SysEx.
@MainActor
final class CoreMidiBridge {
    private final class InputContext {
        let id: String
        init(_ id: String) { self.id = id }
    }

    private weak var webView: WKWebView?
    var showBluetooth: (() -> Void)?
    private var client = MIDIClientRef()
    private var inputPort = MIDIPortRef()
    private var outputPort = MIDIPortRef()
    private var connectedSources: [MIDIEndpointRef: InputContext] = [:]
    private var retiredContexts: [InputContext] = []
    private var destinations: [String: MIDIEndpointRef] = [:]
    private var requested = false
    private var active = false
    private var generation = 0

    init(webView: WKWebView) { self.webView = webView }

    func handle(_ command: [String: Any]) {
        guard let action = command["action"] as? String else { error("Malformed MIDI command."); return }
        switch action {
        case "start": requested = true; start()
        case "stop": stop()
        case "bluetooth": requested = true; start(); showBluetooth?()
        case "send": send(command)
        default: error("Unknown MIDI command.")
        }
    }

    private func start() {
        guard !active else { refresh(); return }
        generation += 1
        let token = generation
        var status = MIDIClientCreateWithBlock("SoundLAB Studio" as CFString, &client) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, self.active, self.generation == token else { return }
                self.refresh()
            }
        }
        guard status == 0 else { error("CoreMIDI client failed (\(status))."); return }
        status = MIDIInputPortCreateWithBlock(client, "SoundLAB input" as CFString, &inputPort) { [weak self] packetList, context in
            guard let context = context else { return }
            let inputID = Unmanaged<InputContext>.fromOpaque(context).takeUnretainedValue().id
            var events: [([UInt8], Double)] = []
            let offset = MemoryLayout<MIDIPacketList>.offset(of: \.packet)!
            var packet = UnsafeRawPointer(packetList).advanced(by: offset).assumingMemoryBound(to: MIDIPacket.self)
            for _ in 0..<packetList.pointee.numPackets {
                let count = Int(packet.pointee.length)
                let dataOffset = MemoryLayout<MIDIPacket>.offset(of: \.data)!
                let bytes = Array(UnsafeRawBufferPointer(start: UnsafeRawPointer(packet).advanced(by: dataOffset), count: count))
                let now = mach_absolute_time()
                let stamp = packet.pointee.timeStamp
                let age = stamp > 0 && now >= stamp ? Double(now - stamp) * MidiHostClock.nanosPerTick / 1_000_000 : 0
                events.append((bytes, age))
                packet = UnsafePointer(MIDIPacketNext(packet))
            }
            let capturedEvents = events
            DispatchQueue.main.async {
                guard let self = self, self.active, self.generation == token else { return }
                for (bytes, age) in capturedEvents { self.emit(["type": "message", "inputId": inputID, "data": bytes], ageMs: age) }
            }
        }
        guard status == 0 else { dispose(); error("CoreMIDI input failed (\(status))."); return }
        status = MIDIOutputPortCreate(client, "SoundLAB output" as CFString, &outputPort)
        guard status == 0 else { dispose(); error("CoreMIDI output failed (\(status))."); return }
        active = true
        refresh()
    }

    func stop() { requested = false; dispose(); emitPorts([], []) }
    func suspend() { dispose(); emitPorts([], []) }
    func resume() { if requested { start() } }

    private func dispose() {
        active = false
        generation += 1
        for source in connectedSources.keys { MIDIPortDisconnectSource(inputPort, source) }
        if inputPort != 0 { MIDIPortDispose(inputPort); inputPort = 0 }
        if outputPort != 0 { MIDIPortDispose(outputPort); outputPort = 0 }
        if client != 0 { MIDIClientDispose(client); client = 0 }
        connectedSources.removeAll()
        retiredContexts.removeAll()
        destinations.removeAll()
    }

    private func refresh() {
        guard active else { return }
        let sources = (0..<MIDIGetNumberOfSources()).map(MIDIGetSource).filter { $0 != 0 }
        let removed = connectedSources.keys.filter { !sources.contains($0) }
        for source in removed {
            MIDIPortDisconnectSource(inputPort, source)
            if let context = connectedSources.removeValue(forKey: source) { retiredContexts.append(context) }
        }
        var inputs: [[String: Any]] = []
        for source in sources {
            let id = endpointID(source, kind: "input")
            if connectedSources[source] == nil {
                let context = InputContext(id)
                let status = MIDIPortConnectSource(inputPort, source, Unmanaged.passUnretained(context).toOpaque())
                guard status == 0 else { error("Could not open \(name(source)) (\(status))."); continue }
                connectedSources[source] = context
            }
            inputs.append(port(source, id: id))
        }
        destinations.removeAll()
        var outputs: [[String: Any]] = []
        for index in 0..<MIDIGetNumberOfDestinations() {
            let endpoint = MIDIGetDestination(index)
            guard endpoint != 0 else { continue }
            let id = endpointID(endpoint, kind: "output")
            destinations[id] = endpoint
            outputs.append(port(endpoint, id: id))
        }
        emitPorts(inputs, outputs)
    }

    private func endpointID(_ endpoint: MIDIEndpointRef, kind: String) -> String {
        var unique = Int32(bitPattern: endpoint)
        MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &unique)
        return "ios:\(kind):\(unique)"
    }

    private func property(_ endpoint: MIDIEndpointRef, _ key: CFString) -> String? {
        var value: Unmanaged<CFString>?
        guard MIDIObjectGetStringProperty(endpoint, key, &value) == 0 else { return nil }
        guard let value = value else { return nil }
        return value.takeRetainedValue() as String
    }

    private func name(_ endpoint: MIDIEndpointRef) -> String {
        property(endpoint, kMIDIPropertyDisplayName) ?? property(endpoint, kMIDIPropertyName) ?? "MIDI keyboard"
    }

    private func port(_ endpoint: MIDIEndpointRef, id: String) -> [String: Any] {
        ["id": id, "name": name(endpoint), "manufacturer": property(endpoint, kMIDIPropertyManufacturer) ?? "", "state": "connected"]
    }

    private func send(_ command: [String: Any]) {
        guard active, let id = command["id"] as? String, destinations[id] != nil,
              let raw = command["data"] as? [NSNumber], !raw.isEmpty, raw.count <= 65_535,
              raw.allSatisfy({ CFGetTypeID($0) != CFBooleanGetTypeID() && $0.doubleValue.isFinite && $0.doubleValue.rounded() == $0.doubleValue && $0.intValue >= 0 && $0.intValue <= 255 }) else {
            error("Invalid MIDI output or byte array."); return
        }
        let bytes = raw.map { $0.uint8Value }
        if let number = command["timestamp"] as? NSNumber {
            let timestamp = number.doubleValue
            guard CFGetTypeID(number) != CFBooleanGetTypeID(), timestamp.isFinite, timestamp >= 0 else { error("Invalid MIDI timestamp."); return }
            let token = generation
            webView?.evaluateJavaScript("performance.now()") { [weak self] value, _ in
                guard let now = value as? Double else { return }
                DispatchQueue.main.async {
                    guard let self = self, self.active, self.generation == token else { return }
                    let delay = min(5_000, max(0, timestamp - now))
                    let host = mach_absolute_time() + UInt64(delay * 1_000_000 / MidiHostClock.nanosPerTick)
                    self.write(id: id, bytes: bytes, timestamp: host)
                }
            }
        } else if command["timestamp"] != nil { error("Invalid MIDI timestamp.") }
        else { write(id: id, bytes: bytes, timestamp: 0) }
    }

    private func write(id: String, bytes: [UInt8], timestamp: MIDITimeStamp) {
        guard let endpoint = destinations[id], active else { return }
        // CoreMIDI caps each packet list at 64 KiB. Long SysEx is legal across packet lists.
        if bytes.count > 65_000 {
            guard bytes.first == 0xf0, bytes.last == 0xf7 else { error("Large MIDI output must be a complete SysEx message."); return }
            for offset in stride(from: 0, to: bytes.count, by: 16_000) {
                write(id: id, bytes: Array(bytes[offset..<min(offset + 16_000, bytes.count)]), timestamp: timestamp)
            }
            return
        }
        let capacity = max(MemoryLayout<MIDIPacketList>.size, bytes.count + 64)
        let memory = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: MemoryLayout<MIDIPacketList>.alignment)
        defer { memory.deallocate() }
        let list = memory.bindMemory(to: MIDIPacketList.self, capacity: 1)
        let initial = MIDIPacketListInit(list)
        let packet = bytes.withUnsafeBufferPointer { MIDIPacketListAdd(list, capacity, initial, timestamp, bytes.count, $0.baseAddress!) }
        guard packet != nil else { error("MIDI packet allocation failed."); return }
        let status = MIDISend(outputPort, endpoint, list)
        if status != 0 { error("MIDI send failed (\(status)).") }
    }

    private func emitPorts(_ inputs: [[String: Any]], _ outputs: [[String: Any]]) {
        emit(["type": "ports", "inputs": inputs, "outputs": outputs])
    }

    private func error(_ message: String) { emit(["type": "error", "message": message, "recoverable": true]) }

    private func emit(_ event: [String: Any], ageMs: Double? = nil) {
        guard let webView = webView, BundledAssets.isTrusted(webView.url),
              let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        let timestamp = ageMs.map { "event.timestamp=Math.max(0,performance.now()-\($0));" } ?? ""
        webView.evaluateJavaScript("(()=>{const event=\(json);\(timestamp)window.dispatchEvent(new CustomEvent('soundlab-midi',{detail:event}));})()", completionHandler: nil)
    }
}
