import type { EffectDef } from "../../types";

// Shared GLSL noise used by the warp deformer. Deduplicated by the composer.
const NOISE_COMMON = `
float pg_hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float pg_noise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(pg_hash(i + vec3(0,0,0)), pg_hash(i + vec3(1,0,0)), f.x),
                 mix(pg_hash(i + vec3(0,1,0)), pg_hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(pg_hash(i + vec3(0,0,1)), pg_hash(i + vec3(1,0,1)), f.x),
                 mix(pg_hash(i + vec3(0,1,1)), pg_hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

export const BUILTIN_EFFECTS: EffectDef[] = [
  // ----- Mesh / geometry deformers (vertex) -----
  {
    id: "displace",
    name: "Displace",
    kind: "deform",
    description: "Pushes the surface out by the image's brightness.",
    builtin: true,
    uniforms: [
      {
        name: "uAmplitude",
        label: "Amplitude",
        min: 0,
        max: 1.2,
        default: 0.35,
        isIntensity: true,
      },
      { name: "uPulse", label: "Pulse", min: 0, max: 1, default: 0.3 },
      { name: "uSpeed", label: "Speed", min: 0, max: 4, default: 1 },
    ],
    glslDeform: `
  vec3 tx = texture2D(uTexture, uv).rgb;
  float lum = dot(tx, vec3(0.299, 0.587, 0.114));
  float pulse = 1.0 - uPulse + uPulse * (0.5 + 0.5 * sin(t * uSpeed));
  pos.z += (lum - 0.5) * uAmplitude * pulse;
  return pos;`,
  },
  {
    id: "relief",
    name: "Relief / Emboss",
    kind: "deform",
    description:
      "Displaces vertices along their normals by the image's brightness, turning a photo into 3D relief.",
    builtin: true,
    uniforms: [
      {
        name: "uAmount",
        label: "Amount",
        min: 0,
        max: 1,
        default: 0.35,
        isIntensity: true,
      },
    ],
    glslDeform: `
  vec3 tx = texture2D(uTexture, uv).rgb;
  float lum = dot(tx, vec3(0.299, 0.587, 0.114));
  pos += normal * (lum - 0.5) * uAmount;
  return pos;`,
  },
  {
    id: "ripple",
    name: "Ripple",
    kind: "deform",
    description: "Concentric ripples radiating from the center.",
    builtin: true,
    uniforms: [
      {
        name: "uAmplitude",
        label: "Amplitude",
        min: 0,
        max: 0.6,
        default: 0.12,
        isIntensity: true,
      },
      { name: "uFrequency", label: "Frequency", min: 0, max: 40, default: 14 },
      { name: "uSpeed", label: "Speed", min: 0, max: 6, default: 2 },
    ],
    glslDeform: `
  float d = length(uv - 0.5);
  pos.z += sin(d * uFrequency - t * uSpeed) * uAmplitude;
  return pos;`,
  },
  {
    id: "wave",
    name: "Wave",
    kind: "deform",
    description: "Directional sine waves across the surface.",
    builtin: true,
    uniforms: [
      {
        name: "uAmplitude",
        label: "Amplitude",
        min: 0,
        max: 0.6,
        default: 0.1,
        isIntensity: true,
      },
      { name: "uFrequency", label: "Frequency", min: 0, max: 30, default: 6 },
      { name: "uSpeed", label: "Speed", min: 0, max: 6, default: 1.6 },
    ],
    glslDeform: `
  pos.z += sin(pos.x * uFrequency + t * uSpeed) * uAmplitude;
  pos.z += cos(pos.y * uFrequency * 0.8 + t * uSpeed) * uAmplitude * 0.5;
  return pos;`,
  },

  {
    id: "twist",
    name: "Twist",
    kind: "deform",
    description: "Twists the geometry around the vertical axis.",
    builtin: true,
    uniforms: [
      {
        name: "uTwist",
        label: "Twist",
        min: -3.5,
        max: 3.5,
        default: 1.0,
        isIntensity: true,
      },
      { name: "uSpeed", label: "Speed", min: 0, max: 3, default: 0.4 },
    ],
    glslDeform: `
  float angle = pos.y * uTwist + t * uSpeed;
  float c = cos(angle), s = sin(angle);
  pos.xz = mat2(c, -s, s, c) * pos.xz;
  return pos;`,
  },
  {
    id: "bulge",
    name: "Bulge",
    kind: "deform",
    description: "Bulges (or pinches) the center toward the camera.",
    builtin: true,
    uniforms: [
      {
        name: "uStrength",
        label: "Strength",
        min: -1,
        max: 1,
        default: 0.4,
        isIntensity: true,
      },
      { name: "uRadius", label: "Radius", min: 0.1, max: 1.2, default: 0.6 },
    ],
    glslDeform: `
  float d = length(uv - 0.5);
  float f = smoothstep(uRadius, 0.0, d);
  pos.z += uStrength * f * 0.8;
  pos.xy *= 1.0 + uStrength * f * 0.15;
  return pos;`,
  },
  {
    id: "warp",
    name: "Noise Warp",
    kind: "deform",
    description: "Organic flowing noise displacement.",
    builtin: true,
    glslCommon: NOISE_COMMON,
    uniforms: [
      { name: "uScale", label: "Scale", min: 0.2, max: 8, default: 2.2 },
      {
        name: "uAmplitude",
        label: "Amplitude",
        min: 0,
        max: 0.8,
        default: 0.22,
        isIntensity: true,
      },
      { name: "uSpeed", label: "Speed", min: 0, max: 2, default: 0.5 },
    ],
    glslDeform: `
  float n = pg_noise(vec3(pos.xy * uScale, t * uSpeed));
  pos.z += (n - 0.5) * uAmplitude * 2.0;
  pos.x += (pg_noise(vec3(pos.xy * uScale + 11.0, t * uSpeed)) - 0.5) * uAmplitude;
  pos.y += (pg_noise(vec3(pos.xy * uScale - 7.0, t * uSpeed)) - 0.5) * uAmplitude;
  return pos;`,
  },
  {
    id: "inflate",
    name: "Inflate / Breathe",
    kind: "deform",
    description: "Puffs the surface along its normals, with an optional pulse.",
    builtin: true,
    uniforms: [
      {
        name: "uAmount",
        label: "Amount",
        min: -0.6,
        max: 0.6,
        default: 0.2,
        isIntensity: true,
      },
      { name: "uPulse", label: "Pulse", min: 0, max: 1, default: 0.4 },
      { name: "uSpeed", label: "Speed", min: 0, max: 6, default: 1.5 },
    ],
    glslDeform: `
  float pulse = mix(1.0, 0.5 + 0.5 * sin(t * uSpeed), uPulse);
  pos += normal * uAmount * pulse;
  return pos;`,
  },

  {
    id: "taper",
    name: "Taper",
    kind: "deform",
    description: "Pinches or stretches the geometry's radius by height.",
    builtin: true,
    uniforms: [
      {
        name: "uTaper",
        label: "Taper",
        min: -1,
        max: 1,
        default: 0.4,
        isIntensity: true,
      },
    ],
    glslDeform: `
  float f = 1.0 + pos.y * uTaper;
  pos.xz *= f;
  return pos;`,
  },
  {
    id: "vortex",
    name: "Vortex",
    kind: "deform",
    description:
      "Whirlpool twist that increases with distance from the center.",
    builtin: true,
    uniforms: [
      {
        name: "uTwist",
        label: "Twist",
        min: -4,
        max: 4,
        default: 1.5,
        isIntensity: true,
      },
      { name: "uSpeed", label: "Speed", min: 0, max: 3, default: 0.5 },
    ],
    glslDeform: `
  float d = length(pos.xz);
  float angle = d * uTwist + t * uSpeed;
  float c = cos(angle), s = sin(angle);
  pos.xz = mat2(c, -s, s, c) * pos.xz;
  return pos;`,
  },
  {
    id: "jitter",
    name: "Jitter",
    kind: "deform",
    description: "Blocky per-vertex noise offsets for a glitchy look.",
    builtin: true,
    glslCommon: NOISE_COMMON,
    uniforms: [
      { name: "uScale", label: "Scale", min: 0.5, max: 8, default: 3.0 },
      {
        name: "uAmount",
        label: "Amount",
        min: 0,
        max: 0.5,
        default: 0.12,
        isIntensity: true,
      },
      { name: "uSpeed", label: "Speed", min: 0, max: 6, default: 2.0 },
    ],
    glslDeform: `
  vec3 n = vec3(
    pg_noise(vec3(pos.xy * uScale, t * uSpeed)),
    pg_noise(vec3(pos.yz * uScale + 5.0, t * uSpeed)),
    pg_noise(vec3(pos.zx * uScale - 5.0, t * uSpeed))
  ) - 0.5;
  pos += n * uAmount;
  return pos;`,
  },
  // ----- Stylize (fragment) -----
  {
    id: "fresnel",
    name: "Fresnel / Rim Glow",
    kind: "shade",
    description: "Edge glow based on viewing angle — bright at grazing angles.",
    builtin: true,
    uniforms: [
      { name: "uPower", label: "Power", min: 0.5, max: 6, default: 2.5 },
      {
        name: "uIntensity",
        label: "Intensity",
        min: 0,
        max: 3,
        default: 1.0,
        isIntensity: true,
      },
      { name: "uTintR", label: "Tint R", min: 0, max: 1, default: 1.0 },
      { name: "uTintG", label: "Tint G", min: 0, max: 1, default: 1.0 },
      { name: "uTintB", label: "Tint B", min: 0, max: 1, default: 1.0 },
    ],
    glslShade: `
  vec3 V = normalize(cameraPosition - vWorldPos);
  float f = pow(1.0 - clamp(dot(V, normalize(vWorldNormal)), 0.0, 1.0), uPower);
  color.rgb += vec3(uTintR, uTintG, uTintB) * f * uIntensity;
  return color;`,
  },
  {
    id: "multiply",
    name: "Multiply",
    kind: "shade",
    description:
      "Multiplies by Object B's image. Best with two textured objects.",
    builtin: true,
    uniforms: [
      {
        name: "uAmount",
        label: "Amount",
        min: 0,
        max: 1,
        default: 1,
        isIntensity: true,
      },
    ],
    glslShade: `
  vec4 b = pg_sampleOther(uv);
  color.rgb = mix(color.rgb, color.rgb * b.rgb, uAmount);
  return color;`,
  },
  {
    id: "mask",
    name: "Mask",
    kind: "shade",
    description:
      "Cuts this object using Object B's image as a luminance matte.",
    builtin: true,
    uniforms: [
      {
        name: "uAmount",
        label: "Amount",
        min: 0,
        max: 1,
        default: 1,
        isIntensity: true,
      },
      { name: "uInvert", label: "Invert", min: 0, max: 1, default: 0 },
    ],
    glslShade: `
  vec4 b = pg_sampleOther(uv);
  float m = dot(b.rgb, vec3(0.299, 0.587, 0.114));
  m = mix(m, 1.0 - m, uInvert);
  color.a *= mix(1.0, m, uAmount);
  return color;`,
  },
];

export function findEffectDef(
  defId: string,
  customEffects: EffectDef[],
): EffectDef | undefined {
  return (
    BUILTIN_EFFECTS.find((e) => e.id === defId) ||
    customEffects.find((e) => e.id === defId)
  );
}
