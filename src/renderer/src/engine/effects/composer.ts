import type { EffectDef, EffectInstance, Mapping } from '../../types'

export interface UniformBinding {
  uniformKey: string // namespaced GLSL uniform, e.g. u_abc123_uAmplitude
  instanceId: string
  uniformName: string // authored name, e.g. uAmplitude
}

export interface ComposedShader {
  vertexShader: string
  fragmentShader: string
  bindings: UniformBinding[]
  signature: string
}

export interface ResolvedEffect {
  instance: EffectInstance
  def: EffectDef
}

const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9]/g, '_')

// Build per-instance local aliases so an author can write plain uniform names
// (uAmplitude) while the actual uniform is namespaced (u_<inst>_uAmplitude).
function aliasLines(prefix: string, def: EffectDef): string {
  return def.uniforms.map((u) => `  float ${u.name} = ${prefix}_${u.name};`).join('\n')
}

export function composeObjectShader(
  effects: ResolvedEffect[],
  mapping: Mapping
): ComposedShader {
  const deformers = effects.filter((e) => e.def.kind === 'deform')
  const shaders = effects.filter((e) => e.def.kind === 'shade')

  const bindings: UniformBinding[] = []
  const uniformDecls: string[] = []
  const commons = new Set<string>()
  const deformFns: string[] = []
  const deformCalls: string[] = []
  const shadeFns: string[] = []
  const shadeCalls: string[] = []

  const register = (e: ResolvedEffect): string => {
    const prefix = `u_${sanitize(e.instance.instanceId)}`
    for (const u of e.def.uniforms) {
      const uniformKey = `${prefix}_${u.name}`
      uniformDecls.push(`uniform float ${uniformKey};`)
      bindings.push({ uniformKey, instanceId: e.instance.instanceId, uniformName: u.name })
    }
    if (e.def.glslCommon) commons.add(e.def.glslCommon.trim())
    return prefix
  }

  deformers.forEach((e) => {
    const prefix = register(e)
    const fn = `pg_deform_${sanitize(e.instance.instanceId)}`
    deformFns.push(
      `vec3 ${fn}(vec3 pos, vec3 normal, vec2 uv, float t) {\n${aliasLines(prefix, e.def)}\n${e.def.glslDeform ?? '  return pos;'}\n}`
    )
    deformCalls.push(`  pos = ${fn}(pos, nrm, vUv, uTime);`)
  })

  shaders.forEach((e) => {
    const prefix = register(e)
    const fn = `pg_shade_${sanitize(e.instance.instanceId)}`
    shadeFns.push(
      `vec4 ${fn}(vec4 color, vec2 uv, float t) {\n${aliasLines(prefix, e.def)}\n${e.def.glslShade ?? '  return color;'}\n}`
    )
    shadeCalls.push(`  color = ${fn}(color, vUv, uTime);`)
  })

  const commonBlock = [...commons].join('\n')
  const mappingDefine =
    ({
      triplanar: '#define USE_TRIPLANAR',
      spherical: '#define USE_SPHERICAL',
      cylindrical: '#define USE_CYLINDRICAL',
      reflection: '#define USE_REFLECTION',
      uv: ''
    } as Record<Mapping, string>)[mapping] ?? ''

  const vertexShader = `
precision highp float;
uniform float uTime;
uniform sampler2D uTexture;
uniform vec2 uResolution;
${uniformDecls.join('\n')}
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vObjPos;
attribute vec3 aBary;
varying vec3 vBary;
${commonBlock}
${deformFns.join('\n')}
void main() {
  vUv = uv;
  vBary = aBary;
  vec3 pos = position;
  vec3 nrm = normal;
${deformCalls.join('\n')}
  vObjPos = pos;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * nrm);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`

  const fragmentShader = `
precision highp float;
${mappingDefine}
uniform float uTime;
uniform sampler2D uTexture;
uniform sampler2D uTextureB;
uniform vec2 uResolution;
uniform vec2 uImageScale;
uniform vec2 uImageOffset;
uniform float uSilhouette;
uniform vec3 uFlatColor;
uniform float uOpacity;
uniform float uWireframe;
uniform float uWireWidth;
uniform float uFaceted;
uniform float uDepth;
uniform vec3 uDepthLow;
uniform float uDepthRange;
${uniformDecls.join('\n')}
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vObjPos;
varying vec3 vBary;
${commonBlock}
const float PG_TAU = 6.28318530718;
const float PG_PI  = 3.14159265359;
vec2 pg_equirect(vec3 d) {
  d = normalize(d);
  float u = atan(d.z, d.x) / PG_TAU + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) / PG_PI + 0.5;
  return vec2(u, v);
}
vec4 pg_sampleObject(vec2 uv) {
#ifdef USE_TRIPLANAR
  vec3 n = normalize(abs(vWorldNormal)) + 1e-5;
  n /= (n.x + n.y + n.z);
  vec4 cx = texture2D(uTexture, vWorldPos.zy * 0.5 + 0.5);
  vec4 cy = texture2D(uTexture, vWorldPos.xz * 0.5 + 0.5);
  vec4 cz = texture2D(uTexture, vWorldPos.xy * 0.5 + 0.5);
  return cx * n.x + cy * n.y + cz * n.z;
#elif defined(USE_SPHERICAL)
  return texture2D(uTexture, pg_equirect(vObjPos));
#elif defined(USE_CYLINDRICAL)
  float u = atan(vObjPos.z, vObjPos.x) / PG_TAU + 0.5;
  float v = vObjPos.y * 0.5 + 0.5;
  return texture2D(uTexture, vec2(u, v));
#elif defined(USE_REFLECTION)
  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  vec3 r = reflect(viewDir, normalize(vWorldNormal));
  return texture2D(uTexture, pg_equirect(r));
#else
  // Aspect-correct cover fit: window the image so it fills the frame without
  // squeezing. Engine supplies scale (<=1 on the overflowing axis) and offset.
  vec2 t = uv * uImageScale + uImageOffset;
  return texture2D(uTexture, t);
#endif
}
vec4 pg_sampleOther(vec2 uv) { return texture2D(uTextureB, uv); }
${shadeFns.join('\n')}
void main() {
  vec4 color = pg_sampleObject(vUv);
${shadeCalls.join('\n')}
  if (uSilhouette > 0.5) color = vec4(uFlatColor, 1.0);
  if (uFaceted > 0.5) {
    // Flat per-face normal from screen-space derivatives, so facets read even
    // on smooth-normalled geometry. Face it toward the camera so DoubleSide
    // back-faces shade consistently.
    vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (dot(N, cameraPosition - vWorldPos) < 0.0) N = -N;
    vec3 L = normalize(vec3(0.4, 0.7, 0.6));
    float ndl = max(dot(N, L), 0.0);
    float shade = mix(0.35, 1.0, ndl); // 0.35 = ambient floor
    color = vec4(uFlatColor * shade, 1.0);
  }
  if (uDepth > 0.5) {
    // Height ramp, no directional light: vObjPos is written after the deform
    // chain, so on a plane (base z = 0) vObjPos.z IS the signed displacement
    // that displace/relief produced. Map ±uDepthRange onto 0..1 and ramp from
    // the recessed colour to uFlatColor, so a relief map reads as depth rather
    // than as lit facets.
    float h = clamp(vObjPos.z / max(uDepthRange, 1e-4) * 0.5 + 0.5, 0.0, 1.0);
    color = vec4(mix(uDepthLow, uFlatColor, h), 1.0);
  }
  if (uWireframe > 0.5) {
    vec3 d = fwidth(vBary);
    vec3 a3 = smoothstep(vec3(0.0), d * uWireWidth, vBary);
    float edge = 1.0 - min(min(a3.x, a3.y), a3.z);
    color = vec4(uFlatColor, edge);
  }
  color.a *= uOpacity;
  gl_FragColor = color;
}`

  const signature = JSON.stringify({
    mapping,
    stack: effects.map((e) => `${e.instance.instanceId}:${e.def.id}:${e.def.kind}`),
    // include glsl bodies so live-edited shaders trigger a recompile
    bodies: effects.map((e) => `${e.def.glslDeform ?? ''}|${e.def.glslShade ?? ''}|${e.def.glslCommon ?? ''}`)
  })

  return { vertexShader, fragmentShader, bindings, signature }
}
