// ---------------------------------------------------------------------------
// Learned taste profile for "Feeling lucky".
//
// A TasteProfile is one score map per learned axis (shape, mapping, flat
// surface, effect, object count, colour scheme, text colours, surface colours).
// It's fed by explicit 👍/👎 signals and implicit signals (hand-edit, save,
// export) and used to bias future rolls toward the user's taste via
// pickWeighted/pickDistinctWeighted — drop-in replacements for lucky.ts's
// uniform pick/pickDistinct.
//
// Bias is gentle by construction: weight = GROWTH^score (always positive), so
// a never-seen option (score 0 → weight 1) is always reachable. A 👍 (+3)
// multiplies weight by ~2.2×; a 👎 (−3) divides it by ~2.2×; MAX_SCORE
// bounds how dominant any one option can become; MIN_SCORE = −MAX_SCORE caps
// the suppression floor. Rolls get more specific over time without collapsing
// into a rut, and dislikes fade naturally as positive signals accumulate.
// ---------------------------------------------------------------------------

import {
  OBJECT_SURFACES,
  type ColorScheme,
  type LuckLocks,
  type Mapping,
  type ObjectSurface,
  type PrimitiveModel,
  type Project,
} from "../types";

export const FLAT_SURFACES = OBJECT_SURFACES.filter((s) => s !== "image") as ObjectSurface[];

export interface TasteProfile {
  shapes: Partial<Record<PrimitiveModel, number>>;
  mappings: Partial<Record<Mapping, number>>;
  flatSurfaces: Partial<Record<ObjectSurface, number>>;
  effects: Partial<Record<string, number>>; // keyed by EffectDef.id
  objectCounts: Partial<Record<"1" | "2", number>>;
  colorSchemes: Partial<Record<ColorScheme, number>>;
  textColors: Partial<Record<string, number>>; // keyed by lowercased hex
  surfaceColors: Partial<Record<string, number>>; // keyed by lowercased hex
}

export const EMPTY_TASTE_PROFILE: TasteProfile = {
  shapes: {},
  mappings: {},
  flatSurfaces: {},
  effects: {},
  objectCounts: {},
  colorSchemes: {},
  textColors: {},
  surfaceColors: {},
};

// Per-axis score cap; MIN_SCORE = −MAX_SCORE is the floor for dislikes.
const MAX_SCORE = 30;
const MIN_SCORE = -MAX_SCORE;
// Exponential base: weight = GROWTH^score, so score 0 → 1, +3 → ≈2.2×, −3 → ≈0.45×.
const GROWTH = 1.3;

export const LIKE_WEIGHT = 3;
export const DISLIKE_WEIGHT = -3;
export const EXPORT_WEIGHT = 3;
export const SAVE_WEIGHT = 2;
export const EDIT_WEIGHT = 1;
// A locked category is a deliberate "keep this exactly as-is" click, so it
// counts for more than an incidental hand-edit but is a per-axis signal
// rather than a whole-scene judgement, so it's weighted the same as a save.
export const LOCK_WEIGHT = 2;

