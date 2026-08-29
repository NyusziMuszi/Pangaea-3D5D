// ---------------------------------------------------------------------------
// "Feeling lucky" — a pure random-scene generator.
//
// Given a base project, a palette of colours, a set of image data URLs, and a
// set of options, produce a brand-new project that randomizes visuals only:
// the objects (shape, texture, transform), effects, keyframes, and the scene +
// text-card colours. The timeline (segment count, durations, text *content*)
// is preserved. Output is always animated: scale, one rotation axis, and one
// effect's intensity are always keyframed.
//
// Three independent controls steer a generation. objectCounts and colorSchemes
// are *sets* the user has chosen to explore; each generation randomly picks one
// entry from each (an empty set falls back to "all" as a safety net):
//   - objectCount: render one object or two.
//   - colorScheme: how colour trios are dealt across segments —
//       "byType"  one trio for all animation breaks, a different trio for all
//                 text cards;
//       "byPair"  each animation break and the text card(s) that follow it
//                 share their own trio, so each break reads continuously into
//                 its text card;
//       "random"  every segment coloured independently.
//   - animation: overall animation amount [0,1] driving effect count, keyframe
//                count, animated transform extras, and rotation intensity.
//
// A colour "trio" (from pickTextColors) is a background + silhouette on one
// lightness side and text on the opposite side, so text always reads.
// ---------------------------------------------------------------------------

