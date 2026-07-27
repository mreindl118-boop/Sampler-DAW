import type { Project } from '../state/types'
import { engine } from '../audio/engine'
import { audioIO } from '../audio/audioIO'
import { sampleStore } from '../audio/sampler'
import { audioBufferToWav, base64ToArrayBuffer, blobToBase64, downloadBlob } from '../audio/wav'
import { loadSampleFromIDB, saveSampleToIDB } from './idb'
import { loadAutosaved, replaceProject } from '../state/store'

interface ProjectFile {
  format: 'openstudio-project'
  version: 1
  project: Project
  samples: Record<string, string> // sampleId -> base64 WAV
}

export async function exportProjectFile(rawProject: Project): Promise<void> {
  // stamp active device labels so routing can be restored by name elsewhere
  const io = audioIO.status()
  const project: Project = { ...rawProject, io: { inputLabel: io.activeInputLabel, outputLabel: io.activeOutputLabel } }
  const samples: Record<string, string> = {}
  for (const meta of project.samples) {
    const buf = sampleStore.get(meta.id)
    if (buf) samples[meta.id] = await blobToBase64(audioBufferToWav(buf))
  }
  const file: ProjectFile = { format: 'openstudio-project', version: 1, project, samples }
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
  downloadBlob(blob, `${project.name.replace(/[^\w\- ]+/g, '') || 'project'}.openstudio.json`)
}

export async function importProjectFile(file: File): Promise<void> {
  const text = await file.text()
  const parsed = JSON.parse(text) as ProjectFile
  if (parsed.format !== 'openstudio-project') throw new Error('Not an OpenStudio project file')
  const ctx = engine.ensure()
  for (const [id, b64] of Object.entries(parsed.samples ?? {})) {
    try {
      const buf = await ctx.decodeAudioData(base64ToArrayBuffer(b64))
      sampleStore.set(id, buf)
      void saveSampleToIDB(id, audioBufferToWav(buf))
    } catch {
      /* skip unreadable sample */
    }
  }
  replaceProject(parsed.project)
}

/** On startup: restore the autosaved project and rehydrate its samples from IndexedDB. */
export async function restoreSession(): Promise<void> {
  const project = loadAutosaved()
  if (!project) return
  replaceProject(project)
  if (project.samples.length === 0) return
  // Samples decode lazily once the AudioContext exists (first user gesture).
  const restore = async () => {
    const ctx = engine.ensure()
    for (const meta of project.samples) {
      if (sampleStore.has(meta.id)) continue
      const blob = await loadSampleFromIDB(meta.id)
      if (!blob) continue
      try {
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
        sampleStore.set(meta.id, buf)
      } catch {
        /* unreadable */
      }
    }
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('keydown', onGesture)
  }
  const onGesture = () => void restore()
  window.addEventListener('pointerdown', onGesture, { once: true })
  window.addEventListener('keydown', onGesture, { once: true })
}
