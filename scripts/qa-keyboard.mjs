import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

// A controlled MIDI fixture exercises the real React UI and live audio engine.
// It never requests access to the user's hardware or their browser profile.
const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath = process.env.CHROMIUM_PATH ?? (process.platform === 'win32' && existsSync(windowsChrome) ? windowsChrome : chromium.executablePath());
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(() => {
    class Port extends EventTarget {
      constructor(id, type) { super(); this.id = id; this.type = type; this.name = 'USBMidi2-ACX'; this.manufacturer = 'ROLI'; this.state = 'connected'; this.connection = 'open'; }
      open() { return Promise.resolve(this); }
      close() { return Promise.resolve(this); }
      send() {}
    }
    const access = new EventTarget();
    const input = new Port('keyboard-input', 'input');
    const output = new Port('keyboard-output', 'output');
    access.inputs = new Map([[input.id, input]]);
    access.outputs = new Map([[output.id, output]]);
    access.sysexEnabled = false;
    window.__midiFixture = { access, input, output, requests: [],
      emit(data) { const event = new Event('midimessage'); Object.defineProperty(event, 'data', { value: new Uint8Array(data) }); this.input.dispatchEvent(event); },
      unplug() { this.input.state = 'disconnected'; this.output.state = 'disconnected'; access.dispatchEvent(new Event('statechange')); },
      replug() { const input = new Port('new-keyboard-input', 'input'); const output = new Port('new-keyboard-output', 'output'); this.input = input; this.output = output; access.inputs = new Map([[input.id, input]]); access.outputs = new Map([[output.id, output]]); access.dispatchEvent(new Event('statechange')); },
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async options => {
      window.__midiFixture.requests.push(options);
      if (options.sysex) throw new DOMException('Key lights declined', 'NotAllowedError');
      return access;
    } });
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('.welcome button').filter({ hasText: 'Skip' }).click();
  assert.equal(await page.evaluate(() => window.__midiFixture.requests.length), 0, 'Startup must not open a MIDI permission prompt');
  await page.locator('.keyboard-connection > summary').click();
  await page.getByRole('button', { name: 'Connect keyboard', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.keyboard-connection')?.classList.contains('keyboard-ready'));
  assert.equal(await page.getByLabel('Keyboard input').inputValue(), 'keyboard-input');
  assert.equal(await page.getByLabel('Keyboard output').inputValue(), 'keyboard-output');
  assert.equal(await page.evaluate(() => window.__midiFixture.requests.length), 1, 'One click must make one notes-only request');
  await page.evaluate(() => window.__midiFixture.emit([0x90, 60, 99]));
  await page.waitForFunction(() => document.querySelector('.keyboard-readout')?.textContent.includes('Last note: 60'));
  assert.match(await page.locator('.keyboard-readout').textContent(), /velocity 99/);
  await page.evaluate(async () => {
    const { engine } = await import('/src/audio/engine.ts');
    const { addTrack, setUI } = await import('/src/state/store.ts');
    window.__liveEngine = engine;
    if (engine.liveVoices.size !== 1) throw new Error('Expected one held live note');
    const next = addTrack('synth');
    setUI({ selectedTrackId: next.id });
    window.__midiFixture.emit([0x80, 60, 0]);
    if (engine.liveVoices.size !== 0) throw new Error('A note remained held on the previous track');
    window.__midiFixture.emit([0x90, 62, 110]);
    window.__midiFixture.unplug();
    if (engine.liveVoices.size !== 0) throw new Error('Unplug left a live note held');
  });
  await page.waitForFunction(() => !document.querySelector('.keyboard-connection')?.classList.contains('keyboard-ready'));
  assert.equal(await page.getByLabel('Keyboard input').locator('option').count(), 1, 'Disconnected MIDI input must leave the list');
  await page.evaluate(() => window.__midiFixture.replug());
  await page.waitForFunction(() => document.querySelector('.keyboard-connection')?.classList.contains('keyboard-ready'));
  assert.equal(await page.getByLabel('Keyboard input').inputValue(), 'new-keyboard-input', 'Reconnect restores a renamed endpoint ID');
  await page.getByRole('button', { name: 'Allow advanced keyboard output', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.keyboard-feedback')?.textContent.includes('Key lights declined'));
  await page.evaluate(() => window.__midiFixture.emit([0x90, 64, 88]));
  await page.waitForFunction(() => document.querySelector('.keyboard-readout')?.textContent.includes('Last note: 64'));
  assert.equal(await page.evaluate(() => window.__midiFixture.requests.length), 2);
  await page.evaluate(() => window.__midiFixture.emit([0x80, 64, 0]));
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__liveEngine.liveVoices.size), 0);
  assert.deepEqual(errors, [], 'The keyboard flow must not throw browser errors');
  console.log('Keyboard UI passed: passive startup, one-click connect/audio, port pairing, note readout, original-track release, hotplug restore, optional permission denial, disconnect.');
  await context.close();

  const ipad = await browser.newContext({ viewport: { width: 1024, height: 768 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });
  await ipad.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    localStorage.setItem('openstudio.welcome.v1', 'done');
  });
  const ipadPage = await ipad.newPage();
  await ipadPage.goto(url);
  await ipadPage.locator('.keyboard-connection > summary').click();
  assert.equal(await ipadPage.getByRole('button', { name: 'Connect keyboard', exact: true }).isDisabled(), true);
  assert.match(await ipadPage.locator('.keyboard-help').textContent(), /native iPad build/);
  console.log('iPad browser fallback passed: no false hardware MIDI support claim.');
  await ipad.close();
} finally { await browser.close(); }
