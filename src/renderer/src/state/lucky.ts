// ---------------------------------------------------------------------------
// "Feeling lucky" — a pure random-scene generator.
//
// Given a base project, a palette of colours, a set of image data URLs, and a
// heat value [0,1], produce a brand-new project that randomizes visuals only:
// object A/B (shape, texture, transform), effects, keyframes, and the scene +
// text-card colours. The timeline (segment count, durations, text *content*)
// is preserved. Output is always animated: scale, one rotation axis, and one
// effect's intensity are always keyframed.
// ---------------------------------------------------------------------------

import type {
  EffectDef,
  EffectInstance,
  PrimitiveModel,
  Project,
  Scalar,
} from "../types";
import { constant, totalDuration } from "../types";
import { BUILTIN_EFFECTS } from "../engine/effects/catalog";
import { defaultSecondObject, instanceFromDef } from "./defaults";

// The full set of primitive shapes. Kept inline so this module is independent
// of any UI list.
const PRIMITIVE_MODELS: PrimitiveModel[] = [
  "plane",
  "sphere",
  "portal",
  "cylinder",
  "torus",
  "box",
  "lathe",
  "knot",
  "twist",
  "polyhedron",
  "dodecahedron",
];

// Which uniform on each effect reads as its "intensity" — the one worth
// animating. Falls back to the first uniform when an effect isn't listed.
const INTENSITY_UNIFORM: Record<string, string> = {
  displace: "uAmplitude",
  relief: "uAmount",
  ripple: "uAmplitude",
  wave: "uAmplitude",
  twist: "uTwist",
  bulge: "uStrength",
  warp: "uAmplitude",
  inflate: "uAmount",
  taper: "uTaper",
  vortex: "uTwist",
  jitter: "uAmount",
  grayscale: "uAmount",
  fresnel: "uIntensity", // NOT uPower
  multiply: "uAmount",
  mask: "uAmount",
};

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

// Pick { backdropColor, background, text } for one text card so background +
// silhouette share one lightness side and text takes the other.
function pickTextColors(pool: string[]): {
  backdropColor: string;
  background: string;
  text: string;
} {
  const light = pool.filter((c) => lightness(c) >= 0.5);
  const dark = pool.filter((c) => lightness(c) < 0.5);
  // background + silhouette must come from a side with >= 2 colours so they can
  // be distinct; text takes the opposite side. With a budget >= 3 and at least
  // one colour on each side, one side always has >= 2 (pigeonhole), so we steer
  // lightTheme toward it rather than flipping a blind coin (which could land on
  // a single-colour side and collapse background + silhouette to one colour).
  const canLight = light.length >= 2;
  const canDark = dark.length >= 2;
  const lightTheme = canLight && canDark ? Math.random() < 0.5 : canLight;
  const sameSide = lightTheme ? light : dark; // background + silhouette
  const opposite = lightTheme ? dark : light; // text
  const [background, second] = pickDistinct(sameSide, 2);
  return { background, backdropColor: second ?? background, text: pick(opposite) };
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

// A solid-colour texture as a same-origin PNG data URL. Same-origin canvas
// never taints, so this is safe to upload to WebGL and to read back on export.
// 8x8 keeps the embedded base64 tiny.
export function solidColorDataUrl(hex: string, size = 8): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas.toDataURL("image/png");
}

