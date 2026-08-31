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

// Sorted key times for an animated scalar; [] for a constant.
export function keyTimes(s: Scalar): number[] {
  return s.kind === 'keys' ? s.keys.map((k) => k.t) : []
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

// Move the key nearest oldT to newT, preserving its value and easing.
export function moveKeyAt(s: Scalar, oldT: number, newT: number): Scalar {
  if (s.kind !== 'keys') return s
  const keys = s.keys.map((k) => ({ ...k }))
  const i = keys.findIndex((k) => Math.abs(k.t - oldT) < EPS)
  if (i < 0) return s
  keys[i] = { ...keys[i], t: newT }
  keys.sort((a, b) => a.t - b.t)
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
