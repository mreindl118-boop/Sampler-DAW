package com.soundlab.studio;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.webkit.WebView;
import android.widget.ArrayAdapter;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** MIDI bytes stay unmodified; TypeScript handles complete messages, running status and SysEx chunks. */
final class MidiBridge {
    private static final int PERMISSIONS = 8401;
    private static final int ENABLE_BLUETOOTH = 8402;
    private static final ParcelUuid MIDI_SERVICE = new ParcelUuid(UUID.fromString("03b80e5a-ede8-4b33-a751-6ce34ec4c700"));
    private final MainActivity activity;
    private final WebView webView;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final MidiManager manager;
    private final Map<Integer, MidiDevice> devices = new HashMap<>();
    private final Map<String, MidiOutputPort> receivePorts = new HashMap<>();
    private final Map<String, MidiInputPort> sendPorts = new HashMap<>();
    private final Set<Integer> opening = new HashSet<>();
    private final Set<Integer> removedDevices = new HashSet<>();
    private final List<BluetoothDevice> scanDevices = new ArrayList<>();
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private AlertDialog chooser;
    private boolean requested;
    private boolean active;
    private boolean bluetoothPending;
    private int generation;

    MidiBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.manager = activity.getSystemService(MidiManager.class);
    }

    void command(String json) {
        if (json.length() > 400_000) { error("MIDI command is too large."); return; }
        try {
            JSONObject command = new JSONObject(json);
            Object action = command.opt("action");
            if (!(action instanceof String)) throw new JSONException("Missing action");
            switch ((String) action) {
                case "start": requested = true; start(); break;
                case "stop": stop(); break;
                case "send": send(command); break;
                case "bluetooth": requested = true; start(); bluetooth(); break;
                default: error("Unknown MIDI command.");
            }
        } catch (JSONException | IllegalArgumentException error) { error("Malformed MIDI command."); }
    }

    private final MidiManager.DeviceCallback deviceCallback = new MidiManager.DeviceCallback() {
        @Override public void onDeviceAdded(MidiDeviceInfo info) { removedDevices.remove(info.getId()); if (active) open(info); }
        @Override public void onDeviceRemoved(MidiDeviceInfo info) { removedDevices.add(info.getId()); closeDevice(info.getId()); publishPorts(); }
        @Override public void onDeviceStatusChanged(android.media.midi.MidiDeviceStatus status) { if (active) publishPorts(); }
    };

    @SuppressWarnings("deprecation")
    private void start() {
        if (active) { publishPorts(); return; }
        if (manager == null || !activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_MIDI)) {
            error("This Android device does not provide system MIDI support."); publishPorts(); return;
        }
        generation++;
        removedDevices.clear();
        active = true;
        manager.registerDeviceCallback(deviceCallback, main);
        publishPorts();
        for (MidiDeviceInfo info : manager.getDevices()) open(info);
    }

    private void open(MidiDeviceInfo info) {
        if (!active || devices.containsKey(info.getId()) || !opening.add(info.getId())) return;
        final int token = generation;
        try {
            manager.openDevice(info, device -> {
                if (generation == token) opening.remove(info.getId());
                acceptDevice(device, token);
            }, main);
        } catch (SecurityException | IllegalArgumentException failure) {
            opening.remove(info.getId()); error("Unable to open MIDI keyboard: " + failure.getMessage());
        }
    }

    private void acceptDevice(MidiDevice device, int token) {
        if (device == null) { if (active && generation == token) error("MIDI keyboard is unavailable or used by another app."); return; }
        if (!active || token != generation || removedDevices.contains(device.getInfo().getId()) || devices.containsKey(device.getInfo().getId())) { close(device); return; }
        final MidiDeviceInfo info = device.getInfo();
        final int deviceId = info.getId();
        devices.put(deviceId, device);
        for (MidiDeviceInfo.PortInfo port : info.getPorts()) {
            final int number = port.getPortNumber();
            if (port.getType() == MidiDeviceInfo.PortInfo.TYPE_OUTPUT) {
                final String id = portId("input", deviceId, number);
                MidiOutputPort input = device.openOutputPort(number);
                if (input == null) { error("Could not open MIDI input " + portName(info, port)); continue; }
                receivePorts.put(id, input);
                input.connect(new MidiReceiver() {
                    @Override public void onSend(byte[] bytes, int offset, int count, long timestamp) {
                        byte[] copy = Arrays.copyOfRange(bytes, offset, offset + count);
                        // MidiReceiver timestamps use the System.nanoTime time base, not uptime.
                        final double ageMs = timestamp > 0 ? Math.max(0, (System.nanoTime() - timestamp) / 1_000_000.0) : 0;
                        main.post(() -> {
                            if (!active || generation != token || !receivePorts.containsKey(id)) return;
                            JSONArray values = new JSONArray();
                            for (byte value : copy) values.put(value & 0xff);
                            JSONObject event = event("message");
                            put(event, "inputId", id); put(event, "data", values);
                            emit(event, ageMs);
                        });
                    }
                });
            } else if (port.getType() == MidiDeviceInfo.PortInfo.TYPE_INPUT) {
                final String id = portId("output", deviceId, number);
                MidiInputPort output = device.openInputPort(number);
                if (output == null) { error("Could not open MIDI output " + portName(info, port)); continue; }
                sendPorts.put(id, output);
            }
        }
        publishPorts();
    }

    private void send(JSONObject command) throws JSONException {
        Object idValue = command.opt("id");
        Object dataValue = command.opt("data");
        if (!active || !(idValue instanceof String) || !(dataValue instanceof JSONArray)) throw new JSONException("Invalid output");
        String id = (String) idValue;
        JSONArray values = (JSONArray) dataValue;
        if (!sendPorts.containsKey(id) || values.length() == 0 || values.length() > 65_535) throw new JSONException("Invalid output bytes");
        byte[] bytes = new byte[values.length()];
        for (int i = 0; i < bytes.length; i++) {
            Object value = values.get(i);
            if (!(value instanceof Number)) throw new JSONException("Invalid MIDI byte");
            double number = ((Number) value).doubleValue();
            if (Double.isNaN(number) || Double.isInfinite(number) || Math.rint(number) != number || number < 0 || number > 255) throw new JSONException("Invalid MIDI byte");
            bytes[i] = (byte) (int) number;
        }
        if (command.has("timestamp")) {
            Object value = command.get("timestamp");
            if (!(value instanceof Number)) throw new JSONException("Invalid timestamp");
            double timestamp = ((Number) value).doubleValue();
            if (Double.isNaN(timestamp) || Double.isInfinite(timestamp) || timestamp < 0) throw new JSONException("Invalid timestamp");
            int token = generation;
            webView.evaluateJavascript("performance.now()", answer -> {
                if (!active || generation != token) return;
                try {
                    double delay = Math.min(5000, Math.max(0, timestamp - Double.parseDouble(answer)));
                    write(id, bytes, System.nanoTime() + (long) (delay * 1_000_000));
                } catch (NumberFormatException ignored) { error("MIDI scheduling clock unavailable."); }
            });
        } else write(id, bytes, 0);
    }

    private void write(String id, byte[] bytes, long timestamp) {
        MidiInputPort port = sendPorts.get(id);
        if (port == null || !active) return;
        try { port.send(bytes, 0, bytes.length, timestamp); }
        catch (IOException failure) { error("MIDI send failed. Reconnect the keyboard."); }
    }

    void stop() { requested = false; bluetoothPending = false; suspend(); }
    void suspend() {
        generation++;
        active = false;
        stopScan();
        if (chooser != null) { chooser.dismiss(); chooser = null; }
        if (manager != null) manager.unregisterDeviceCallback(deviceCallback);
        for (int id : new ArrayList<>(devices.keySet())) closeDevice(id);
        opening.clear();
        publishPorts();
    }
    void resume() {
        if (requested) start();
        if (bluetoothPending && hasBluetoothPermissions()) { bluetoothPending = false; bluetooth(); }
    }
    void pageReady() { if (requested) start(); }

    private void closeDevice(int deviceId) {
        String inputPrefix = "android:input:" + deviceId + ":";
        String outputPrefix = "android:output:" + deviceId + ":";
        for (String id : new ArrayList<>(receivePorts.keySet())) if (id.startsWith(inputPrefix)) close(receivePorts.remove(id));
        for (String id : new ArrayList<>(sendPorts.keySet())) if (id.startsWith(outputPrefix)) close(sendPorts.remove(id));
        close(devices.remove(deviceId));
        opening.remove(deviceId);
    }

    private void publishPorts() {
        JSONArray inputs = new JSONArray(), outputs = new JSONArray();
        for (MidiDevice device : devices.values()) {
            MidiDeviceInfo info = device.getInfo();
            for (MidiDeviceInfo.PortInfo port : info.getPorts()) {
                boolean input = port.getType() == MidiDeviceInfo.PortInfo.TYPE_OUTPUT;
                String id = portId(input ? "input" : "output", info.getId(), port.getPortNumber());
                if (input ? !receivePorts.containsKey(id) : !sendPorts.containsKey(id)) continue;
                JSONObject value = new JSONObject();
                put(value, "id", id); put(value, "name", portName(info, port));
                put(value, "manufacturer", info.getProperties().getString(MidiDeviceInfo.PROPERTY_MANUFACTURER, ""));
                put(value, "state", "connected");
                (input ? inputs : outputs).put(value);
            }
        }
        JSONObject event = event("ports");
        put(event, "inputs", inputs); put(event, "outputs", outputs); emit(event, null);
    }

    private static String portId(String kind, int deviceId, int number) { return "android:" + kind + ":" + deviceId + ":" + number; }
    private static String portName(MidiDeviceInfo info, MidiDeviceInfo.PortInfo port) {
        String device = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME, "MIDI keyboard");
        String portName = port.getName();
        return portName == null || portName.isEmpty() ? device : device + " · " + portName;
    }

    private String[] bluetoothPermissions() {
        return Build.VERSION.SDK_INT >= 31 ? new String[] { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }
            : new String[] { Manifest.permission.ACCESS_FINE_LOCATION };
    }
    private boolean hasBluetoothPermissions() {
        for (String permission : bluetoothPermissions()) if (activity.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    @SuppressLint("MissingPermission")
    private void bluetooth() {
        if (!active) return;
        if (!hasBluetoothPermissions()) { bluetoothPending = true; activity.requestPermissions(bluetoothPermissions(), PERMISSIONS); return; }
        BluetoothManager bluetoothManager = activity.getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = bluetoothManager == null ? null : bluetoothManager.getAdapter();
        if (adapter == null || !activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) { error("Bluetooth LE is unavailable on this device. Use USB MIDI."); return; }
        if (!adapter.isEnabled()) {
            bluetoothPending = true;
            activity.startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), ENABLE_BLUETOOTH);
            return;
        }
        if (chooser != null) return;
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) { error("Bluetooth scanner unavailable. Enable Bluetooth and retry."); return; }
        scanDevices.clear();
        ArrayAdapter<String> labels = new ArrayAdapter<>(activity, android.R.layout.simple_list_item_1);
        chooser = new AlertDialog.Builder(activity).setTitle("Connect Bluetooth MIDI keyboard")
            .setAdapter(labels, (dialog, which) -> {
                if (which >= scanDevices.size()) return;
                BluetoothDevice selected = scanDevices.get(which);
                stopScan();
                final int token = generation;
                try { manager.openBluetoothDevice(selected, device -> acceptDevice(device, token), main); }
                catch (SecurityException | IllegalArgumentException failure) { error("Bluetooth MIDI connection failed: " + failure.getMessage()); }
            }).setNegativeButton("Cancel", null).create();
        chooser.setOnDismissListener(dialog -> { stopScan(); chooser = null; });
        scanCallback = new ScanCallback() {
            @Override public void onScanResult(int callbackType, ScanResult result) {
                main.post(() -> {
                    BluetoothDevice device = result.getDevice();
                    if (chooser == null || scanDevices.contains(device)) return;
                    scanDevices.add(device);
                    String name = device.getName();
                    labels.add(name == null || name.trim().isEmpty() ? "MIDI keyboard " + scanDevices.size() : name);
                });
            }
            @Override public void onScanFailed(int errorCode) { main.post(() -> { stopScan(); error("Bluetooth scan failed (" + errorCode + ")."); }); }
        };
        chooser.show();
        try {
            scanner.startScan(java.util.Collections.singletonList(new ScanFilter.Builder().setServiceUuid(MIDI_SERVICE).build()),
                new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
            final ScanCallback scan = scanCallback;
            main.postDelayed(() -> {
                if (scanCallback != scan) return;
                stopScan();
                if (scanDevices.isEmpty()) error("No Bluetooth MIDI keyboard found. Put it in pairing mode, then retry.");
            }, 20_000);
        } catch (SecurityException | IllegalArgumentException failure) { stopScan(); error("Bluetooth scan unavailable: " + failure.getMessage()); }
    }

    @SuppressLint("MissingPermission")
    private void stopScan() {
        if (scanner != null && scanCallback != null) {
            try { scanner.stopScan(scanCallback); } catch (SecurityException ignored) {}
        }
        scanner = null; scanCallback = null;
    }

    void permissionResult(int code) {
        if (code != PERMISSIONS) return;
        if (!hasBluetoothPermissions()) { bluetoothPending = false; error("Allow Nearby Devices permission to connect Bluetooth MIDI. USB remains available."); return; }
        bluetoothPending = false; if (requested) start(); bluetooth();
    }
    void activityResult(int code, int resultCode) {
        if (code != ENABLE_BLUETOOTH) return;
        bluetoothPending = false;
        if (resultCode == Activity.RESULT_OK) { if (requested) start(); bluetooth(); }
        else error("Bluetooth is disabled. Enable it to connect wirelessly.");
    }

    private void error(String message) { JSONObject event = event("error"); put(event, "message", message); put(event, "recoverable", true); emit(event, null); }
    private static JSONObject event(String type) { JSONObject event = new JSONObject(); put(event, "type", type); return event; }
    private static void put(JSONObject object, String key, Object value) { try { object.put(key, value); } catch (JSONException impossible) { throw new IllegalArgumentException(impossible); } }
    private void emit(JSONObject event, Double ageMs) {
        if (!MainActivity.isTrusted(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) return;
        String timestamp = ageMs == null ? "" : "event.timestamp=Math.max(0,performance.now()-" + ageMs + ");";
        webView.evaluateJavascript("(()=>{const event=" + event + ";" + timestamp + "window.dispatchEvent(new CustomEvent('soundlab-midi',{detail:event}));})()", null);
    }
    private static void close(java.io.Closeable value) { if (value != null) try { value.close(); } catch (IOException ignored) {} }
}
