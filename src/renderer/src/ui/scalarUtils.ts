import type { Scalar } from '../types'
import { evalScalar } from '../engine/animatable'

const EPS = 1e-3

export function isAnimated(s: Scalar): boolean {
  return s.kind === 'keys'
}

export function hasKeyAt(s: Scalar, t: number): boolean {
  return s.kind === 'keys' && s.keys.some((k) => Math.abs(k.t - t) < EPS)
}

// Set the value at the current playhead. For animated scalars this upserts a
// keyframe; for constants it just changes the constant.
export function setValueAt(s: Scalar, t: number, value: number): Scalar {
  if (s.kind === 'const') return { kind: 'const', value }
  const keys = s.keys.map((k) => ({ ...k }))
  const i = keys.findIndex((k) => Math.abs(k.t - t) < EPS)
  if (i >= 0) keys[i].value = value
  else {
    keys.push({ t, value, ease: 'easeInOut' })
    keys.sort((a, b) => a.t - b.t)
  }
  return { kind: 'keys', keys }
}

export function startAnimating(s: Scalar, t: number): Scalar {
  return { kind: 'keys', keys: [{ t, value: evalScalar(s, t), ease: 'easeInOut' }] }
}

export function stopAnimating(s: Scalar, t: number): Scalar {
  return { kind: 'const', value: evalScalar(s, t) }
}

// Sorted key times for an animated scalar; [] for a constant.
export function keyTimes(s: Scalar): number[] {
  return s.kind === 'keys' ? s.keys.map((k) => k.t) : []
}

// Greatest key time strictly before t (using EPS so sitting on a key steps away).
export function prevKeyTime(s: Scalar, t: number): number | null {
  if (s.kind !== 'keys') return null
  let best: number | null = null
  for (const k of s.keys) {
    if (k.t < t - EPS) best = k.t
  }
  return best
}

// Least key time strictly after t (keys are sorted, so the first match wins).
export function nextKeyTime(s: Scalar, t: number): number | null {
  if (s.kind !== 'keys') return null
  for (const k of s.keys) {
    if (k.t > t + EPS) return k.t
  }
  return null
}

// Remove the key within EPS of t. No-op if none matches; reverts to const when
// the final key is removed (mirrors toggleKeyAt).
export function removeKeyAt(s: Scalar, t: number): Scalar {
  if (s.kind !== 'keys') return s
  const keys = s.keys.filter((k) => Math.abs(k.t - t) >= EPS)
  if (keys.length === s.keys.length) return s
  if (keys.length === 0) return { kind: 'const', value: evalScalar(s, t) }
  return { kind: 'keys', keys }
}

// Toggle a keyframe at the playhead (diamond button behavior).
export function toggleKeyAt(s: Scalar, t: number): Scalar {
  if (s.kind === 'const') return startAnimating(s, t)
  const keys = s.keys.map((k) => ({ ...k }))
  const i = keys.findIndex((k) => Math.abs(k.t - t) < EPS)
  if (i >= 0) {
    keys.splice(i, 1)
    if (keys.length === 0) return { kind: 'const', value: evalScalar(s, t) }
    return { kind: 'keys', keys }
  }
  keys.push({ t, value: evalScalar(s, t), ease: 'easeInOut' })
  keys.sort((a, b) => a.t - b.t)
  return { kind: 'keys', keys }
}

export { evalScalar }
