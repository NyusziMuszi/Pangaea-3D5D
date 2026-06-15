import type { EffectDef } from '../../types'

// Shared GLSL noise used by the warp deformer. Deduplicated by the composer.
const NOISE_COMMON = `
float pg_hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float pg_noise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(pg_hash(i + vec3(0,0,0)), pg_hash(i + vec3(1,0,0)), f.x),
                 mix(pg_hash(i + vec3(0,1,0)), pg_hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(pg_hash(i + vec3(0,0,1)), pg_hash(i + vec3(1,0,1)), f.x),
                 mix(pg_hash(i + vec3(0,1,1)), pg_hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`

export const BUILTIN_EFFECTS: EffectDef[] = [
  // ----- Mesh / geometry deformers (vertex) -----
  {
    id: 'ripple',
    name: 'Ripple',
    kind: 'deform',
    description: 'Concentric ripples radiating from the center.',
    builtin: true,
    uniforms: [
      { name: 'uAmplitude', label: 'Amplitude', min: 0, max: 0.6, default: 0.12 },
      { name: 'uFrequency', label: 'Frequency', min: 0, max: 40, default: 14 },
      { name: 'uSpeed', label: 'Speed', min: 0, max: 6, default: 2 }
    ],
    glslDeform: `
  float d = length(uv - 0.5);
  pos.z += sin(d * uFrequency - t * uSpeed) * uAmplitude;
  return pos;`
  },
  {
    id: 'wave',
    name: 'Wave',
    kind: 'deform',
    description: 'Directional sine waves across the surface.',
    builtin: true,
    uniforms: [
      { name: 'uAmplitude', label: 'Amplitude', min: 0, max: 0.6, default: 0.1 },
      { name: 'uFrequency', label: 'Frequency', min: 0, max: 30, default: 6 },
      { name: 'uSpeed', label: 'Speed', min: 0, max: 6, default: 1.6 }
    ],
    glslDeform: `
  pos.z += sin(pos.x * uFrequency + t * uSpeed) * uAmplitude;
  pos.z += cos(pos.y * uFrequency * 0.8 + t * uSpeed) * uAmplitude * 0.5;
  return pos;`
  },
  {
    id: 'displace',
    name: 'Displace (image height)',
    kind: 'deform',
    description: "Pushes the surface out by the image's brightness.",
    builtin: true,
    uniforms: [
      { name: 'uAmplitude', label: 'Amplitude', min: 0, max: 1.2, default: 0.35 },
      { name: 'uPulse', label: 'Pulse', min: 0, max: 1, default: 0.3 },
      { name: 'uSpeed', label: 'Speed', min: 0, max: 4, default: 1 }
    ],
    glslDeform: `
  vec3 tx = texture2D(uTexture, uv).rgb;
  float lum = dot(tx, vec3(0.299, 0.587, 0.114));
  float pulse = 1.0 - uPulse + uPulse * (0.5 + 0.5 * sin(t * uSpeed));
  pos.z += (lum - 0.5) * uAmplitude * pulse;
  return pos;`
  },
  {
    id: 'twist',
    name: 'Twist',
    kind: 'deform',
    description: 'Twists the geometry around the vertical axis.',
    builtin: true,
    uniforms: [
      { name: 'uTwist', label: 'Twist', min: -3.5, max: 3.5, default: 1.0 },
      { name: 'uSpeed', label: 'Speed', min: 0, max: 3, default: 0.4 }
    ],
    glslDeform: `
  float angle = pos.y * uTwist + t * uSpeed;
  float c = cos(angle), s = sin(angle);
  pos.xz = mat2(c, -s, s, c) * pos.xz;
  return pos;`
  },
  {
    id: 'bulge',
    name: 'Bulge / Pinch',
    kind: 'deform',
    description: 'Bulges (or pinches) the center toward the camera.',
    builtin: true,
    uniforms: [
      { name: 'uStrength', label: 'Strength', min: -1, max: 1, default: 0.4 },
      { name: 'uRadius', label: 'Radius', min: 0.1, max: 1.2, default: 0.6 }
    ],
    glslDeform: `
  float d = length(uv - 0.5);
  float f = smoothstep(uRadius, 0.0, d);
  pos.z += uStrength * f * 0.8;
  pos.xy *= 1.0 + uStrength * f * 0.15;
  return pos;`
  },
  {
    id: 'warp',
    name: 'Noise Warp',
    kind: 'deform',
    description: 'Organic flowing noise displacement.',
    builtin: true,
    glslCommon: NOISE_COMMON,
    uniforms: [
      { name: 'uScale', label: 'Scale', min: 0.2, max: 8, default: 2.2 },
      { name: 'uAmplitude', label: 'Amplitude', min: 0, max: 0.8, default: 0.22 },
      { name: 'uSpeed', label: 'Speed', min: 0, max: 2, default: 0.5 }
    ],
    glslDeform: `
  float n = pg_noise(vec3(pos.xy * uScale, t * uSpeed));
  pos.z += (n - 0.5) * uAmplitude * 2.0;
  pos.x += (pg_noise(vec3(pos.xy * uScale + 11.0, t * uSpeed)) - 0.5) * uAmplitude;
  pos.y += (pg_noise(vec3(pos.xy * uScale - 7.0, t * uSpeed)) - 0.5) * uAmplitude;
  return pos;`
  },
  // ----- Stylize (fragment) -----
  {
    id: 'grayscale',
    name: 'Desaturate',
    kind: 'shade',
    description: 'Mixes toward grayscale.',
    builtin: true,
    uniforms: [{ name: 'uAmount', label: 'Amount', min: 0, max: 1, default: 1 }],
    glslShade: `
  float g = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(color.rgb, vec3(g), uAmount);
  return color;`
  }
]

export function findEffectDef(
  defId: string,
  customEffects: EffectDef[]
): EffectDef | undefined {
  return (
    BUILTIN_EFFECTS.find((e) => e.id === defId) ||
    customEffects.find((e) => e.id === defId)
  )
}
