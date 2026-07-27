/**
 * OpenStudio QA pass — runs the built app in headless Chromium with fake audio
 * devices and exercises the feature checklist end-to-end:
 *
 *   1. app boots with zero console errors
 *   2. transport: play/pause/stop/RTZ, loop, tempo
 *   3. device enumeration + input capture (fake device) on the armed track's channels
 *   4. recording produces an aligned, editable audio clip
 *   5. clip operations: split, duplicate, delete
 *   6. automation lane creation
 *   7. project save round-trip (localStorage autosave survives reload)
 *   8. WAV export renders
 *
 * Usage:  node scripts/qa.mjs [http://localhost:4173]
 * Requires: `npm run build && npx vite preview` (or pass a dev-server URL),
 *           playwright-core + a Chromium binary (CHROMIUM_PATH env or /opt/pw-browsers/chromium).
 */
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:4173/'
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra })
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: exe,
  args: [
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
page.on('dialog', (d) => void d.accept())

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

// 1. boot
check('App boots', await page.$('.transport') !== null)

// 2. transport
await page.click('button[title="Play/Pause (Space)"]')
await page.waitForTimeout(900)
const pos1 = await page.$eval('.time', (el) => el.textContent)
check('Playback advances', pos1 !== '1.1.00', `position ${pos1}`)
await page.keyboard.press('Space') // pause keeps position
await page.waitForTimeout(200)
const posPaused = await page.$eval('.time', (el) => el.textContent)
check('Pause keeps position', posPaused !== '1.1.00', `position ${posPaused}`)
await page.click('button[title="Return to zero"]')
await page.waitForTimeout(150)
check('Return to zero', (await page.$eval('.time', (el) => el.textContent)).startsWith('1.1'), '')
// tempo change
await page.fill('.tempo-box input', '140')
check('Tempo control accepts input', (await page.$eval('.tempo-box input', (el) => el.value)) === '140')

// 3-4. recording through the interface layer (fake device)
await page.click('button:has-text("+ Audio")')
await page.waitForTimeout(200)
// arm the last track
const heads = await page.$$('.track-head')
const newHead = heads[heads.length - 1]
await (await newHead.$('button[title="Arm for recording"]')).click()
await page.click('button[title="Record (arm a track first)"]')
await page.waitForTimeout(2500)
await page.click('button[title="Record (arm a track first)"]') // stop record
await page.waitForTimeout(800)
await page.keyboard.press('Space') // stop playback
const clipInfo = await page.evaluate(() => {
  const raw = localStorage.getItem('openstudio.project.v1')
  if (!raw) return null
  const p = JSON.parse(raw)
  const audio = p.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips)
  return { count: audio.length, len: audio[0]?.length ?? 0, sampleCount: p.samples.length }
})
check('Recording created an audio clip', !!clipInfo && clipInfo.count >= 1, JSON.stringify(clipInfo))
check('Recorded clip has non-zero length', !!clipInfo && clipInfo.len > 0.2, `${clipInfo?.len?.toFixed(2)} beats`)

// waveform canvas present on the audio clip
await page.waitForTimeout(300)
const hasWave = await page.evaluate(() => !!document.querySelector('.clip canvas'))
check('Waveform renders on audio clip', hasWave)

// 5. clip ops — select first clip, split at playhead inside it
await page.click('.clip')
await page.evaluate(() => window.scrollTo(0, 0))
// place playhead at beat 1 (click ruler ~beat 1) then split via toolbar
const clipCountBefore = await page.$$eval('.clip', (els) => els.length)
await page.click('button[title="Play/Pause (Space)"]')
await page.waitForTimeout(500)
await page.keyboard.press('Space')
await page.click('.clip') // reselect
await page.click('button[title="Split selected clip at playhead (Ctrl+E)"]')
await page.waitForTimeout(300)
const clipCountAfterSplit = await page.$$eval('.clip', (els) => els.length)
check('Split at playhead', clipCountAfterSplit === clipCountBefore + 1, `${clipCountBefore} → ${clipCountAfterSplit}`)
await page.click('.clip')
await page.click('button[title="Duplicate selected clip (Ctrl+D)"]')
await page.waitForTimeout(300)
const afterDup = await page.$$eval('.clip', (els) => els.length)
check('Duplicate clip', afterDup === clipCountAfterSplit + 1, `${clipCountAfterSplit} → ${afterDup}`)
await page.click('.clip')
await page.keyboard.press('Delete')
await page.waitForTimeout(300)
const afterDel = await page.$$eval('.clip', (els) => els.length)
check('Delete clip (keyboard)', afterDel === afterDup - 1, `${afterDup} → ${afterDel}`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
const afterUndo = await page.$$eval('.clip', (els) => els.length)
check('Undo restores deleted clip', afterUndo === afterDup, `${afterDel} → ${afterUndo}`)

// 6. automation lane
await page.click('.track-head button[title="Automation lane"]')
await page.waitForTimeout(300)
check('Automation lane opens', (await page.$('.auto-lane')) !== null)
const laneBox = await (await page.$('.auto-lane')).boundingBox()
await page.mouse.click(laneBox.x + 200, laneBox.y + laneBox.height / 2)
await page.waitForTimeout(300)
check('Automation point drawn', (await page.$$('.auto-pt')).length >= 1)

// 7. project round-trip through reload — compare live DOM state, not just storage-vs-storage
const domClipsBefore = await page.$$eval('.clip', (els) => els.length)
const liveAutoBefore = (await page.$$('.auto-pt')).length
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.mouse.click(400, 300) // gesture to unlock ctx/sample restore
await page.waitForTimeout(700)
const domClipsAfter = await page.$$eval('.clip', (els) => els.length)
const afterReload = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('openstudio.project.v1'))
  return { tracks: p.tracks.length, clips: p.tracks.flatMap((t) => t.clips).length, markers: p.markers.length, autoPts: p.tracks.flatMap((t) => t.automation).flatMap((l) => l.points).length }
})
check('Project round-trips reload (clips survive)', domClipsAfter === domClipsBefore,
  `DOM clips ${domClipsBefore} → ${domClipsAfter}; stored: ${JSON.stringify(afterReload)}`)
check('Automation survives reload', afterReload.autoPts >= liveAutoBefore && liveAutoBefore >= 1,
  `${liveAutoBefore} live → ${afterReload.autoPts} stored`)

// 8. WAV export (download event)
const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
await page.click('button:has-text("Export WAV")')
const download = await dl
check('WAV export produces a file', download !== null, download ? await download.suggestedFilename() : 'no download')

// device enumeration via settings diagnostics
await page.click('button[title="Settings"]')
await page.waitForTimeout(400)
await page.click('button:has-text("Diagnostics")')
await page.click('button:has-text("Run diagnostics")')
await page.waitForTimeout(4500)
const diag = await page.$eval('pre', (el) => el.textContent).catch(() => '')
check('Diagnostics: devices enumerated', diag.includes('inputs ('), '')
check('Diagnostics: input capture ran', diag.includes('ch 1: peak'), '')
check('Diagnostics: completed', diag.includes('completed without errors'), '')

const errFiltered = errors.filter((e) => !e.includes('favicon'))
check('Zero console errors across the whole run', errFiltered.length === 0, errFiltered.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
