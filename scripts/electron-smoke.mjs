import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import electronPath from 'electron';

// Starts only our generated app, hidden and muted, with a disposable profile.
// The fake capture switch ensures this test never records a physical microphone.
// The native permission handler still runs; its own Allow/Deny dialog is stubbed
// in this controlled main-process harness so no prompt reaches the user.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await readFile(path.join(root, 'dist/index.html'));
const scratchRoot = path.join(root, 'release');
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(path.join(scratchRoot, 'electron-smoke-'));
const profile = path.join(scratch, 'profile');
const entry = path.join(scratch, 'main.cjs');
await mkdir(profile);
await writeFile(entry, `
const { app, dialog } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
app.getAppPath = () => ${JSON.stringify(root)};
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('mute-audio');
globalThis.__smokePromptCount = 0;
dialog.showMessageBox = async () => { globalThis.__smokePromptCount++; return { response: 0, checkboxChecked: false }; };
app.on('browser-window-created', (_event, window) => {
  window.show = () => {};
  window.webContents.setAudioMuted(true);
  window.webContents.setBackgroundThrottling(false);
});
require(${JSON.stringify(path.join(root, 'desktop/main.cjs'))});
`);

let application;
try {
  application = await _electron.launch({ executablePath: electronPath, args: [entry], cwd: root, timeout: 30000 });
  const page = await application.firstWindow();
  // Evaluate without a DevTools user gesture before any page.evaluate calls.
  const initialAudioState = await application.evaluate(async ({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(async () => {
      const context = new AudioContext(); const state = context.state;
      await context.close(); return state;
    })()`, false));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.transport');
  assert.equal(page.url(), 'soundlab://app/index.html');
  const main = await application.evaluate(({ app, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const prefs = win.webContents.getLastWebPreferences();
    return { profile: app.getPath('userData'), visible: win.isVisible(), muted: win.webContents.isAudioMuted(),
      sandbox: prefs.sandbox, isolation: prefs.contextIsolation, node: prefs.nodeIntegration,
      security: prefs.webSecurity };
  });
  assert.equal(main.profile, profile);
  assert.equal(main.visible, false);
  assert.equal(main.muted, true);
  assert.equal(main.sandbox, true);
  assert.equal(main.isolation, true);
  assert.equal(main.node, false);
  assert.equal(main.security, true);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  assert.equal(initialAudioState, 'suspended', 'Audio must wait for a real user gesture');
  const midi = await page.evaluate(async () => {
    if (typeof navigator.requestMIDIAccess !== 'function') throw new Error('Native Chromium Web MIDI is missing');
    const basic = await navigator.requestMIDIAccess({ sysex: false });
    const advanced = await navigator.requestMIDIAccess({ sysex: true });
    return { inputs: basic.inputs.size, outputs: basic.outputs.size, sysex: advanced.sysexEnabled };
  });
  assert.equal(midi.sysex, true, 'Bundled app must receive MIDI/SysEx permission');
  await page.locator('.welcome button').filter({ hasText: 'Skip' }).click();
  await page.getByRole('button', { name: '+ Audio', exact: true }).click();
  await page.locator('.track-head').last().locator('button[title="Arm for recording"]').click();
  await page.locator('button[title="Record (arm a track first)"]').click();
  await page.waitForTimeout(2500);
  await page.locator('button[title="Record (arm a track first)"]').click();
  await page.waitForFunction(() => {
    const project = JSON.parse(localStorage.getItem('openstudio.project.v1') || '{}');
    return project.tracks?.filter(track => track.kind === 'audio').some(track => track.clips.some(clip => clip.length > 0.2));
  });
  assert.ok(await page.locator('.clip canvas').count(), 'Recorded audio must render a waveform');
  const prompts = await application.evaluate(() => globalThis.__smokePromptCount);
  assert.equal(prompts, 1, 'Recording must go through the bundled-only microphone permission prompt');
  assert.deepEqual(errors, [], 'Desktop renderer must not throw page errors');
  console.log(`Electron smoke passed: hidden fresh profile, sandbox/isolation, secure bundle, MIDI/SysEx permission (${midi.inputs} input / ${midi.outputs} output endpoints), fake audio recording and waveform.`);
} finally {
  if (application) await application.close();
  const relative = path.relative(scratchRoot, scratch);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await rm(scratch, { recursive: true, force: true });
}
