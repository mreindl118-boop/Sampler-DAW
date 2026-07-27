import type { AutomationLane } from '../state/types'

/** Interpolated automation value at a beat (points assumed sorted). */
export function laneValueAt(lane: AutomationLane, beat: number, fallback: number): number {
  const pts = lane.points
  if (pts.length === 0) return fallback
  if (beat <= pts[0].beat) return pts[0].value
  if (beat >= pts[pts.length - 1].beat) return pts[pts.length - 1].value
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (beat >= a.beat && beat <= b.beat) {
      const f = b.beat === a.beat ? 0 : (beat - a.beat) / (b.beat - a.beat)
      return a.value + (b.value - a.value) * f
    }
  }
  return fallback
}

/**
 * Schedule a lane onto an AudioParam for the window [fromBeat, toBeat).
 * Sets the boundary value then linear-ramps through interior points.
 */
export function scheduleLane(
  param: AudioParam,
  lane: AutomationLane,
  fromBeat: number,
  toBeat: number,
  beatToTime: (b: number) => number,
  fallback: number,
  transform: (v: number) => number = (v) => v
): void {
  if (!lane.enabled) return
  const startVal = transform(laneValueAt(lane, fromBeat, fallback))
  const t0 = beatToTime(fromBeat)
  param.setValueAtTime(startVal, Math.max(0, t0))
  for (const pt of lane.points) {
    if (pt.beat > fromBeat && pt.beat <= toBeat) {
      param.linearRampToValueAtTime(transform(pt.value), beatToTime(pt.beat))
    }
  }
  const endVal = transform(laneValueAt(lane, toBeat, fallback))
  param.linearRampToValueAtTime(endVal, beatToTime(toBeat))
}
