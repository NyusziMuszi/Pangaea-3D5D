import * as THREE from 'three'

export const PARTICLE_VERTEX = `
precision highp float;
attribute float aSeed;
uniform float uTime;
uniform float uPointSize;
uniform float uDissolve;
uniform float uExplode;
uniform float uSwirl;
varying vec3 vColor;
varying float vAlpha;
vec3 pg_dir(float s){
  float a = s * 6.2831853;
  float z = s * 2.0 - 1.0;
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(a * 7.0), r * sin(a * 13.0), z);
}
void main(){
  vColor = color;
  vec3 pos = position;
  float ang = uSwirl * (0.5 + length(pos.xy)) + uTime * 0.2 * uSwirl;
  float c = cos(ang), s = sin(ang);
  pos.xz = mat2(c, -s, s, c) * pos.xz;
  vec3 d = pg_dir(aSeed);
  pos += d * (uExplode + uDissolve * aSeed) * (0.5 + 0.5 * aSeed);
  vAlpha = 1.0 - smoothstep(0.6, 1.0, uDissolve * (0.4 + aSeed));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = uPointSize * (300.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`

export const PARTICLE_FRAGMENT = `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  if (dot(q, q) > 0.25) discard;
  if (vAlpha <= 0.01) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}`

export function createParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uPointSize: { value: 3 },
      uDissolve: { value: 0 },
      uExplode: { value: 0 },
      uSwirl: { value: 0 }
    }
  })
}

// Sample the image into a density x density grid of colored points on a plane.
export function buildParticleGeometry(
  source: CanvasImageSource,
  density: number,
  width: number,
  height: number
): THREE.BufferGeometry {
  const n = Math.max(8, Math.floor(density))
  const canvas = document.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, n, n)
  const pixels = ctx.getImageData(0, 0, n, n).data

  const count = n * n
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const seeds = new Float32Array(count)

  let i = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / (n - 1)
      const v = y / (n - 1)
      positions[i * 3 + 0] = (u - 0.5) * width
      positions[i * 3 + 1] = (0.5 - v) * height
      positions[i * 3 + 2] = 0
      const p = (y * n + x) * 4
      colors[i * 3 + 0] = pixels[p] / 255
      colors[i * 3 + 1] = pixels[p + 1] / 255
      colors[i * 3 + 2] = pixels[p + 2] / 255
      // deterministic per-point seed
      seeds[i] = fract(Math.sin((x * 12.9898 + y * 78.233)) * 43758.5453)
      i++
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  return geo
}

function fract(x: number): number {
  return x - Math.floor(x)
}