import type {
  ColorScheme,
  EffectDef,
  EffectInstance,
  LuckLocks,
  Mapping,
  ObjectState,
  ObjectSurface,
  PrimitiveModel,
  Project,
  RampColorMode,
  Scalar,
  TextBlendMode,
  TextStyle,
} from "../types";
import {
  ALL_UNLOCKED,
  COLOR_SCHEMES,
  constant,
  MAPPINGS,
  PRIMITIVE_MODELS,
  RAMP_COLOR_MODES,
  SURFACE_COLOR_LIGHT_DEFAULT,
  SURFACE_COLOR_LOW_DEFAULT,
  totalDuration,
} from "../types";
import { BUILTIN_EFFECTS } from "../engine/effects/catalog";
import {
  defaultObjectImage,
  defaultSecondObject,
  instanceFromDef,
} from "./defaults";
import {
  EMPTY_TASTE_PROFILE,
  FLAT_SURFACES,
  pickDistinctWeighted,
  pickWeighted,
  type TasteProfile,
} from "./taste";

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Pick `n` distinct elements from `arr` (or all of them if n exceeds length).
function pickDistinct<T>(arr: T[], n: number): T[] {
  const pool = arr.slice();
  const out: T[] = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

// "#rrggbb" -> [r,g,b] each in 0..1. Defaults to white on a malformed hex.
function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Perceived lightness 0..1 (sRGB luma). >= 0.5 reads as a "light" colour.
function lightness(hex: string): number {
  const [r, g, b] = hexToRgb01(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// A distinct working palette of at most `budget` colours, guaranteed to contain
// at least one light and one dark colour so text contrast is always satisfiable
// without exceeding the budget.
function buildScenePalette(palette: string[], budget: number): string[] {
  const uniq = Array.from(new Set(palette));
  for (const f of ["#A3D6DC", "#64e36e", "#6473e3", "#000000", "#ffffff"]) {
    if (uniq.length >= budget) break;
    if (!uniq.includes(f)) uniq.push(f);
  }
  const chosen = pickDistinct(uniq, budget);
  if (!chosen.some((c) => lightness(c) >= 0.5)) chosen[chosen.length - 1] = "#ffffff";
  if (!chosen.some((c) => lightness(c) < 0.5)) chosen[chosen.length - 1] = "#000000";
  return chosen;
}

// Pick { backdropColor, background, text } for one text card: background +
// silhouette come from the surface palette (one lightness side), text comes
// from the type palette (the opposite side, so it always reads).
function pickTextColors(
  surfacePool: string[],
  typePool: string[],
  surfScore: (c: string) => number,
  typeScore: (c: string) => number,
): {
  backdropColor: string;
  background: string;
  text: string;
} {
  const sLight = surfacePool.filter((c) => lightness(c) >= 0.5);
  const sDark = surfacePool.filter((c) => lightness(c) < 0.5);
  const tLight = typePool.filter((c) => lightness(c) >= 0.5);
  const tDark = typePool.filter((c) => lightness(c) < 0.5);
  // background + silhouette must come from a side with >= 2 colours so they can
  // be distinct. With a budget >= 3 and at least one colour on each side, one
  // side always has >= 2 (pigeonhole), so we steer lightTheme toward it rather
  // than flipping a blind coin (which could land on a single-colour side and
  // collapse background + silhouette to one colour).
  const canLight = sLight.length >= 2;
  const canDark = sDark.length >= 2;
  const lightTheme = canLight && canDark ? Math.random() < 0.5 : canLight;
  const sameSide = lightTheme ? sLight : sDark; // background + silhouette
  const opposite = lightTheme ? tDark : tLight; // text, from the type palette
  const [background, second] = pickDistinctWeighted(sameSide, 2, surfScore);
  const textChoices = opposite.length ? opposite : typePool;
  return { background, backdropColor: second ?? background, text: pickWeighted(textChoices, typeScore) };
}

// Build an animated scalar of `n` keys spread evenly across [0, dur], easing
// "easeInOut". valFn(i, frac) supplies each value, where frac = i/(n-1). A
// zero-length timeline collapses to a single key at t=0.
function spreadKeys(
  dur: number,
  n: number,
  valFn: (i: number, frac: number) => number,
): Scalar {
  if (dur <= 0 || n <= 1) {
    return {
      kind: "keys",
      keys: [{ t: 0, value: valFn(0, 0), ease: "easeInOut" }],
    };
  }
  const keys = [];
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    keys.push({
      t: frac * dur,
      value: valFn(i, frac),
      ease: "easeInOut" as const,
    });
  }
  return { kind: "keys", keys };
}

export interface LuckyOptions {
  objectCounts: (1 | 2)[];
  colorSchemes: ColorScheme[];
  blendModes: TextBlendMode[];
  textBackdrops: ("silhouette" | "wireframe")[];
  animation: number; // 0..1 overall animation amount
  locks?: LuckLocks;
  // Which built-in effect IDs to draw from; undefined = all.
  enabledEffectIds?: string[];
  // Which mapping modes to use for image surfaces; undefined = all.
  mappings?: Mapping[];
  // Which surfaces Explore may roll: the flat ones a non-image object may be
  // dressed in, plus "image" to allow an object to wear a palette image.
  // Undefined or empty = all of OBJECT_SURFACES.
  surfaces?: ObjectSurface[];
  // Which primitive shapes Explore may roll; undefined or empty = all.
  shapes?: PrimitiveModel[];
  // Which ramp end-colours Explore may give a faceted/depth surface; undefined
  // or empty = all.
  rampColors?: RampColorMode[];
  // Learned bias toward the user's taste (see state/taste.ts). Absent (e.g.
  // older callers) is treated as no bias — rolls stay uniform.
  tasteProfile?: TasteProfile;
}

// Restore locked categories' values from `base` (the pre-generation project)
// onto `next`, so a locked category survives a re-roll untouched. Sub-objects
// copied across are structuredClone'd so `next` shares no references with
// `base` (which is the live store project when called from the UI).
//
// Per-object copies (motion/effects/objects) are guarded on `base.objects[i]`
// existing: when Objects is unlocked the generated object count may differ
// from base, so indices beyond base just keep their freshly generated values.
// Segment copies (colours) are always 1:1 — generateLuckyScene never changes
// segment count or order.
//
// Fresnel tint lives in the effect instance's values, so it follows the
// Effects lock, not Colours — no special-casing needed here.
function applyLocks(base: Project, next: Project, locks: LuckLocks): void {
  if (locks.objects) {
    next.objects.forEach((o, i) => {
      const b = base.objects[i];
      if (!b) return;
      o.primitive = b.primitive;
      o.modelName = b.modelName;
      o.modelDataUrl = b.modelDataUrl;
      o.mapping = b.mapping;
      o.surface = b.surface;
      o.surfaceWireWidth = b.surfaceWireWidth;
      o.image = structuredClone(b.image);
    });
  }
  if (locks.motion) {
    next.objects.forEach((o, i) => {
      const b = base.objects[i];
      if (!b) return;
      o.rotX = structuredClone(b.rotX);
      o.rotY = structuredClone(b.rotY);
      o.rotZ = structuredClone(b.rotZ);
      o.scale = structuredClone(b.scale);
      o.posX = structuredClone(b.posX);
      o.posY = structuredClone(b.posY);
      o.posZ = structuredClone(b.posZ);
    });
  }
  if (locks.effects) {
    next.objects.forEach((o, i) => {
      const b = base.objects[i];
      if (!b) return;
      o.effects = structuredClone(b.effects);
    });
  }
  if (locks.colours) {
    next.segments.forEach((seg, i) => {
      const b = base.segments[i];
      if (seg.kind === "animation") seg.backgroundColor = b.backgroundColor;
      else if (seg.text && b.text) {
        seg.text.textColor = b.text.textColor;
        seg.text.backgroundColor = b.text.backgroundColor;
        seg.text.textBackdropColor = b.text.textBackdropColor;
        seg.text.textBackdrop = b.text.textBackdrop;
        seg.text.textBlend = b.text.textBlend;
      }
    });
    next.objects.forEach((o, i) => {
      const b = base.objects[i];
      if (b) {
        o.surfaceColor = b.surfaceColor;
        o.surfaceColorLight = b.surfaceColorLight;
        o.surfaceColorLow = b.surfaceColorLow;
      }
    });
  }
}

export function generateLuckyScene(
  base: Project,
  surfaceColors: string[],
  typeColors: string[],
  imageAssetIds: string[],
  opts: LuckyOptions,
): { project: Project; colorScheme: ColorScheme } {
  const anim = clamp(opts.animation, 0, 1);
  const effectCount = clamp(1 + Math.round(anim * 6), 1, 7);
  const locks = opts.locks ?? ALL_UNLOCKED;
  const tasteProfile = opts.tasteProfile ?? EMPTY_TASTE_PROFILE;
  const surfScore = (c: string): number => tasteProfile.surfaceColors?.[c.toLowerCase()] ?? 0;
  const typeScore = (c: string): number => tasteProfile.textColors?.[c.toLowerCase()] ?? 0;
  // Pin count when Objects locked, so per-object motion/effects/colour locks
  // (which copy by matching index) always line up with base. Otherwise pick
  // one entry from each explored set (empty falls back to the full range),
  // biased toward the learned taste profile.
  const objectCount = locks.objects
    ? (clamp(base.objects.length, 1, 2) as 1 | 2)
    : pickWeighted(
        opts.objectCounts.length ? opts.objectCounts : [1, 2],
        (n) => tasteProfile.objectCounts[String(n) as "1" | "2"] ?? 0,
      );
  // Intersect against COLOR_SCHEMES so a stale entry from an older project
  // file or preferences.json never gets rolled; an empty result (all-stale or
  // genuinely empty) falls back to all.
  const validColorSchemes = opts.colorSchemes.filter((cs) =>
    COLOR_SCHEMES.includes(cs),
  );
  const colorScheme = pickWeighted<ColorScheme>(
    validColorSchemes.length ? validColorSchemes : COLOR_SCHEMES,
    (cs) => tasteProfile.colorSchemes[cs] ?? 0,
  );
  const blendMode = pick<TextBlendMode>(
    opts.blendModes.length
      ? opts.blendModes
      : ["normal", "invert", "exclusion", "multiply", "screen"],
  );
  const textBackdrop = pick<"silhouette" | "wireframe">(
    opts.textBackdrops.length ? opts.textBackdrops : ["silhouette", "wireframe"],
  );
  const twoObjects = objectCount === 2;
  // No slider is ever worth more than 3 keyframes — even at the hottest setting.
  const keyCount = clamp(2 + Math.round(anim), 2, 3);
  const animatedExtras = Math.round(anim * 2);

  // Preserve output, version, customEffects, and the full segments array
  // (durations + text content). structuredClone keeps the timeline intact.
  const next = structuredClone(base) as Project;
  const dur = totalDuration(base);

  const palette = surfaceColors.length
    ? surfaceColors
    : [
        base.segments.find((s) => s.kind === "animation")?.backgroundColor ??
          "#281b6c",
        "#A3D6DC",
        "#64e36e",
        "#6473e3",
      ];
  const textPalette = typeColors.length ? typeColors : ["#ffffff", "#000000"];

  // Distinct colours a single generation may use. Per-segment schemes need more
  // room (5) so trios can differ; the single-type scheme stays tighter (4).
  const colorBudget = colorScheme === "byType" ? 4 : 5;
  const scenePalette = buildScenePalette(palette, colorBudget);
  // buildScenePalette pads scenePalette with synthetic fallback colours
  // (including #000000/#ffffff) to guarantee a light+dark side for text
  // contrast. Those synthetics must never paint an object's flat surface
  // (silhouette/wireframe/faceted) — pickSurfaceColor below draws only from
  // this unpadded set, same reasoning as typePalette just above.
  const realSurfacePalette = Array.from(new Set(palette));
  // The type palette only ever supplies a single text colour per card, so it
  // needs no budget and no padding. Pass the user's distinct type colours
  // through unchanged — buildScenePalette would inject undefined fallback
  // colours (e.g. #6473e3), which must never appear in text the user did not
  // define.
  const typePalette = Array.from(new Set(textPalette));

  // Object appearance. Image vs. flat is dealt per object: an object can wear a
  // textured "image" surface (random asset + random mapping mode) or fall back
  // to a flat surface (silhouette / wireframe / faceted) drawn in a palette
  // colour, leaving the image slot empty so the UI still offers "Load image"
  // rather than "Replace".
  //
  // With two objects and at least one image, exactly one object wears the image
  // and the other takes a flat surface, so the pair reads as image-against-
  // silhouette rather than two textured shapes. A single object (or none with
  // images) simply wears the image itself. The two flat surfaces are picked
  // distinct (where opts.surfaces allows — a single-entry set gives both
  // objects the same surface) so a fully-flat pair still reads differently.
  // "image" in opts.surfaces gates whether an object may wear a palette image
  // at all; an empty/absent set means everything is allowed, as elsewhere.
  const exploredSurfaces = opts.surfaces?.length ? opts.surfaces : null;
  const allowImage = !exploredSurfaces || exploredSurfaces.includes("image");
  const flatPool = (exploredSurfaces ?? FLAT_SURFACES).filter((s) => s !== "image");
  const hasImages = imageAssetIds.length > 0 && allowImage;
  const imageObject = !hasImages ? -1 : twoObjects && Math.random() < 0.5 ? 1 : 0;
  const flatSurfaces = pickDistinctWeighted(
    flatPool.length ? flatPool : FLAT_SURFACES,
    2,
    (s) => tasteProfile.flatSurfaces[s] ?? 0,
  );
  const availableMappings =
    opts.mappings && opts.mappings.length ? opts.mappings : MAPPINGS;

  // Set an object's surface + image slot for its index. The image object gets a
  // textured surface (random asset + mapping); any other object gets a flat
  // surface in a background-safe palette colour and an empty image slot.
  const dressObject = (o: ObjectState, i: number): void => {
    if (i === imageObject) {
      o.surface = "image";
      o.mapping = pickWeighted(availableMappings, (m) => tasteProfile.mappings[m] ?? 0);
      o.image = {
        name: "lucky",
        assetId: pick(imageAssetIds),
        offsetX: constant(0.5),
        offsetY: constant(0.5),
      };
    } else {
      o.surface = flatSurfaces[i % flatSurfaces.length];
      o.surfaceColor = pickSurfaceColor();
      if (o.surface === "faceted") o.surfaceColorLight = pickRamp(o.surfaceColor);
      else if (o.surface === "depth") o.surfaceColorLow = pickRamp(o.surfaceColor);
      o.image = defaultObjectImage();
    }
  };

  // Apply a colour trio to a text card: background, silhouette backdrop, text.
  const applyTrio = (
    t: TextStyle,
    trio: { background: string; backdropColor: string; text: string },
  ): void => {
    t.backgroundColor = trio.background;
    t.textBackdropColor = trio.backdropColor;
    t.textColor = trio.text;
  };

  // ----- Colour assignment (scheme-driven) -----
  // Animation breaks only take a trio's `background`; text cards take the full
  // trio so background + silhouette sit on one lightness side and text on the
  // other (pickTextColors guarantees this), keeping text legible everywhere.
  if (colorScheme === "byType") {
    // One trio for all animation breaks, a different one for all text cards.
    const objTrio = pickTextColors(scenePalette, typePalette, surfScore, typeScore);
    let textTrio = pickTextColors(scenePalette, typePalette, surfScore, typeScore);
    for (let i = 0; i < 6 && textTrio.background === objTrio.background; i++) {
      textTrio = pickTextColors(scenePalette, typePalette, surfScore, typeScore);
    }
    for (const seg of next.segments) {
      if (seg.kind === "animation") seg.backgroundColor = objTrio.background;
      else if (seg.text) applyTrio(seg.text, textTrio);
    }
  } else if (colorScheme === "byPair") {
    // One trio per animation break; the text card(s) following it reuse it, so
    // each break reads continuously into its text card. Pre-pick distinct trios
    // for the breaks, cycling if the palette can't yield enough distinct ones.
    // At least one trio so a leading/orphan text card always has a colour.
    const breakCount = Math.max(
      next.segments.filter((s) => s.kind === "animation").length,
      1,
    );
    const trios: ReturnType<typeof pickTextColors>[] = [];
    for (let i = 0; i < breakCount; i++) {
      let trio = pickTextColors(scenePalette, typePalette, surfScore, typeScore);
      for (
        let r = 0;
        r < 6 && trios.some((t) => t.background === trio.background);
        r++
      ) {
        trio = pickTextColors(scenePalette, typePalette, surfScore, typeScore);
      }
      trios.push(trio);
    }
    // Walk segments tracking the current pair. A leading text card with no
    // preceding break falls back to the first trio.
    let pair = -1;
    for (const seg of next.segments) {
      if (seg.kind === "animation") {
        pair++;
        seg.backgroundColor = trios[pair % trios.length].background;
      } else if (seg.text) {
        const trio = trios[Math.max(pair, 0) % trios.length];
        applyTrio(seg.text, trio);
      }
    }
  } else {
    // random: every segment coloured independently.
    for (const seg of next.segments) {
      if (seg.kind === "animation") seg.backgroundColor = pickWeighted(scenePalette, surfScore);
      else if (seg.text) applyTrio(seg.text, pickTextColors(scenePalette, typePalette, surfScore, typeScore));
    }
  }

  // One backdrop style + blend per generation, applied to every text card.
  // textBlend only visibly matters when textBackdrop is "silhouette" (see
  // types.ts), but setting it unconditionally keeps the field consistent if
  // the card's backdrop is later switched to silhouette by hand.
  for (const seg of next.segments) {
    if (!seg.text) continue;
    seg.text.textBackdrop = textBackdrop;
    seg.text.textBlend = blendMode;
  }

  // A silhouette object is drawn flat in its surfaceColor against the animation
  // background, so picking the same colour as a background it sits on makes the
  // object vanish. Collect the backgrounds in use and pick surface colours from
  // the rest of the palette (falling back to the full palette only if every
  // colour is taken as a background).
  const animBackgrounds = new Set(
    next.segments
      .filter((s) => s.kind === "animation")
      .map((s) => s.backgroundColor),
  );
  // Track colours already dealt to other objects so two flat objects never wear
  // the same surface colour. Constraints are relaxed in order — first allow a
  // background colour, then allow a repeat — so a call always returns something.
  const usedSurfaceColors = new Set<string>();
  const pickSurfaceColor = (): string => {
    const fresh = realSurfacePalette.filter(
      (c) => !animBackgrounds.has(c) && !usedSurfaceColors.has(c),
    );
    const pool = fresh.length
      ? fresh
      : realSurfacePalette.filter((c) => !usedSurfaceColors.has(c));
    const chosen = pickWeighted(pool.length ? pool : realSurfacePalette, surfScore);
    usedSurfaceColors.add(chosen);
    return chosen;
  };

  // Second colour for a faceted/depth ramp: contrasts with `primary` so the
  // ramp actually reads, drawn from the palette so it stays on-theme. Doesn't
  // touch usedSurfaceColors — that set stops two objects sharing a body
  // colour, and a ramp's second colour isn't a body colour.
  const pickRampColor = (primary: string): string => {
    const primaryLightness = lightness(primary);
    const candidates = realSurfacePalette.filter(
      (c) => c.toLowerCase() !== primary.toLowerCase() && !animBackgrounds.has(c),
    );
    const contrasting = candidates.filter(
      (c) => Math.abs(lightness(c) - primaryLightness) >= 0.25,
    );
    if (contrasting.length) return pickWeighted(contrasting, surfScore);
    if (candidates.length) {
      return candidates.reduce((best, c) =>
        Math.abs(lightness(c) - primaryLightness) >
        Math.abs(lightness(best) - primaryLightness)
          ? c
          : best,
      );
    }
    return primaryLightness >= 0.5 ? "#000000" : "#ffffff";
  };

  // Ramp end-colour honouring the explored modes. A neutral that barely
  // contrasts with the body colour would flatten the ramp, so fall back to a
  // palette pick — but only when "coloured" is actually one of the modes the
  // user allowed. A locked white/black choice must stay that colour even at
  // the cost of contrast, or the Explore setting would be silently ignored.
  const rampPool = opts.rampColors?.length ? opts.rampColors : RAMP_COLOR_MODES;
  const pickRamp = (primary: string): string => {
    const mode = pick(rampPool);
    if (mode === "coloured") return pickRampColor(primary);
    const neutral =
      mode === "white" ? SURFACE_COLOR_LIGHT_DEFAULT : SURFACE_COLOR_LOW_DEFAULT;
    if (Math.abs(lightness(neutral) - lightness(primary)) >= 0.25) return neutral;
    return rampPool.includes("coloured") ? pickRampColor(primary) : neutral;
  };

  // Look up an effect's keyframeable intensity uniform and its [min,max].
  function keyframeIntensity(inst: EffectInstance): void {
    const def = BUILTIN_EFFECTS.find((d) => d.id === inst.defId);
    if (!def || def.uniforms.length === 0) return;
    // The catalog flags each effect's intensity uniform; fall back to the first.
    const u = def.uniforms.find((x) => x.isIntensity) ?? def.uniforms[0];
    inst.values[u.name] = spreadKeys(
      dur,
      keyCount,
      () => u.min + Math.random() * (u.max - u.min),
    );
  }

  // Apply scale + one-rotation-axis sweep keyframes to an object, plus
  // `extras` extra animated transform props. Returns the chosen rotation axis.
  function animateTransform(
    o: ObjectState,
    scaleLo: number,
    scaleHi: number,
    extras: number,
  ): void {
    o.scale = spreadKeys(
      dur,
      keyCount,
      () => scaleLo + Math.random() * (scaleHi - scaleLo),
    );
    const axes: ("rotX" | "rotY" | "rotZ")[] = ["rotX", "rotY", "rotZ"];
    const spun = pick(axes);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const target = dir * 2 * Math.PI * (0.5 + anim);
    for (const ax of axes) {
      o[ax] =
        ax === spun
          ? spreadKeys(dur, keyCount, (_i, frac) => frac * target)
          : constant(0);
    }
    // Extras: animate up to `extras` more props (an unused rotation axis or posY).
    const extraPool: ("rotX" | "rotY" | "rotZ" | "posY")[] = [
      ...axes.filter((a) => a !== spun),
      "posY",
    ];
    for (const prop of pickDistinct(extraPool, extras)) {
      o[prop] = spreadKeys(
        dur,
        keyCount,
        () => (Math.random() - 0.5) * (prop === "posY" ? 0.6 : 2 * Math.PI),
      );
    }
  }

  // Half the X-gap between the two objects, mirrored as A=-halfGap, B=+halfGap.
  // Squaring the random draw biases it toward 0, so the objects sit nearby and
  // visually overlap far more often than they spread to the full 0.9 apart.
  const halfGap = 0.9 * Math.random() ** 2;

  const shapePool = opts.shapes?.length ? opts.shapes : PRIMITIVE_MODELS;

  // ----- Object A -----
  const a = next.objects[0];
  a.primitive = pickWeighted(shapePool, (m) => tasteProfile.shapes[m] ?? 0);
  a.modelName = null;
  a.modelDataUrl = null;
  dressObject(a, 0);
  a.posX = twoObjects ? constant(-halfGap) : constant(0);
  a.posY = constant(0);
  a.posZ = constant(0);
  animateTransform(a, 0.4, 1.0, animatedExtras);

  const objects: ObjectState[] = [a];

  // ----- Object B -----
  if (twoObjects) {
    const b = defaultSecondObject();
    b.primitive = pickWeighted(shapePool, (m) => tasteProfile.shapes[m] ?? 0);
    dressObject(b, 1);
    b.posX = constant(halfGap);
    animateTransform(b, 0.3, 0.7, 0);
    objects.push(b);
  }
  next.objects = objects;

  // ----- Effects (distributed across both objects) -----
  const enabledIds = opts.enabledEffectIds;
  const isEnabled = (id: string): boolean =>
    !enabledIds?.length || enabledIds.includes(id);
  const deformPool = BUILTIN_EFFECTS.filter(
    (d) => d.kind === "deform" && isEnabled(d.id),
  );
  const shadePool: EffectDef[] = BUILTIN_EFFECTS.filter(
    (d) =>
      isEnabled(d.id) &&
      (d.id === "grayscale" ||
        d.id === "fresnel" ||
        // multiply/mask sample the *other* object (pg_sampleOther) — two objects only.
        (twoObjects && (d.id === "multiply" || d.id === "mask"))),
  );
  const selected = pickDistinctWeighted(
    [...deformPool, ...shadePool],
    effectCount,
    (d) => tasteProfile.effects[d.id] ?? 0,
  );
  const instances = selected.map((def) => instanceFromDef(def));

  // Tint any fresnel instance from a palette colour.
  for (const inst of instances) {
    if (inst.defId === "fresnel") {
      const [r, g, b] = hexToRgb01(pick(scenePalette));
      inst.values.uTintR = constant(r);
      inst.values.uTintG = constant(g);
      inst.values.uTintB = constant(b);
    }
  }

  // Deal the selected effects across the objects round-robin, so no single
  // object hoards the whole stack. With one object, they all land on it.
  for (const o of objects) o.effects = [];
  instances.forEach((inst, i) =>
    objects[i % objects.length].effects.push(inst),
  );

  // Keyframe exactly one effect's intensity so the scene always animates a fx.
  if (instances.length) keyframeIntensity(pick(instances));

  applyLocks(base, next, locks);

  return { project: next, colorScheme };
}
