// ---------------------------------------------------------------------------
// Project data model. A Project is the single serializable source of truth.
// Object images live in the asset registry (state/assets.ts) and are referenced
// by id; a model is still embedded inline as a data URL. On save the referenced
// asset bytes are re-embedded alongside the project (see ProjectActions).
// ---------------------------------------------------------------------------

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold";

export interface Keyframe {
  t: number; // absolute time on the global timeline, seconds
  value: number;
  ease: Easing; // easing applied on the segment ending at this keyframe
}

// An animatable scalar: either a constant or a list of keyframes.
export type Scalar =
  | { kind: "const"; value: number }
  | { kind: "keys"; keys: Keyframe[] };

export const constant = (value: number): Scalar => ({ kind: "const", value });

export interface UniformDef {
  name: string; // GLSL uniform name as authored, e.g. "uAmplitude"
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  // Marks the uniform that reads as this effect's "intensity" — the one worth
  // animating. "Feeling lucky" keyframes it. At most one per effect; when none
  // is flagged, callers fall back to the first uniform.
  isIntensity?: boolean;
}

export type EffectKind = "deform" | "shade";

// A reusable effect definition (built-in or user authored in the GLSL editor).
// `glslDeform` is the body of:  vec3 fn(vec3 pos, vec3 normal, vec2 uv, float t)
// `glslShade`  is the body of:  vec4 fn(vec4 color, vec2 uv, float t)
// Inside a body the author uses the plain uniform names (uAmplitude, ...) and
// the special inputs uTime/uTexture; the composer namespaces them per instance.
export interface EffectDef {
  id: string;
  name: string;
  kind: EffectKind;
  description?: string;
  glslCommon?: string;
  glslDeform?: string;
  glslShade?: string;
  uniforms: UniformDef[];
  builtin: boolean;
}

export interface EffectInstance {
  instanceId: string;
  defId: string;
  enabled: boolean;
  values: Record<string, Scalar>; // keyed by uniform name
}

export type CameraType = "perspective" | "isometric";
export const CAMERA_TYPES = ["perspective", "isometric"] as const satisfies readonly CameraType[];
export type Mapping = "uv" | "triplanar" | "spherical" | "cylindrical" | "reflection";
export const MAPPINGS = ["uv", "triplanar", "spherical", "cylindrical", "reflection"] as const satisfies readonly Mapping[];
// How colour trios are dealt across segments by "Feeling lucky" — see lucky.ts.
export type ColorScheme = "byType" | "byPair" | "random";
export type PrimitiveModel =
  | "plane"
  | "landscape"
  | "sphere"
  | "portal"
  | "cylinder"
  | "capsule"
  | "torus"
  | "box"
  | "lathe"
  | "knot"
  | "twist"
  | "polyhedron"
  | "dodecahedron";
export const PRIMITIVE_MODELS = [
  "plane", "landscape", "sphere", "portal", "cylinder", "capsule", "torus",
  "box", "lathe", "knot", "twist", "polyhedron", "dodecahedron",
] as const satisfies readonly PrimitiveModel[];

// Backdrop drawn behind a text card, in place of the textured object.
// 'none' keeps today's opaque card. The object's deformers still animate
// the backdrop, so it moves in sync with the (hidden) scene.
export type TextBackdrop = "none" | "silhouette" | "wireframe";

// How an object's surface is rendered: textured ("image", today's default —
// shows the loaded image or the grey placeholder), as a flat "silhouette"
// or "wireframe" drawn in surfaceColor, as a "faceted" solid coloured in
// surfaceColor and flat-shaded by a fixed light so its planes are visible, or
// as "depth" — a two-colour ramp between surfaceColor and surfaceColorLow
// driven by object-space height, with no directional light.
export type ObjectSurface = "image" | "silhouette" | "wireframe" | "faceted" | "depth";
export const OBJECT_SURFACES = ["image", "silhouette", "wireframe", "faceted", "depth"] as const satisfies readonly ObjectSurface[];

// How the glyphs combine with whatever is beneath them (only applies when
// textBackdrop is "silhouette"). "normal" is today's flat textColor fill;
// the rest sample the rendered scene under each glyph and recombine it with
// textColor per-pixel:
//   invert:     1 - scene                  (photo-negative)
//   exclusion:  scene + text - 2*scene*text (softer negative, keeps some hue)
//   multiply:   scene * text                (darkens, tints toward textColor)
//   screen:     1 - (1-scene)*(1-text)      (lightens, tints toward textColor)
export type TextBlendMode =
  | "normal"
  | "invert"
  | "exclusion"
  | "multiply"
  | "screen";

export interface TextStyle {
  content: string;
  fontSize: number;
  align: "left" | "center" | "right";
  textColor: string;
  backgroundColor: string;
  reveal: "fade" | "cut";
  textBackdrop: TextBackdrop;
  textBackdropColor: string;
  textBackdropWireWidth: number; // wireframe line weight, ~screen px
  // Optional so older .pangaea files load (undefined = "normal").
  textBlend?: TextBlendMode;
}

