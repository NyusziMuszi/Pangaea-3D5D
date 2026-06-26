import type { Project, Segment, TextStyle } from '../types'

export interface TimelineState {
  segmentIndex: number
  segment: Segment
  localT: number
  sceneTime: number
  // WebGL clear colour for this moment: the active break's colour, held through
  // the text card that follows it.
  backgroundColor: string
  textCard: {
    segmentId: string
    style: TextStyle
    opacity: number
    // When true, the card is a fade-in "tail" previewing the upcoming text
    // segment during the tail end of the preceding segment, and must render
    // *behind* the scene (the live shape occludes it), not on top.
    behind: boolean
  } | null
}

// Before a fading text card, its glyphs fade in behind the live shape for this
// long at the tail end of the preceding segment, easing into the card instead
// of cutting hard. Capped to that segment's duration so it never starts early.
const FADE_IN_TAIL_SEC = 2

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

  // The clear colour comes from the active break. On a text card we look back to
  // the nearest preceding animation segment so the break's colour holds through
  // it; fall back to the first animation segment's colour, then a literal.
  const DEFAULT_BG = '#281b6c'
  let backgroundColor = DEFAULT_BG
  if (segment.kind === 'animation' && segment.backgroundColor) {
    backgroundColor = segment.backgroundColor
  } else {
    let found: string | undefined
    for (let i = idx; i >= 0; i--) {
      if (segments[i].kind === 'animation' && segments[i].backgroundColor) {
        found = segments[i].backgroundColor
        break
      }
    }
    backgroundColor =
      found ??
      segments.find((s) => s.kind === 'animation' && s.backgroundColor)
        ?.backgroundColor ??
      DEFAULT_BG
  }

  let textCard: TimelineState['textCard'] = null
  if (segment.kind === 'text' && segment.text) {
    let opacity = 1
    if (segment.text.reveal === 'fade') {
      // A card preceded by an animation segment already had its glyphs faded in
      // by the before-tail, so it snaps to full opacity for a seamless
      // behind→front handoff. Without a tail (e.g. first segment, or following
      // another text card) it keeps the short fade-in.
      const hadTail = idx > 0 && segments[idx - 1].kind === 'animation'
      if (!hadTail) {
        const fade = Math.min(0.4, segment.durationSec * 0.3)
        opacity = fade > 0 ? Math.min(1, localT / fade) : 1
      }
    }
    textCard = { segmentId: segment.id, style: segment.text, opacity, behind: false }
  }

  // Fade-in tail: if this segment isn't a text card but the NEXT one is a
  // fading text card, preview its glyphs behind the live shape, fading in
  // (0 → 1) over the final FADE_IN_TAIL_SEC of this segment. Capped to the
  // segment's duration so it never starts before the segment does.
  if (!textCard && idx < segments.length - 1) {
    const next = segments[idx + 1]
    if (next.kind === 'text' && next.text && next.text.reveal === 'fade') {
      const tail = Math.min(FADE_IN_TAIL_SEC, segment.durationSec)
      const tailStart = segment.durationSec - tail
      if (tail > 0 && localT >= tailStart) {
        textCard = {
          segmentId: next.id,
          style: next.text,
          opacity: (localT - tailStart) / tail,
          behind: true,
        }
      }
    }
  }

  return { segmentIndex: idx, segment, localT, sceneTime, backgroundColor, textCard }
}