export function generateLuckyScene(
  base: Project,
  colors: string[],
  imageDataUrls: string[],
  heat: number,
): Project {
  const h = clamp(heat, 0, 1);
  const effectCount = clamp(1 + Math.round(h * 6), 1, 7);
  const twoObjects = h >= 0.5;
  // No slider is ever worth more than 3 keyframes — even at the hottest setting.
  const keyCount = clamp(2 + Math.round(h), 2, 3);
  const animatedExtras = Math.round(h * 2);

  // Preserve output, version, customEffects, and the full segments array
  // (durations + text content). structuredClone keeps the timeline intact.
  const next = structuredClone(base) as Project;
  const dur = totalDuration(base);

  const palette = colors.length
    ? colors
    : [base.scene.backgroundColor, "#A3D6DC", "#64e36e", "#6473e3"];

  // Distinct colours a single generation may use: 3 cold → 5 hot.
  const colorBudget = clamp(3 + Math.round(h * 2), 3, 5);
  const scenePalette = buildScenePalette(palette, colorBudget);

  // A texture source: a fetched image if available, else a solid palette colour.
  const appearance = (): string =>
    imageDataUrls.length
      ? pick(imageDataUrls)
      : solidColorDataUrl(pick(scenePalette));

  next.scene.backgroundColor = pick(scenePalette);

  // Look up an effect's keyframeable intensity uniform and its [min,max].
  function keyframeIntensity(inst: EffectInstance): void {
    const def = BUILTIN_EFFECTS.find((d) => d.id === inst.defId);
    if (!def || def.uniforms.length === 0) return;
    const name = INTENSITY_UNIFORM[inst.defId] ?? def.uniforms[0].name;
    const u = def.uniforms.find((x) => x.name === name) ?? def.uniforms[0];
    inst.values[u.name] = spreadKeys(
      dur,
      keyCount,
      () => u.min + Math.random() * (u.max - u.min),
    );
  }

  // Apply scale + one-rotation-axis sweep keyframes to an object, plus
  // `extras` extra animated transform props. Returns the chosen rotation axis.
  function animateTransform(
    o: Project["object"],
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
    const target = dir * 2 * Math.PI * (0.5 + h);
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

  // ----- Object A -----
  const a = next.object;
  a.primitive = pick(PRIMITIVE_MODELS);
  a.modelName = null;
  a.modelDataUrl = null;
  a.image = {
    name: "lucky",
    dataUrl: appearance(),
    offsetX: constant(0.5),
    offsetY: constant(0.5),
  };
  a.posX = twoObjects ? constant(-halfGap) : constant(0);
  a.posY = constant(0);
  a.posZ = constant(0);
  animateTransform(a, 0.4, 1.0, animatedExtras);

  // ----- Object B -----
  if (twoObjects) {
    const b = defaultSecondObject();
    b.primitive = pick(PRIMITIVE_MODELS);
    b.image = {
      name: "lucky",
      dataUrl: appearance(),
      offsetX: constant(0.5),
      offsetY: constant(0.5),
    };
    b.posX = constant(halfGap);
    animateTransform(b, 0.3, 0.7, 0);
    next.object2 = b;
  } else {
    next.object2 = null;
  }

  // ----- Effects (distributed across both objects) -----
  const deformPool = BUILTIN_EFFECTS.filter((d) => d.kind === "deform");
  const shadePool: EffectDef[] = BUILTIN_EFFECTS.filter(
    (d) =>
      d.id === "grayscale" ||
      d.id === "fresnel" ||
      // multiply/mask sample the *other* object (pg_sampleOther) — two objects only.
      (twoObjects && (d.id === "multiply" || d.id === "mask")),
  );
  const selected = pickDistinct([...deformPool, ...shadePool], effectCount);
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

  // Deal the selected effects between the two objects round-robin, so neither
  // object hoards the whole stack. With one object, they all land on A.
  a.effects = [];
  if (next.object2) {
    instances.forEach((inst, i) =>
      (i % 2 === 0 ? a.effects : next.object2!.effects).push(inst),
    );
  } else {
    a.effects = instances;
  }

  // Keyframe exactly one effect's intensity so the scene always animates a fx.
  if (instances.length) keyframeIntensity(pick(instances));

  // ----- Text recolour (content preserved) -----
  // Each text card draws from scenePalette so the whole generation stays within
  // budget. pickTextColors keeps background + silhouette on one lightness side
  // and the text on the other, so the text always reads.
  for (const seg of next.segments) {
    if (seg.kind === "text" && seg.text) {
      const { backdropColor, background, text } = pickTextColors(scenePalette);
      seg.text.textBackdropColor = backdropColor;
      seg.text.backgroundColor = background;
      seg.text.textColor = text;
    }
  }

  return next;
}
