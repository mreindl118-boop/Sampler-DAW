import type { Project } from '../state/types'
import { PolySynth } from './synth'
import { SamplerInstrument, sampleStore } from './sampler'
import { DrumKit } from './drums'
import { buildFxChain } from './effects'
import { audioBufferToWav, downloadBlob } from './wav'

/** Render the whole project offline and download a 16-bit stereo WAV mixdown. */
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

  for (const track of project.tracks) {
    if (track.mute || (anySolo && !track.solo)) continue
    const fx = buildFxChain(ctx, track.fx)
    const gain = ctx.createGain()
    gain.gain.value = track.volume
    const pan = ctx.createStereoPanner()
    pan.pan.value = track.pan
    fx.output.connect(gain)
    gain.connect(pan)
    pan.connect(master)

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
          const t = startPad + (clip.start + note.start) * spb
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
        g.gain.value = clip.gain
        src.connect(g)
        g.connect(bus)
        src.start(startPad + clip.start * spb, clip.offset, clip.length * spb)
      }
    }
  }

  const rendered = await ctx.startRendering()
  downloadBlob(audioBufferToWav(rendered), `${project.name.replace(/[^\w\- ]+/g, '') || 'openstudio'}.wav`)
}
