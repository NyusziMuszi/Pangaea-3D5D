// ---------------------------------------------------------------------------
// Project data model. A Project is the single serializable source of truth.
// Assets (image / model) are embedded as data URLs so a project saves as one
// portable JSON file (.pangaea).
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

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
export type Mapping = "uv" | "triplanar";
export type PrimitiveModel =
  | "plane"
  | "sphere"
  | "cylinder"
  | "torus"
  | "box"
  | "lathe"
  | "knot"
  | "twist"
  | "polyhedron"
  | "dodecahedron";

// Backdrop drawn behind a text card, in place of the textured object.
// 'none' keeps today's opaque card. The object's deformers still animate
// the backdrop, so it moves in sync with the (hidden) scene.
export type TextBackdrop = "none" | "silhouette" | "wireframe";

export interface TextStyle {
  content: string;
  fontSize: number;
  align: "left" | "center" | "right";
  textColor: string;
  backgroundColor: string;
  reveal: "fade" | "cut";
  textBackdrop: TextBackdrop;
  textBackdropColor: string;
}

export type SegmentKind = "animation" | "text";

export interface Segment {
  id: string;
  kind: SegmentKind;
  label: string;
  durationSec: number;
  text?: TextStyle;
}

// Source image textured onto a single object. Each object owns its own image.
export interface ObjectImage {
  name: string | null;
  dataUrl: string | null;
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
    backgroundColor: string;
    cameraType: CameraType;
  };
  object: ObjectState;
  // Optional second object placed alongside the first. A full peer of the
  // primary object with its own shape, transform, texture and effects.
  // `null` keeps the single-object scene.
  object2: ObjectState | null;
  segments: Segment[]; // exactly 6 by default: 3 animation + 3 text, alternating
  customEffects: EffectDef[];
}

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
