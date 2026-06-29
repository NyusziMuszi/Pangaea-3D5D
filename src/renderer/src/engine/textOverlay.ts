import * as THREE from 'three'
import type { TextBlendMode, TextStyle } from '../types'
import { getTextCardFontFamily } from './fonts'

// Maps TextBlendMode to the uBlendMode uniform the overlay shader switches on.
// 0 ("normal") is never passed in — setBlend(mode) only takes a scene texture
// for the other four, see Engine.renderFrame's invert/blend branch.
const BLEND_MODE_INDEX: Record<TextBlendMode, number> = {
  normal: 0,
  invert: 1,
  exclusion: 2,
  multiply: 3,
  screen: 4
}

// Render a full-frame colored text card to a 2D canvas at output resolution.
// When transparentBg is true, the background fill is skipped so only the
// glyphs are drawn (used when a 3D backdrop shows through behind the text).
export function renderTextCard(
  width: number,
  height: number,
  style: TextStyle,
  transparentBg = false
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  if (!transparentBg) {
    ctx.fillStyle = style.backgroundColor
    ctx.fillRect(0, 0, width, height)
  }

  const fontPx = style.fontSize
  ctx.fillStyle = style.textColor
  ctx.textBaseline = 'middle'
  ctx.textAlign = style.align
  ctx.font = `600 ${fontPx}px "${getTextCardFontFamily()}", -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`

  const margin = width * 0.1
  const maxWidth = width - margin * 2
  const lineHeight = fontPx * 1.28

  // Word-wrap, honoring explicit newlines.
  const paragraphs = style.content.split('\n')
  const lines: string[] = []
  for (const para of paragraphs) {
    if (para.trim() === '') {
      lines.push('')
      continue
    }
    const words = para.split(/\s+/)
    let current = ''
    for (const word of words) {
      const test = current ? `${current} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = test
      }
    }
    if (current) lines.push(current)
  }

  const x = style.align === 'left' ? margin : style.align === 'right' ? width - margin : width / 2
  const totalHeight = lines.length * lineHeight
  let y = height / 2 - totalHeight / 2 + lineHeight / 2
  for (const line of lines) {
    ctx.fillText(line, x, y)
    y += lineHeight
  }

  return canvas
}

// A fullscreen overlay drawn on top of the 3D scene with adjustable opacity.
export class TextOverlay {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private mesh: THREE.Mesh
  private material: THREE.ShaderMaterial
  private currentTexture: THREE.Texture | null = null

  constructor() {
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uMap: { value: null },
        uOpacity: { value: 0 },
        // Clip-space Z of the fullscreen quad. 0 = near (drawn on top); 1 = far
        // (drawn behind, so depth-tested scene geometry occludes it). See
        // setBehind().
        uDepth: { value: 0 },
        // Blend mode (see setBlend): 0 = normal flat fill (default, ignores the
        // next two uniforms); 1-4 select a formula below that recombines the
        // glyph's own colour (uMap.rgb, i.e. textColor) with uShapeColor (the
        // silhouette's flat fill) — but only where uMask says this pixel sits
        // over the shape, not over the card background.
        uBlendMode: { value: 0 },
        uMask: { value: null },
        uShapeColor: { value: new THREE.Vector3(0, 0, 0) }
      },
      vertexShader: `
        varying vec2 vUv;
        uniform float uDepth;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, uDepth, 1.0); }`,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uMap;
        uniform sampler2D uMask;
        uniform vec3 uShapeColor;
        uniform float uOpacity;
        uniform float uBlendMode;
        varying vec2 vUv;
        void main(){
          vec4 c = texture2D(uMap, vUv);
          vec3 text = c.rgb;
          vec3 outc = text;
          int mode = int(uBlendMode + 0.5);
          if (mode != 0) {
            // Mask alpha: 1 where the silhouette covers this pixel, 0 over the
            // card background. mix() so the blended/plain halves of a glyph
            // meet smoothly at the silhouette's anti-aliased edge.
            float m = texture2D(uMask, vUv).a;
            vec3 shape = uShapeColor;
            vec3 blended = text;
            if (mode == 1) blended = vec3(1.0) - shape;
            else if (mode == 2) blended = shape + text - 2.0 * shape * text;
            else if (mode == 3) blended = shape * text;
            else if (mode == 4) blended = vec3(1.0) - (vec3(1.0) - shape) * (vec3(1.0) - text);
            outc = mix(text, blended, m);
          }
          // Only the glyph's own alpha reaches the screen, so this quad
          // alpha-blends over the already-drawn scene at the glyphs and leaves
          // every non-glyph (alpha 0) pixel untouched.
          gl_FragColor = vec4(outc, c.a * uOpacity);
        }`
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    this.scene.add(this.mesh)
  }

  setTexture(tex: THREE.Texture | null): void {
    this.currentTexture = tex
    this.material.uniforms.uMap.value = tex
  }

  setOpacity(o: number): void {
    this.material.uniforms.uOpacity.value = o
  }

  // Behind mode: push the quad to the far plane and enable depth testing so any
  // scene geometry (every object writes depth, even transparent ones) occludes
  // the text. Off: draw on top with no depth test (the default overlay). The
  // default LessEqualDepth depthFunc lets the quad still draw over the cleared
  // background (depth 1.0) while losing to closer objects.
  setBehind(behind: boolean): void {
    this.material.depthTest = behind
    this.material.uniforms.uDepth.value = behind ? 1 : 0
  }

  // Blend mode: still a normal alpha-blended on-top overlay, but for any mode
  // other than "normal" the glyphs recombine their own colour with
  // shapeColorHex (the silhouette's flat fill) wherever `mask`'s alpha says
  // the glyph sits over the shape, per BLEND_MODE_INDEX. Blending stays
  // NormalBlending so only the glyph pixels touch the screen — the
  // background is left exactly as the scene drew it.
  setBlend(
    mode: TextBlendMode,
    mask: THREE.Texture | null = null,
    shapeColorHex = '#000000'
  ): void {
    this.material.uniforms.uBlendMode.value = BLEND_MODE_INDEX[mode]
    this.material.uniforms.uMask.value = mask
    // Raw hex -> 0..1, no sRGB linearization — matches how textColor and
    // textBackdropColor are already drawn (canvas fillStyle / hexToRgb01 in
    // Engine.ts), so the blend reads consistently with both inputs' space.
    let h = shapeColorHex.replace('#', '').trim()
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const n = parseInt(h.padEnd(6, '0').slice(0, 6), 16)
    ;(this.material.uniforms.uShapeColor.value as THREE.Vector3).set(
      ((n >> 16) & 255) / 255,
      ((n >> 8) & 255) / 255,
      (n & 255) / 255
    )
  }

  get opacity(): number {
    return this.material.uniforms.uOpacity.value as number
  }

  get hasTexture(): boolean {
    return this.currentTexture !== null
  }
}
