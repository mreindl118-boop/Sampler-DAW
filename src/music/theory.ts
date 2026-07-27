// ---------- Music theory: notes, scales, chords, progressions ----------

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export interface Scale {
  name: string
  intervals: number[]
}

export const SCALES: Scale[] = [
  { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
  { name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  { name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  { name: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
]

export interface ChordType {
  symbol: string
  name: string
  intervals: number[]
}

export const CHORD_TYPES: ChordType[] = [
  { symbol: '', name: 'Major', intervals: [0, 4, 7] },
  { symbol: 'm', name: 'Minor', intervals: [0, 3, 7] },
  { symbol: 'dim', name: 'Diminished', intervals: [0, 3, 6] },
  { symbol: 'aug', name: 'Augmented', intervals: [0, 4, 8] },
  { symbol: 'sus2', name: 'Sus 2', intervals: [0, 2, 7] },
  { symbol: 'sus4', name: 'Sus 4', intervals: [0, 5, 7] },
  { symbol: '5', name: 'Power', intervals: [0, 7, 12] },
  { symbol: '6', name: 'Major 6', intervals: [0, 4, 7, 9] },
  { symbol: 'm6', name: 'Minor 6', intervals: [0, 3, 7, 9] },
  { symbol: '7', name: 'Dominant 7', intervals: [0, 4, 7, 10] },
  { symbol: 'maj7', name: 'Major 7', intervals: [0, 4, 7, 11] },
  { symbol: 'm7', name: 'Minor 7', intervals: [0, 3, 7, 10] },
  { symbol: 'm7b5', name: 'Half-dim', intervals: [0, 3, 6, 10] },
  { symbol: 'dim7', name: 'Dim 7', intervals: [0, 3, 6, 9] },
  { symbol: '9', name: 'Dominant 9', intervals: [0, 4, 7, 10, 14] },
  { symbol: 'maj9', name: 'Major 9', intervals: [0, 4, 7, 11, 14] },
  { symbol: 'm9', name: 'Minor 9', intervals: [0, 3, 7, 10, 14] },
  { symbol: 'add9', name: 'Add 9', intervals: [0, 4, 7, 14] },
  { symbol: 'madd9', name: 'Min Add 9', intervals: [0, 3, 7, 14] },
  { symbol: '11', name: 'Dominant 11', intervals: [0, 4, 7, 10, 14, 17] },
  { symbol: '13', name: 'Dominant 13', intervals: [0, 4, 7, 10, 14, 21] },
  { symbol: '7b9', name: 'Dom 7 b9', intervals: [0, 4, 7, 10, 13] },
  { symbol: '7#9', name: 'Dom 7 #9', intervals: [0, 4, 7, 10, 15] },
]

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

export interface DiatonicChord {
  degree: number // 0-based
  roman: string
  rootMidi: number // in octave 4 area
  rootName: string
  symbol: string // e.g. Am7
  intervals: number[] // relative to root
}

/** Build 7th chords on each degree of a scale by stacking scale thirds. */
export function diatonicChords(key: number, scaleName: string, sevenths = true): DiatonicChord[] {
  const scale = SCALES.find((s) => s.name === scaleName) ?? SCALES[0]
  const iv = scale.intervals
  if (iv.length < 5) {
    // pentatonic/blues: fall back to triads from the parent major/minor feel
    return []
  }
  const out: DiatonicChord[] = []
  for (let d = 0; d < iv.length; d++) {
    const at = (i: number) => iv[(d + i) % iv.length] + 12 * Math.floor((d + i) / iv.length)
    const root = at(0)
    const third = at(2) - root
    const fifth = at(4) - root
    const seventh = at(6) - root
    const intervals = sevenths ? [0, third, fifth, seventh] : [0, third, fifth]
    let quality = ''
    let roman = ROMAN[d % 7]
    if (third === 3) roman = roman.toLowerCase()
    if (third === 4 && fifth === 7) quality = sevenths ? (seventh === 11 ? 'maj7' : '7') : ''
    else if (third === 3 && fifth === 7) quality = sevenths ? 'm7' : 'm'
    else if (third === 3 && fifth === 6) {
      quality = sevenths ? (seventh === 9 ? 'dim7' : 'm7b5') : 'dim'
      roman += '°'
    } else if (third === 4 && fifth === 8) {
      quality = 'aug'
      roman += '+'
    }
    const rootMidi = 60 + ((key + root) % 12)
    out.push({
      degree: d,
      roman,
      rootMidi,
      rootName: NOTE_NAMES[(key + root) % 12],
      symbol: `${NOTE_NAMES[(key + root) % 12]}${quality}`,
      intervals,
    })
  }
  return out
}

export interface Progression {
  name: string
  degrees: number[] // 0-based scale degrees
}

export const PROGRESSIONS: Progression[] = [
  { name: 'I–V–vi–IV (Pop)', degrees: [0, 4, 5, 3] },
  { name: 'vi–IV–I–V (Emotional)', degrees: [5, 3, 0, 4] },
  { name: 'ii–V–I (Jazz)', degrees: [1, 4, 0] },
  { name: 'I–IV–V–IV (Rock)', degrees: [0, 3, 4, 3] },
  { name: 'I–vi–ii–V (50s / Doo-wop)', degrees: [0, 5, 1, 4] },
  { name: 'i–VI–III–VII (Minor Pop)', degrees: [0, 5, 2, 6] },
  { name: 'I–iii–vi–IV', degrees: [0, 2, 5, 3] },
  { name: 'i–iv–v (Minor Blues)', degrees: [0, 3, 4] },
  { name: 'I–I–IV–V (12-bar feel)', degrees: [0, 0, 3, 4] },
  { name: 'IV–V–iii–vi (Anime / J-pop)', degrees: [3, 4, 2, 5] },
]

/** Notes of a chord, voiced from a root MIDI note. */
export function chordNotes(rootMidi: number, intervals: number[]): number[] {
  return intervals.map((i) => rootMidi + i)
}

/** All pitches of a scale across a MIDI range (for piano-roll highlighting). */
export function scalePitchSet(key: number, scaleName: string): Set<number> {
  const scale = SCALES.find((s) => s.name === scaleName) ?? SCALES[0]
  const set = new Set<number>()
  for (const iv of scale.intervals) set.add((key + iv) % 12)
  return set
}
