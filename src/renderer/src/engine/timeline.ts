import type { Project, Segment, TextStyle } from '../types'

export interface TimelineState {
  segmentIndex: number
  segment: Segment
  localT: number
  sceneTime: number
  textCard: { segmentId: string; style: TextStyle; opacity: number } | null
}

// Resolve everything time-dependent about the timeline at absolute time t.
export function computeTimeline(project: Project, t: number): TimelineState {
  const segments = project.segments
  const starts: number[] = []
  let acc = 0
  for (const s of segments) {
    starts.push(acc)
    acc += s.durationSec
  }
  const total = acc

  const clamped = Math.max(0, Math.min(t, Math.max(0, total - 1e-4)))
  let idx = 0
  for (let i = 0; i < segments.length; i++) {
    if (clamped >= starts[i]) idx = i
  }
  const segment = segments[idx]
  const localT = clamped - starts[idx]

  const sceneTime = clamped

  let textCard: TimelineState['textCard'] = null
  if (segment.kind === 'text' && segment.text) {
    let opacity = 1
    if (segment.text.reveal === 'fade') {
      // Every card fades in, then cuts back at the end (no fade-out) — the
      // segment simply ends at full opacity.
      const fade = Math.min(0.4, segment.durationSec * 0.3)
      opacity = fade > 0 ? Math.min(1, localT / fade) : 1
    }
    textCard = { segmentId: segment.id, style: segment.text, opacity }
  }

  return { segmentIndex: idx, segment, localT, sceneTime, textCard }
}
