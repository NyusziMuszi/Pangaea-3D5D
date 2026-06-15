// ---------------------------------------------------------------------------
// Project data model. A Project is the single serializable source of truth.
// Assets (image / model) are embedded as data URLs so a project saves as one
// portable JSON file (.pangaea).
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold'

export interface Keyframe {
  t: number // absolute time on the global timeline, seconds
  value: number
  ease: Easing // easing applied on the segment ending at this keyframe
}

// An animatable scalar: either a constant or a list of keyframes.
export type Scalar =
  | { kind: 'const'; value: number }
  | { kind: 'keys'; keys: Keyframe[] }

export const constant = (value: number): Scalar => ({ kind: 'const', value })

export interface UniformDef {
  name: string // GLSL uniform name as authored, e.g. "uAmplitude"
  label: string
  min: number
  max: number
  default: number
  step?: number
}

export type EffectKind = 'deform' | 'shade'

// A reusable effect definition (built-in or user authored in the GLSL editor).
// `glslDeform` is the body of:  vec3 fn(vec3 pos, vec3 normal, vec2 uv, float t)
// `glslShade`  is the body of:  vec4 fn(vec4 color, vec2 uv, float t)
// Inside a body the author uses the plain uniform names (uAmplitude, ...) and
// the special inputs uTime/uTexture; the composer namespaces them per instance.
export interface EffectDef {
  id: string
  name: string
  kind: EffectKind
  description?: string
  glslCommon?: string
  glslDeform?: string
  glslShade?: string
  uniforms: UniformDef[]
  builtin: boolean
}

export interface EffectInstance {
  instanceId: string
  defId: string
  enabled: boolean
  values: Record<string, Scalar> // keyed by uniform name
}

export type SubjectMode = 'plane' | 'model' | 'particles'
export type Mapping = 'uv' | 'triplanar'
export type PrimitiveModel = 'plane' | 'sphere' | 'cylinder' | 'torus' | 'box'

export interface TextStyle {
  content: string
  fontSize: number
  align: 'left' | 'center' | 'right'
  textColor: string
  backgroundColor: string
  reveal: 'fade' | 'cut'
}

export type SegmentKind = 'animation' | 'text'

export interface Segment {
  id: string
  kind: SegmentKind
  label: string
  durationSec: number
  text?: TextStyle
}

export interface CameraState {
  fov: Scalar
  posX: Scalar
  posY: Scalar
  posZ: Scalar
  targetX: Scalar
  targetY: Scalar
  targetZ: Scalar
}

export interface ParticleControls {
  density: number // grid resolution (points per axis); structural
  pointSize: Scalar
  dissolve: Scalar // 0..1 scatter amount
  explode: Scalar // outward burst
  swirl: Scalar // rotational swirl
}

export interface SubjectState {
  mode: SubjectMode
  primitive: PrimitiveModel
  modelName: string | null
  modelDataUrl: string | null
  mapping: Mapping
  rotX: Scalar
  rotY: Scalar
  rotZ: Scalar
  scale: Scalar
  particle: ParticleControls
}

export interface Project {
  version: number
  output: { width: number; height: number; fps: number }
  scene: {
    backgroundColor: string
    sceneTimeDuringCards: 'continue' | 'hold'
  }
  image: {
    name: string | null
    dataUrl: string | null
    // Normalized 0..1 position of the visible window when the image is
    // cover-fit to the frame (aspect locked). 0.5 = centered. Only the
    // overflowing axis responds; the fitted axis ignores its offset.
    offsetX: Scalar
    offsetY: Scalar
  }
  subject: SubjectState
  effects: EffectInstance[]
  camera: CameraState
  segments: Segment[] // exactly 6 by default: 3 animation + 3 text, alternating
  customEffects: EffectDef[]
}

export function totalDuration(p: Project): number {
  return p.segments.reduce((s, seg) => s + seg.durationSec, 0)
}
