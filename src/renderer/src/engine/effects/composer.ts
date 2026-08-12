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
  mapping: Mapping,
  // False for plane-like geometry whose uv is a single seamless 0..1 chart;
  // true for every primitive that wraps its uv somewhere. Selects which space
  // pg_radial() builds its field from — see the comment on that function.
  wrappedUv = false
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

  // Aspect-correct "cover" framing of the source image: the engine supplies a
  // scale (<=1 on the overflowing axis) and an offset (the pan). Declared in
  // BOTH stages, so a deformer can sample the image with exactly the framing
  // the fragment shader draws. Without it the vertex chain displaces to a
  // *stretched* copy of the picture and the bumps drift away from what you see
  // whenever the image aspect differs from the plane's.
  const imageUvFn = `vec2 pg_imageUv(vec2 uv) {
  return uv * uImageScale + uImageOffset;
}`

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
${wrappedUv ? '#define PG_WRAPPED_UV' : ''}
uniform float uTime;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform vec2 uImageScale;
uniform vec2 uImageOffset;
${uniformDecls.join('\n')}
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vObjPos;
varying float vViewDepth;
attribute vec3 aBary;
varying vec3 vBary;
${imageUvFn}
${commonBlock}
// Radial "distance from the centre" field for deform effects (ripple, bulge).
//
// On plane-like geometry uv is one seamless 0..1 chart, so uv-space is exactly
// what those effects were authored against — keep it. Every other primitive
// wraps its uv somewhere, and a field built from uv creases hard along that
// wrap: crossing it, uv.y runs 0.99 -> 1 -> 0 -> 0.01, so length(uv - 0.5)
// peaks at the seam and reverses gradient. The value stays continuous (the
// mesh never tears) but the slope flips, welding a sharp fold onto the seam
// ring. On a three.js torus that ring is the outer perimeter, because v=0 and
// v=2*PI both land on the outermost vertices.
//
// Object-space xy has no such discontinuity, and on a plane it measures the
// same thing uv did, so closed primitives use it instead and the crease goes.
float pg_radial(vec3 pos, vec2 uv) {
#ifdef PG_WRAPPED_UV
  return length(pos.xy);
#else
  return length(uv - 0.5);
#endif
}
${deformFns.join('\n')}
void main() {
  vUv = uv;
  vBary = aBary;
  vec3 pos = position;
  vec3 nrm = normal;
${deformCalls.join('\n')}
  vObjPos = pos;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  // Distance toward the camera, measured from the object's own origin (the
  // translation column of modelViewMatrix is the origin in view space). View z
  // grows toward the viewer, so +vViewDepth = nearer than the object's centre.
  // Camera-relative rather than body-fixed, so the depth ramp stays glued to
  // the viewer while the object rotates.
  vViewDepth = mv.z - modelViewMatrix[3].z;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * nrm);
  gl_Position = projectionMatrix * mv;
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
uniform vec3 uFacetLight;
uniform float uDepth;
uniform vec3 uDepthLow;
uniform float uDepthRange;
${uniformDecls.join('\n')}
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vObjPos;
varying float vViewDepth;
varying vec3 vBary;
${imageUvFn}
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
  // Aspect-correct cover fit — the same framing pg_imageUv gives the deform
  // chain, so vertex displacement and visible pixels agree.
  return texture2D(uTexture, pg_imageUv(uv));
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
    // back-faces shade consistently. Two-colour ramp: uFlatColor is the unlit
    // (body) end, uFacetLight the lit end — same mix() shape as the depth branch.
    vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (dot(N, cameraPosition - vWorldPos) < 0.0) N = -N;
    vec3 L = normalize(vec3(0.4, 0.7, 0.6));
    float ndl = max(dot(N, L), 0.0);
    color = vec4(mix(uFlatColor, uFacetLight, ndl), 1.0);
  }
  if (uDepth > 0.5) {
    // Depth ramp, no directional light: vViewDepth is the post-deform distance
    // toward the camera relative to the object's centre, so near surfaces get
    // uFlatColor and far ones uDepthLow whatever the object's rotation. Map
    // ±uDepthRange (world units) onto 0..1.
    float h = clamp(vViewDepth / max(uDepthRange, 1e-4) * 0.5 + 0.5, 0.0, 1.0);
    color = vec4(mix(uDepthLow, uFlatColor, h), 1.0);
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
    wrappedUv,
    stack: effects.map((e) => `${e.instance.instanceId}:${e.def.id}:${e.def.kind}`),
    // include glsl bodies so live-edited shaders trigger a recompile
    bodies: effects.map((e) => `${e.def.glslDeform ?? ''}|${e.def.glslShade ?? ''}|${e.def.glslCommon ?? ''}`)
  })

  return { vertexShader, fragmentShader, bindings, signature }
}
