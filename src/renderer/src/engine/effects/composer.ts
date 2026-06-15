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

export function composeSubjectShader(
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
  const triplanarDefine = mapping === 'triplanar' ? '#define USE_TRIPLANAR' : ''

  const vertexShader = `
precision highp float;
uniform float uTime;
uniform sampler2D uTexture;
uniform vec2 uResolution;
${uniformDecls.join('\n')}
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
${commonBlock}
${deformFns.join('\n')}
void main() {
  vUv = uv;
  vec3 pos = position;
  vec3 nrm = normal;
${deformCalls.join('\n')}
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * nrm);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`

  const fragmentShader = `
precision highp float;
${triplanarDefine}
uniform float uTime;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform vec2 uImageScale;
uniform vec2 uImageOffset;
uniform float uSilhouette;
uniform vec3 uFlatColor;
uniform float uOpacity;
${uniformDecls.join('\n')}
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
${commonBlock}
vec4 pg_sampleSubject(vec2 uv) {
#ifdef USE_TRIPLANAR
  vec3 n = normalize(abs(vWorldNormal)) + 1e-5;
  n /= (n.x + n.y + n.z);
  vec4 cx = texture2D(uTexture, vWorldPos.zy * 0.5 + 0.5);
  vec4 cy = texture2D(uTexture, vWorldPos.xz * 0.5 + 0.5);
  vec4 cz = texture2D(uTexture, vWorldPos.xy * 0.5 + 0.5);
  return cx * n.x + cy * n.y + cz * n.z;
#else
  // Aspect-correct cover fit: window the image so it fills the frame without
  // squeezing. Engine supplies scale (<=1 on the overflowing axis) and offset.
  vec2 t = uv * uImageScale + uImageOffset;
  return texture2D(uTexture, t);
#endif
}
${shadeFns.join('\n')}
void main() {
  vec4 color = pg_sampleSubject(vUv);
${shadeCalls.join('\n')}
  if (uSilhouette > 0.5) color = vec4(uFlatColor, 1.0);
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
