import * as THREE from 'three'
import type { EffectDef, Project, Scalar } from '../types'
import { totalDuration, constant } from '../types'
import { evalScalar } from './animatable'
import { computeTimeline } from './timeline'
import { composeSubjectShader, type ResolvedEffect, type UniformBinding } from './effects/composer'
import { findEffectDef } from './effects/catalog'
import { createParticleMaterial, buildParticleGeometry } from './effects/particle'
import { TextOverlay, renderTextCard } from './textOverlay'
import { loadImage, loadModelGeometry } from './loaders'

interface ActiveBinding extends UniformBinding {
  def: EffectDef
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private subjectGroup = new THREE.Group()
  private overlay = new TextOverlay()

  private project: Project | null = null

  // image
  private imageEl: HTMLImageElement | null = null
  private imageTexture: THREE.Texture | null = null
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

  private reloadImage(): void {
    const url = this.lastImageUrl
    if (!url) {
      this.imageEl = null
      this.imageTexture = null
      this.applyTextureToSubject()
      return
    }
    loadImage(url)
      .then((img) => {
        if (this.lastImageUrl !== url) return
        this.imageEl = img
        const tex = new THREE.Texture(img)
        tex.colorSpace = THREE.SRGBColorSpace
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
    const source: CanvasImageSource = this.imageEl ?? this.makeFallbackImageSource()
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
      uResolution: { value: new THREE.Vector2(p.output.width, p.output.height) }
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
      side: THREE.DoubleSide
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

    // text overlay
    if (tl.textCard) {
      const tex = this.textTexture(tl.textCard.segmentId, tl.textCard.style)
      this.overlay.setTexture(tex)
      this.overlay.setOpacity(tl.textCard.opacity)
    } else {
      this.overlay.setOpacity(0)
    }

    // render
    const bg = new THREE.Color(p.scene.backgroundColor)
    this.renderer.setClearColor(bg, 1)
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    if (this.overlay.opacity > 0.001 && this.overlay.hasTexture) {
      this.renderer.clearDepth()
      this.renderer.render(this.overlay.scene, this.overlay.camera)
    }
  }

  private textTexture(segmentId: string, style: import('../types').TextStyle): THREE.CanvasTexture {
    const key = `${segmentId}|${JSON.stringify(style)}`
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
    const canvas = renderTextCard(p.output.width, p.output.height, style)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
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

  dispose(): void {
    this.pause()
    this.renderer.dispose()
    for (const t of this.textCache.values()) t.dispose()
    this.textCache.clear()
  }
}