// Weighted pick: weight = GROWTH^score, so a score-0 option always has weight
// 1 and is never excluded. Drop-in replacement for lucky.ts's uniform pick().
export function pickWeighted<T>(arr: readonly T[], scoreOf: (x: T) => number): T {
  const weights = arr.map((x) => Math.pow(GROWTH, scoreOf(x)));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

// Weighted sampling without replacement: pick `n` distinct elements from
// `arr` (or all of them if n exceeds length), each draw weighted by the
// remaining pool's scores. Drop-in replacement for lucky.ts's uniform
// pickDistinct().
export function pickDistinctWeighted<T>(
  arr: readonly T[],
  n: number,
  scoreOf: (x: T) => number,
): T[] {
  const pool = arr.slice();
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const weights = pool.map((x) => Math.pow(GROWTH, scoreOf(x)));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

// Bump every key present in `src` by `weight`, clamped to [MIN_SCORE, MAX_SCORE].
// Returns a new map; `dst` is never mutated.
function bumpAxis<K extends string>(
  dst: Partial<Record<K, number>>,
  src: Partial<Record<K, number>> | undefined,
  weight: number,
): Partial<Record<K, number>> {
  if (!src) return dst;
  const next = { ...dst };
  for (const key of Object.keys(src) as K[]) {
    next[key] = Math.max(MIN_SCORE, Math.min(MAX_SCORE, (next[key] ?? 0) + weight));
  }
  return next;
}

// Pure: bumps each axis value present in `features` by `weight`. Returns a
// new profile; `profile` is never mutated.
export function applyTasteSignal(
  profile: TasteProfile,
  features: Partial<TasteProfile>,
  weight: number,
): TasteProfile {
  return {
    shapes: bumpAxis(profile.shapes, features.shapes, weight),
    mappings: bumpAxis(profile.mappings, features.mappings, weight),
    flatSurfaces: bumpAxis(profile.flatSurfaces, features.flatSurfaces, weight),
    effects: bumpAxis(profile.effects, features.effects, weight),
    objectCounts: bumpAxis(profile.objectCounts, features.objectCounts, weight),
    colorSchemes: bumpAxis(profile.colorSchemes, features.colorSchemes, weight),
    textColors: bumpAxis(profile.textColors, features.textColors, weight),
    surfaceColors: bumpAxis(profile.surfaceColors, features.surfaceColors, weight),
  };
}

// Features extracted from whatever is currently on screen, used for both like
// and dislike signals. Per object: primitive, mapping (if textured) or flat
// surface, all effect defIds. Also: object count, colour scheme, actual text
// and surface colours (distinct, lowercased hex).
//
// Deliberately coarse — a signal credits *every* on-screen colour, not just
// "the one that mattered". Colours that recur across many liked scenes
// out-accumulate incidental ones; MAX_SCORE bounds influence.
export function extractSceneFeatures(
  project: Project,
  colorScheme: ColorScheme | null,
): Partial<TasteProfile> {
  const shapes: Partial<Record<PrimitiveModel, number>> = {};
  const mappings: Partial<Record<Mapping, number>> = {};
  const flatSurfaces: Partial<Record<ObjectSurface, number>> = {};
  const effects: Partial<Record<string, number>> = {};
  const textColors: Partial<Record<string, number>> = {};
  const surfaceColors: Partial<Record<string, number>> = {};

  for (const o of project.objects) {
    shapes[o.primitive] = 1;
    if (o.surface === "image") mappings[o.mapping] = 1;
    else {
      flatSurfaces[o.surface] = 1;
      surfaceColors[o.surfaceColor.toLowerCase()] = 1;
    }
    for (const fx of o.effects) effects[fx.defId] = 1;
  }

  const objectCounts: Partial<Record<"1" | "2", number>> = {
    [String(project.objects.length) as "1" | "2"]: 1,
  };

  for (const seg of project.segments) {
    if (seg.kind === "animation") {
      if (seg.backgroundColor) surfaceColors[seg.backgroundColor.toLowerCase()] = 1;
    } else if (seg.text) {
      textColors[seg.text.textColor.toLowerCase()] = 1;
      surfaceColors[seg.text.backgroundColor.toLowerCase()] = 1;
      surfaceColors[seg.text.textBackdropColor.toLowerCase()] = 1;
    }
  }

  const features: Partial<TasteProfile> = {
    shapes,
    mappings,
    flatSurfaces,
    effects,
    objectCounts,
    textColors,
    surfaceColors,
  };
  if (colorScheme) features.colorSchemes = { [colorScheme]: 1 };
  return features;
}

// Features credited when a locked category survives a re-roll: whatever's
// currently on screen for exactly the axes that category's lock preserves in
// applyLocks() (state/lucky.ts) — Objects -> shapes, Surface -> mappings +
// flatSurfaces, Effects -> effects, Colours -> colour scheme + text/surface
// colours. Motion has no categorical taste axis (rotation/scale/position are
// continuous scalars, not a pick from a pool), so a Motion lock credits
// nothing. Reuses extractSceneFeatures's full extraction and keeps only the
// locked subset, so both signals compute a scene's features the same way.
export function extractLockedFeatures(
  project: Project,
  colorScheme: ColorScheme | null,
  locks: LuckLocks,
): Partial<TasteProfile> {
  const all = extractSceneFeatures(project, colorScheme);
  const features: Partial<TasteProfile> = {};
  if (locks.objects) features.shapes = all.shapes;
  if (locks.surface) {
    features.mappings = all.mappings;
    features.flatSurfaces = all.flatSurfaces;
  }
  if (locks.effects) features.effects = all.effects;
  if (locks.colours) {
    features.colorSchemes = all.colorSchemes;
    features.textColors = all.textColors;
    features.surfaceColors = all.surfaceColors;
  }
  return features;
}

// Features credited by an implicit hand-edit signal: only what *changed*
// between `prev` and `next`. Compares object indices present in both
// projects on primitive and surface/mapping, and credits only *added* effect
// defIds (a removed effect is not "more disliked", so removals never
// decrement). Adds the count axis only when objects.length itself changed.
//
// An index that exists only in `next` (e.g. a 1->2 change) is credited
// solely on the count axis, never shape/surface — a freshly-added object
// carries a default the user didn't actively choose.
//
// Returns {} when nothing relevant changed (the caller must treat that as a
// no-op signal, not a zero-weight one).
export function diffEditFeatures(prev: Project, next: Project): Partial<TasteProfile> {
  const shapes: Partial<Record<PrimitiveModel, number>> = {};
  const mappings: Partial<Record<Mapping, number>> = {};
  const flatSurfaces: Partial<Record<ObjectSurface, number>> = {};
  const effects: Partial<Record<string, number>> = {};

  const sharedCount = Math.min(prev.objects.length, next.objects.length);
  for (let i = 0; i < sharedCount; i++) {
    const a = prev.objects[i];
    const b = next.objects[i];
    if (a.primitive !== b.primitive) shapes[b.primitive] = 1;
    if (b.surface === "image") {
      if (a.surface !== "image" || a.mapping !== b.mapping) mappings[b.mapping] = 1;
    } else if (a.surface !== b.surface) {
      flatSurfaces[b.surface] = 1;
    }
    const prevIds = new Set(a.effects.map((fx) => fx.defId));
    for (const fx of b.effects) {
      if (!prevIds.has(fx.defId)) effects[fx.defId] = 1;
    }
  }

  const features: Partial<TasteProfile> = {};
  if (Object.keys(shapes).length) features.shapes = shapes;
  if (Object.keys(mappings).length) features.mappings = mappings;
  if (Object.keys(flatSurfaces).length) features.flatSurfaces = flatSurfaces;
  if (Object.keys(effects).length) features.effects = effects;
  if (prev.objects.length !== next.objects.length) {
    features.objectCounts = {
      [String(next.objects.length) as "1" | "2"]: 1,
    };
  }
  return features;
}
