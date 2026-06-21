import type { Project, Segment, TextStyle } from '../types'

export interface TimelineState {
  segmentIndex: number
  segment: Segment
  localT: number
  sceneTime: number
  textCard: {
    segmentId: string
    style: TextStyle
    opacity: number
    // When true, the card is a fade-out "tail" lingering into the following
    // segment and must render *behind* the scene (the live shape occludes it),
    // not on top.
    behind: boolean
  } | null
}

// A faded-out text card lingers this long into the next segment, dissolving
// behind the returning shape instead of cutting hard. Capped to the next
// segment's duration so it never bleeds past it.
const FADE_OUT_TAIL_SEC = 1

// Cumulative segment start times + total duration. Precomputed when segments
// change (see Engine.setProject) so the per-frame timeline lookup doesn't
// re-sum every segment on every frame.
export interface TimelineIndex {
  starts: number[]
  total: number
}

export function buildTimelineIndex(segments: Segment[]): TimelineIndex {
  const starts: number[] = []
  let acc = 0
  for (const s of segments) {
    starts.push(acc)
    acc += s.durationSec
  }
  return { starts, total: acc }
}

// Resolve everything time-dependent about the timeline at absolute time t.
// Pass a precomputed `index` to skip rebuilding the cumulative starts each call.
export function computeTimeline(
  project: Project,
  t: number,
  index?: TimelineIndex
): TimelineState {
  const segments = project.segments
  const { starts, total } = index ?? buildTimelineIndex(segments)

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
    textCard = { segmentId: segment.id, style: segment.text, opacity, behind: false }
  }

  // Fade-out tail: if this segment isn't a text card but the previous one was a
  // fading text card, let its glyphs linger and fade out behind the live shape.
  // opacity is 1 at the boundary (matching where the text segment ended) → 0.
  if (!textCard && idx > 0) {
    const prev = segments[idx - 1]
    if (prev.kind === 'text' && prev.text && prev.text.reveal === 'fade') {
      const tail = Math.min(FADE_OUT_TAIL_SEC, segment.durationSec)
      if (tail > 0 && localT < tail) {
        textCard = {
          segmentId: prev.id,
          style: prev.text,
          opacity: 1 - localT / tail,
          behind: true,
        }
      }
    }
  }

  return { segmentIndex: idx, segment, localT, sceneTime, textCard }
}
