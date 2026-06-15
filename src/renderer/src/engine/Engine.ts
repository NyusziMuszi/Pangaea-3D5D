import * as THREE from 'three'
import type { EffectDef, Project, Scalar } from '../types'
import { totalDuration, constant } from '../types'
import { evalScalar } from './animatable'
import { computeTimeline } from './timeline'
import { composeSubjectShader, type ResolvedEffect, type UniformBinding } from './effects/composer'
import { findEffectDef } from './effects/catalog'
import { createParticleMaterial, buildParticleGeometry } from './effects/particle'
import { TextOverlay, renderTextCard } from './textOverlay'
import { loadTextCardFont } from './fonts'
import { loadImage, loadModelGeometry } from './loaders'

interface ActiveBinding extends UniformBinding {
  def: EffectDef
}

// Vase-like profile revolved by LatheGeometry to build the 'lathe' primitive.
function latheProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = []
  for (let i = 0; i <= 32; i++) {
    const t = i / 32
    const y = (t - 0.5) * 2.2
    const radius = 0.35 + 0.55 * Math.sin(t * Math.PI) + 0.15 * Math.sin(t * Math.PI * 4)
    points.push(new THREE.Vector2(Math.max(radius, 0.001), y))
  }
  return points
}

// Trefoil-knot-like path used to build the 'tube' primitive.
class TubePathCurve extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super()
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 2
    const x = Math.sin(a) + 2 * Math.sin(2 * a)
    const y = Math.cos(a) - 2 * Math.cos(2 * a)
    const z = -Math.sin(3 * a)
    return target.set(x, y, z).multiplyScalar(0.45)
  }
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private subjectGroup = new THREE.Group()
  private overlay = new TextOverlay()

  private project: Project | null = null

  // image
  // sRGB-normalized copy of the source image (see normalizeToSrgb). Used for
  // both the subject texture and particle sampling so colours match the file.
  private imageSource: CanvasImageSource | null = null
  private imageTexture: THREE.Texture | null = null
  private imageAspect = 1 // natural width / height of the loaded image
  private placeholder: THREE.Texture
  private lastImageUrl: string | null = null

  // subject
  private subjectObject: THREE.Object3D | null = null
  private subjectMaterial: THREE.ShaderMaterial | null = null
  private particleMaterial: THREE.ShaderMaterial | null = null
  private subjectSig = ''
  private materialSig = ''
  private activeBindings: ActiveBinding[] = []
  private modelToken = 0
  private loadedModelGeo: THREE.BufferGeometry | null = null
  private loadedModelUrl: string | null = null

  // text cache
  private textCache = new Map<string, THREE.CanvasTexture>()

  // playback
  private playing = false
  private playhead = 0
  private raf = 0
  private lastTs = 0
  onTick: ((t: number) => void) | null = null
  onError: ((msg: string) => void) | null = null
  onShaderError: ((msg: string | null) => void) | null = null

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false
    })
    this.renderer.setPixelRatio(1)
    this.renderer.autoClear = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    // Surface GLSL compile errors (used by the in-app shader editor).
    this.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
      const vlog = gl.getShaderInfoLog(vs) ?? ''
      const flog = gl.getShaderInfoLog(fs) ?? ''
      this.onShaderError?.([vlog, flog].filter(Boolean).join('\n').trim())
    }

    this.camera = new THREE.PerspectiveCamera(45, 1080 / 1350, 0.01, 100)
    this.camera.position.set(0, 0, 2.45)

    this.scene.add(this.subjectGroup)

    // 1x1 gray placeholder until an image is loaded
    this.placeholder = new THREE.DataTexture(
      new Uint8Array([90, 90, 110, 255]),
      1,
      1,
      THREE.RGBAFormat
    )
    this.placeholder.needsUpdate = true

    // Load the custom text-card font, then refresh any cards already drawn with
    // the system fallback so they pick up Parabole.
    loadTextCardFont()
      .then(() => {
        this.clearTextCache()
        this.renderFrame(this.playhead)
      })
      .catch(() => {
        // Font failed to load; text cards keep the system-font fallback.
      })
  }

  mount(container: HTMLElement): void {
    const canvas = this.renderer.domElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)
    this.setOutputSize(1080, 1350)
  }

  setOutputSize(w: number, h: number): void {
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  // -------------------------------------------------------------------------
  // Project reconciliation
  // -------------------------------------------------------------------------
  setProject(project: Project): void {
    const prev = this.project
    this.project = project
    this.setOutputSize(project.output.width, project.output.height)

    if (project.image.dataUrl !== this.lastImageUrl) {
      this.lastImageUrl = project.image.dataUrl
      this.reloadImage()
    }
    this.reconcileSubject()
    if (!prev) this.renderFrame(this.playhead)
  }

  // Browsers colour-manage a wide-gamut image (e.g. a macOS Display-P3
  // screenshot) into the destination colour space when drawing onto a 2D
  // canvas, which defaults to sRGB. Direct WebGL texture uploads skip this and
  // show the raw P3 values as sRGB, which reads as oversaturated. Routing the
  // image through an sRGB canvas first restores the file's real colours.
  private normalizeToSrgb(img: HTMLImageElement): CanvasImageSource {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return img
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return img
    ctx.drawImage(img, 0, 0)
    return canvas
  }

  private reloadImage(): void {
    const url = this.lastImageUrl
    if (!url) {
      this.imageSource = null
      this.imageTexture = null
      this.applyTextureToSubject()
      return
    }
    loadImage(url)
      .then((img) => {
        if (this.lastImageUrl !== url) return
        this.imageAspect = img.naturalWidth / Math.max(1, img.naturalHeight)
        this.imageSource = this.normalizeToSrgb(img)
        const tex = new THREE.CanvasTexture(this.imageSource as HTMLCanvasElement)
        // NoColorSpace: avoid the GPU's hardware sRGB decode (SRGB8_ALPHA8),
        // which our custom ShaderMaterial never re-encodes on output. The 2D
        // canvas above already produced sRGB bytes; pass them through as-is.
        tex.colorSpace = THREE.NoColorSpace
        tex.needsUpdate = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        this.imageTexture = tex
        this.applyTextureToSubject()
        // particle geometry depends on image pixels
        this.subjectSig = ''
        this.reconcileSubject()
        this.renderFrame(this.playhead)
      })
      .catch(() => this.onError?.('Failed to load image'))
  }

  private applyTextureToSubject(): void {
    const tex = this.imageTexture ?? this.placeholder
    if (this.subjectMaterial) this.subjectMaterial.uniforms.uTexture.value = tex
  }

  private resolvedEffects(): ResolvedEffect[] {
    const p = this.project!
    const out: ResolvedEffect[] = []
    for (const inst of p.effects) {
      if (!inst.enabled) continue
      const def = findEffectDef(inst.defId, p.customEffects)
      if (def) out.push({ instance: inst, def })
    }
    return out
  }

  private reconcileSubject(): void {
    const p = this.project
    if (!p) return
    const imgReady = !!this.imageTexture
    const sig = [
      p.subject.mode,
      p.subject.primitive,
      p.subject.modelDataUrl ? 'model' : 'none',
      p.subject.mapping,
      p.subject.particle.density,
      imgReady ? '1' : '0'
    ].join('|')

    if (sig !== this.subjectSig) {
      this.subjectSig = sig
      this.rebuildSubject()
    } else if (p.subject.mode !== 'particles') {
      this.reconcileMaterial()
    }
  }

  private clearSubject(): void {
    if (this.subjectObject) {
      this.subjectGroup.remove(this.subjectObject)
      this.subjectObject = null
    }
  }

  private rebuildSubject(): void {
    const p = this.project!
    this.clearSubject()

    if (p.subject.mode === 'particles') {
      this.buildParticles()
      return
    }

    // plane or model -> composed ShaderMaterial
    this.materialSig = '' // force material build
    this.reconcileMaterial()

    if (p.subject.mode === 'plane') {
      const geo = new THREE.PlaneGeometry(1.6, 2.0, 256, 256)
      this.subjectObject = new THREE.Mesh(geo, this.subjectMaterial!)
      this.subjectGroup.add(this.subjectObject)
    } else {
      // model mode
      if (p.subject.modelDataUrl) {
        this.loadModelSubject(p.subject.modelDataUrl, p.subject.modelName ?? 'model.glb')
      } else {
        const geo = this.primitiveGeometry(p.subject.primitive)
        this.subjectObject = new THREE.Mesh(geo, this.subjectMaterial!)
        this.subjectGroup.add(this.subjectObject)
      }
    }
  }

  private primitiveGeometry(primitive: string): THREE.BufferGeometry {
    switch (primitive) {
      case 'sphere':
        return new THREE.SphereGeometry(1.0, 128, 128)
      case 'cylinder':
        return new THREE.CylinderGeometry(0.85, 0.85, 2.0, 128, 64, true)
      case 'torus':
        return new THREE.TorusGeometry(0.78, 0.34, 96, 160)
      case 'box':
        return new THREE.BoxGeometry(1.4, 1.7, 1.4, 64, 64, 64)
      case 'cone':
        return new THREE.ConeGeometry(0.95, 2.0, 128, 64)
      case 'lathe':
        return new THREE.LatheGeometry(latheProfile(), 128)
      case 'ring':
        return new THREE.RingGeometry(0.4, 1.1, 128, 8)
      case 'tube':
        return new THREE.TubeGeometry(new TubePathCurve(), 200, 0.32, 32, true)
      case 'polyhedron':
        return new THREE.IcosahedronGeometry(1.1, 2)
      case 'dodecahedron':
        return new THREE.DodecahedronGeometry(1.15)
      case 'icosahedron':
        return new THREE.IcosahedronGeometry(1.15)
      case 'octahedron':
        return new THREE.OctahedronGeometry(1.25)
      case 'tetrahedron':
        return new THREE.TetrahedronGeometry(1.35)
      case 'plane':
      default:
        return new THREE.PlaneGeometry(1.6, 2.0, 200, 200)
    }
  }

  private loadModelSubject(dataUrl: string, name: string): void {
    if (this.loadedModelGeo && this.loadedModelUrl === dataUrl) {
      this.subjectObject = new THREE.Mesh(this.loadedModelGeo, this.subjectMaterial!)
      this.subjectGroup.add(this.subjectObject)
      return
    }
    const token = ++this.modelToken
    loadModelGeometry(dataUrl, name)
      .then((geo) => {
        if (token !== this.modelToken) return
        this.loadedModelGeo = geo
        this.loadedModelUrl = dataUrl
        this.clearSubject()
        this.subjectObject = new THREE.Mesh(geo, this.subjectMaterial!)
        this.subjectGroup.add(this.subjectObject)
        this.renderFrame(this.playhead)
      })
      .catch(() => this.onError?.('Failed to load 3D model'))
  }

  private buildParticles(): void {
    const p = this.project!
    if (!this.particleMaterial) this.particleMaterial = createParticleMaterial()
    const source: CanvasImageSource = this.imageSource ?? this.makeFallbackImageSource()
    const geo = buildParticleGeometry(source, p.subject.particle.density, 1.6, 2.0)
    this.subjectObject = new THREE.Points(geo, this.particleMaterial)
    this.subjectGroup.add(this.subjectObject)
  }

  private makeFallbackImageSource(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = 4
    c.height = 4
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#6a6a90'
    ctx.fillRect(0, 0, 4, 4)
    return c
  }

  private reconcileMaterial(): void {
    const p = this.project!
    if (p.subject.mode === 'particles') return
    const effects = this.resolvedEffects()
    const composed = composeSubjectShader(effects, p.subject.mapping)
    if (composed.signature === this.materialSig && this.subjectMaterial) return
    this.materialSig = composed.signature
    // Optimistically clear any previous compile error; onShaderError re-fires if it fails.
    this.onShaderError?.(null)

    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uTexture: { value: this.imageTexture ?? this.placeholder },
      uResolution: { value: new THREE.Vector2(p.output.width, p.output.height) },
      uImageScale: { value: new THREE.Vector2(1, 1) },
      uImageOffset: { value: new THREE.Vector2(0, 0) },
      uSilhouette: { value: 0 },
      uFlatColor: { value: new THREE.Vector3(0, 0, 0) },
      uOpacity: { value: 1 }
    }
    this.activeBindings = []
    for (const b of composed.bindings) {
      uniforms[b.uniformKey] = { value: 0 }
      const def = effects.find((e) => e.instance.instanceId === b.instanceId)!.def
      this.activeBindings.push({ ...b, def })
    }

    const mat = new THREE.ShaderMaterial({
      vertexShader: composed.vertexShader,
      fragmentShader: composed.fragmentShader,
      uniforms,
      side: THREE.DoubleSide,
      transparent: true
    })
    this.subjectMaterial = mat
    if (this.subjectObject && (this.subjectObject as THREE.Mesh).isMesh) {
      ;(this.subjectObject as THREE.Mesh).material = mat
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame evaluation + render (deterministic; pure function of t)
  // -------------------------------------------------------------------------
  private valueOf(instanceId: string, uniformName: string, def: EffectDef, t: number): number {
    const inst = this.project!.effects.find((e) => e.instanceId === instanceId)
    let scalar: Scalar | undefined = inst?.values[uniformName]
    if (!scalar) {
      const u = def.uniforms.find((x) => x.name === uniformName)
      scalar = constant(u?.default ?? 0)
    }
    return evalScalar(scalar, t)
  }

  renderFrame(t: number): void {
    const p = this.project
    if (!p) return
    const tl = computeTimeline(p, t)

    // subject material uniforms
    if (p.subject.mode !== 'particles' && this.subjectMaterial) {
      this.subjectMaterial.uniforms.uTime.value = tl.sceneTime
      for (const b of this.activeBindings) {
        const u = this.subjectMaterial.uniforms[b.uniformKey]
        if (u) u.value = this.valueOf(b.instanceId, b.uniformName, b.def, t)
      }

      // Aspect-correct "cover" framing of the source image (plane mode only).
      // Scale the visible UV window so the image fills the frame without
      // squeezing; the overflowing axis is positioned by image.offsetX/Y.
      const scaleU = this.subjectMaterial.uniforms.uImageScale.value as THREE.Vector2
      const offU = this.subjectMaterial.uniforms.uImageOffset.value as THREE.Vector2
      if (p.subject.mode === 'plane' && this.imageTexture) {
        const frameAspect = p.output.width / p.output.height
        let sx = 1
        let sy = 1
        if (this.imageAspect > frameAspect) sx = frameAspect / this.imageAspect
        else sy = this.imageAspect / frameAspect
        const posX = evalScalar(p.image.offsetX ?? constant(0.5), t)
        const posY = evalScalar(p.image.offsetY ?? constant(0.5), t)
        scaleU.set(sx, sy)
        offU.set(posX * (1 - sx), posY * (1 - sy))
      } else {
        scaleU.set(1, 1)
        offU.set(0, 0)
      }
    }

    // particle uniforms
    if (p.subject.mode === 'particles' && this.particleMaterial) {
      const pc = p.subject.particle
      this.particleMaterial.uniforms.uTime.value = tl.sceneTime
      this.particleMaterial.uniforms.uPointSize.value = evalScalar(pc.pointSize, t)
      this.particleMaterial.uniforms.uDissolve.value = evalScalar(pc.dissolve, t)
      this.particleMaterial.uniforms.uExplode.value = evalScalar(pc.explode, t)
      this.particleMaterial.uniforms.uSwirl.value = evalScalar(pc.swirl, t)
    }

    // subject transform
    this.subjectGroup.rotation.set(
      evalScalar(p.subject.rotX, t),
      evalScalar(p.subject.rotY, t),
      evalScalar(p.subject.rotZ, t)
    )
    const s = evalScalar(p.subject.scale, t)
    this.subjectGroup.scale.set(s, s, s)

    // camera
    this.camera.fov = evalScalar(p.camera.fov, t)
    this.camera.position.set(
      evalScalar(p.camera.posX, t),
      evalScalar(p.camera.posY, t),
      evalScalar(p.camera.posZ, t)
    )
    this.camera.lookAt(
      evalScalar(p.camera.targetX, t),
      evalScalar(p.camera.targetY, t),
      evalScalar(p.camera.targetZ, t)
    )
    this.camera.updateProjectionMatrix()

    // Text-card backdrop: draw the subject as a flat silhouette or wireframe
    // (still deformed by the active effects) under the text, over the card's
    // background color. Only meaningful when a textured subject mesh exists.
    const backdropActive =
      !!tl.textCard &&
      p.scene.textBackdrop !== 'none' &&
      !!this.subjectMaterial &&
      p.subject.mode !== 'particles'

    if (this.subjectMaterial) {
      if (backdropActive) {
        this.subjectMaterial.uniforms.uSilhouette.value = 1
        ;(this.subjectMaterial.uniforms.uFlatColor.value as THREE.Vector3).copy(
          this.hexToRgb01(p.scene.textBackdropColor)
        )
        this.subjectMaterial.uniforms.uOpacity.value = tl.textCard!.opacity
        this.subjectMaterial.wireframe = p.scene.textBackdrop === 'wireframe'
      } else {
        this.subjectMaterial.uniforms.uSilhouette.value = 0
        this.subjectMaterial.uniforms.uOpacity.value = 1
        this.subjectMaterial.wireframe = false
      }
    }

    // text overlay
    if (tl.textCard) {
      // With an active backdrop, the card's flat background fill is skipped
      // (the rendered backdrop + lerped clear color take its place) so only
      // the glyphs draw on top.
      const tex = this.textTexture(tl.textCard.segmentId, tl.textCard.style, backdropActive)
      this.overlay.setTexture(tex)
      this.overlay.setOpacity(backdropActive ? 1 : tl.textCard.opacity)
    } else {
      this.overlay.setOpacity(0)
    }

    // render
    let clearColor = new THREE.Color(p.scene.backgroundColor)
    if (backdropActive) {
      // Fade from the scene background to the card's color, same curve as
      // the card itself, so the backdrop appears to fade in with the card.
      clearColor = clearColor.lerp(
        new THREE.Color(tl.textCard!.style.backgroundColor),
        tl.textCard!.opacity
      )
    }
    this.renderer.setClearColor(clearColor, 1)
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    if (this.overlay.opacity > 0.001 && this.overlay.hasTexture) {
      this.renderer.clearDepth()
      this.renderer.render(this.overlay.scene, this.overlay.camera)
    }
  }

  // Parse a #rrggbb / #rgb hex string into literal 0..1 sRGB components.
  // Deliberately NOT THREE.Color: the subject shader outputs raw bytes via
  // NoColorSpace (see reloadImage()), so colour-managed sRGB->linear
  // conversion here would make uFlatColor render too dark.
  private hexToRgb01(hex: string): THREE.Vector3 {
    let h = hex.replace('#', '').trim()
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const n = parseInt(h.padEnd(6, '0').slice(0, 6), 16)
    return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
  }

  private textTexture(
    segmentId: string,
    style: import('../types').TextStyle,
    transparentBg = false
  ): THREE.CanvasTexture {
    const key = `${segmentId}|${transparentBg ? 't' : 'o'}|${JSON.stringify(style)}`
    const cached = this.textCache.get(key)
    if (cached) return cached
    // drop stale textures for this segment
    for (const k of [...this.textCache.keys()]) {
      if (k.startsWith(`${segmentId}|`)) {
        this.textCache.get(k)?.dispose()
        this.textCache.delete(k)
      }
    }
    const p = this.project!
    const canvas = renderTextCard(p.output.width, p.output.height, style, transparentBg)
    const tex = new THREE.CanvasTexture(canvas)
    // See reloadImage(): avoid GPU sRGB decode that the TextOverlay shader
    // (also a passthrough ShaderMaterial) would never re-encode.
    tex.colorSpace = THREE.NoColorSpace
    tex.needsUpdate = true
    this.textCache.set(key, tex)
    return tex
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------
  play(): void {
    if (this.playing) return
    this.playing = true
    this.lastTs = performance.now()
    const loop = (ts: number): void => {
      if (!this.playing) return
      const dt = (ts - this.lastTs) / 1000
      this.lastTs = ts
      const total = this.project ? totalDuration(this.project) : 0
      this.playhead += dt
      if (this.playhead >= total) this.playhead = this.playhead % Math.max(0.001, total)
      this.renderFrame(this.playhead)
      this.onTick?.(this.playhead)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  pause(): void {
    this.playing = false
    cancelAnimationFrame(this.raf)
  }

  get isPlaying(): boolean {
    return this.playing
  }

  seekTo(t: number): void {
    this.playhead = t
    this.renderFrame(t)
    this.onTick?.(t)
  }

  getPlayhead(): number {
    return this.playhead
  }

  private clearTextCache(): void {
    for (const t of this.textCache.values()) t.dispose()
    this.textCache.clear()
  }

  dispose(): void {
    this.pause()
    this.renderer.dispose()
    this.clearTextCache()
  }
}
