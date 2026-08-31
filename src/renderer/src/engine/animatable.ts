import type { Scalar, Easing } from '../types'

function applyEase(u: number, ease: Easing): number {
  const x = Math.min(1, Math.max(0, u))
  switch (ease) {
    case 'easeIn':
      return x * x
    case 'easeOut':
      return 1 - (1 - x) * (1 - x)
    case 'easeInOut':
      return x * x * (3 - 2 * x) // smoothstep
    case 'hold':
      return 0
    case 'linear':
    default:
      return x
  }
}

// Deterministic, pure evaluation of an animatable scalar at time t (seconds).
export function evalScalar(s: Scalar, t: number): number {
  if (s.kind === 'const') return s.value
  const keys = s.keys
  if (keys.length === 0) return 0
  if (keys.length === 1) return keys[0].value
  if (t <= keys[0].t) return keys[0].value
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.value
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      if (span <= 1e-9) return b.value
      const u = applyEase((t - a.t) / span, b.ease)
      if (b.ease === 'hold') return a.value
      return a.value + (b.value - a.value) * u
    }
  }
  return last.value
}
