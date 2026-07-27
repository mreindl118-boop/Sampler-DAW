import type { Project } from '../state/types'
import { PolySynth } from './synth'
import { SamplerInstrument, sampleStore } from './sampler'
import { DrumKit } from './drums'
import { buildFxChain } from './effects'
import { scheduleLane } from './automation'
import { audioBufferToWav, downloadBlob } from './wav'

/**
 * Render the whole project offline and download a 16-bit stereo WAV mixdown.
 * Mirrors the live graph: fader/pan (with automation), clip gain + fades, FX, master limiter.
 */
export async function exportWav(project: Project): Promise<void> {
  const spb = 60 / project.tempo
  let endBeat = 4
  for (const track of project.tracks) {
    for (const clip of track.clips) endBeat = Math.max(endBeat, clip.start + clip.length)
  }
  const tailSec = 2
  const sampleRate = 44100
  const totalSec = endBeat * spb + tailSec
  const ctx = new OfflineAudioContext(2, Math.ceil(totalSec * sampleRate), sampleRate)

  const master = ctx.createGain()
  master.gain.value = project.master.volume
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.1
  master.connect(limiter)
  limiter.connect(ctx.destination)

  const anySolo = project.tracks.some((t) => t.solo)
  const startPad = 0.05
  const beatToTime = (b: number) => startPad + b * spb

  for (const track of project.tracks) {
    if (track.mute || (anySolo && !track.solo)) continue
    const fx = buildFxChain(ctx, track.fx)
    const vol = ctx.createGain()
    vol.gain.value = track.volume
    const pan = ctx.createStereoPanner()
    pan.pan.value = track.pan
    fx.output.connect(vol)
    vol.connect(pan)
    pan.connect(master)

    // automation over the full render
    for (const lane of track.automation) {
      if (!lane.enabled || lane.points.length === 0) continue
      if (lane.param === 'volume') scheduleLane(vol.gain, lane, 0, endBeat + 1, beatToTime, track.volume)
      if (lane.param === 'pan') scheduleLane(pan.pan, lane, 0, endBeat + 1, beatToTime, track.pan)
    }

    let instrument: PolySynth | SamplerInstrument | DrumKit | null = null
    if (track.kind === 'synth' && track.synth) instrument = new PolySynth(ctx, track.synth)
    if (track.kind === 'sampler' && track.sampler) instrument = new SamplerInstrument(ctx, track.sampler)
    if (track.kind === 'drums' && track.drums) instrument = new DrumKit(ctx, track.drums)

    if (instrument) {
      instrument.output.connect(fx.input)
      for (const clip of track.clips) {
        if (clip.kind !== 'midi') continue
        for (const note of clip.notes) {
          if (note.start >= clip.length) continue
          const t = beatToTime(clip.start + note.start)
          instrument.noteOn(note.pitch, note.vel, t)
          instrument.noteOff(note.pitch, t + Math.max(0.05, note.dur * spb))
        }
      }
    } else {
      const bus = ctx.createGain()
      bus.connect(fx.input)
      for (const clip of track.clips) {
        if (clip.kind !== 'audio') continue
        const buffer = sampleStore.get(clip.sampleId)
        if (!buffer) continue
        const src = ctx.createBufferSource()
        src.buffer = buffer
        const g = ctx.createGain()
        const when = beatToTime(clip.start)
        const durSec = clip.length * spb
        const fadeInSec = Math.min(clip.fadeIn * spb, durSec)
        const fadeOutSec = Math.min(clip.fadeOut * spb, durSec)
        if (fadeInSec > 0.001) {
          g.gain.setValueAtTime(0.0001, when)
          g.gain.linearRampToValueAtTime(clip.gain, when + fadeInSec)
        } else {
          g.gain.setValueAtTime(clip.gain, when)
        }
        if (fadeOutSec > 0.001) {
          g.gain.setValueAtTime(clip.gain, when + durSec - fadeOutSec)
          g.gain.linearRampToValueAtTime(0.0001, when + durSec)
        }
        src.connect(g)
        g.connect(bus)
        src.start(when, clip.offset, durSec)
      }
    }
  }

  const rendered = await ctx.startRendering()
  downloadBlob(audioBufferToWav(rendered), `${project.name.replace(/[^\w\- ]+/g, '') || 'openstudio'}.wav`)
}