export type SegmentKind = "animation" | "text";

export interface Segment {
  id: string;
  kind: SegmentKind;
  label: string;
  durationSec: number;
  text?: TextStyle;
  // Per-break WebGL clear colour. Set on `animation` segments; a break's colour
  // also holds through the text card that follows it (see engine/timeline.ts).
  backgroundColor?: string;
}

// Source image textured onto a single object. Each object owns its own image.
// The bytes live in the asset registry (state/assets.ts) keyed by assetId — the
// model holds only the id so per-edit clones never copy multi-MB image data.
export interface ObjectImage {
  name: string | null;
  assetId: string | null;
  // Normalized 0..1 position of the visible window when the image is
  // cover-fit to the frame (aspect locked). 0.5 = centered. Only the
  // overflowing axis responds; the fitted axis ignores its offset.
  offsetX: Scalar;
  offsetY: Scalar;
}

export interface ObjectState {
  primitive: PrimitiveModel;
  modelName: string | null;
  modelDataUrl: string | null;
  mapping: Mapping;
  // How the surface is drawn: textured image, or a flat silhouette / wireframe
  // in surfaceColor. surfaceWireWidth is the wireframe line weight (~screen px).
  surface: ObjectSurface;
  surfaceColor: string;
  surfaceWireWidth: number;
  // Depth-surface ramp: surfaceColor is the raised end, surfaceColorLow the
  // recessed end, depthRange the ± object-space height mapped across the ramp.
  surfaceColorLow?: string;
  depthRange?: number;
  // This object's own texture and the effect stack applied to it. Both objects
  // are independent peers — neither shares the other's material.
  image: ObjectImage;
  effects: EffectInstance[];
  rotX: Scalar;
  rotY: Scalar;
  rotZ: Scalar;
  scale: Scalar;
  // World-space offset, so a second object can sit beside the first. Older
  // projects predate these fields, so readers fall back to constant(0).
  posX: Scalar;
  posY: Scalar;
  posZ: Scalar;
}

export interface Project {
  version: number;
  output: { width: number; height: number; fps: number };
  scene: {
    cameraType: CameraType;
  };
  // Renderable objects, in render order. Length 1 or 2 today; the array shape
  // leaves room for more. Each is a full peer — its own shape, transform,
  // texture and effect stack. A later object may sample objects[0]'s texture
  // (used by the multiply/mask effects).
  objects: ObjectState[];
  segments: Segment[]; // exactly 6 by default: 3 animation + 3 text, alternating
  customEffects: EffectDef[];
  // "Feeling lucky" presets: colour swatches, uploaded source images (stored as
  // absolute file paths, resolved to data URLs on use), plus the controls
  // steering a generated scene — how many objects, how colours are assigned, and
  // an overall animation amount. Colours are split into two pools: typeColors
  // (text) and surfaceColors (backgrounds, object surfaces, effect tints), so a
  // generation can keep text legible against a separately-chosen surface palette.
  //
  // objectCounts and colorSchemes are *sets* the user widens or narrows: each
  // generation randomly picks one entry from each, so checking more boxes
  // explores a wider space. Both are kept non-empty (emptying re-selects all).
  lucky: {
    typeColors: string[];
    surfaceColors: string[];
    images: string[];
    objectCounts: (1 | 2)[];
    colorSchemes: ColorScheme[];
    blendModes: TextBlendMode[];
    textBackdrops: ("silhouette" | "wireframe")[];
    animation: number; // 0..1 overall animation amount
    // Which built-in effect IDs Lucky is allowed to pick from. Undefined = all.
    enabledEffectIds?: string[];
    // Which mapping modes Lucky is allowed to use for image surfaces. Undefined = all.
    mappings?: Mapping[];
    // Per-category locks: when true, that category's values are restored from
    // the pre-generation project after a "Feeling lucky" roll. Optional for
    // back-compat with projects saved before this field existed.
    locks?: { colours: boolean; motion: boolean; effects: boolean; objects: boolean };
  };
}

export type LuckLocks = NonNullable<Project["lucky"]["locks"]>;
export const ALL_UNLOCKED: LuckLocks = {
  colours: false,
  motion: false,
  effects: false,
  objects: false,
};

export function totalDuration(p: Project): number {
  return p.segments.reduce((s, seg) => s + seg.durationSec, 0);
}

// Human-readable name for an object, shown on the timeline ("Sphere", "Plane",
// or the imported model's file name). Used so each object is labelled with what
// it actually is.
export function objectLabel(o: ObjectState): string {
  if (o.modelDataUrl && o.modelName) {
    return o.modelName.replace(/\.[^./\\]+$/, "");
  }
  return o.primitive.charAt(0).toUpperCase() + o.primitive.slice(1);
}
