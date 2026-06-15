import * as THREE from 'three'
import type { TextStyle } from '../types'
import { TEXT_CARD_FONT_FAMILY } from './fonts'

// Render a full-frame colored text card to a 2D canvas at output resolution.
export function renderTextCard(
  width: number,
  height: number,
  style: TextStyle
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = style.backgroundColor
  ctx.fillRect(0, 0, width, height)

  const fontPx = style.fontSize
  ctx.fillStyle = style.textColor
  ctx.textBaseline = 'middle'
  ctx.textAlign = style.align
  ctx.font = `600 ${fontPx}px "${TEXT_CARD_FONT_FAMILY}", -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`

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
        uOpacity: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec2 vUv;
        void main(){
          vec4 c = texture2D(uMap, vUv);
          gl_FragColor = vec4(c.rgb, c.a * uOpacity);
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

  get opacity(): number {
    return this.material.uniforms.uOpacity.value as number
  }

  get hasTexture(): boolean {
    return this.currentTexture !== null
  }
}
