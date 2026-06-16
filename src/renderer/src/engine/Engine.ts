import * as THREE from "three";
import type { EffectDef, ObjectState, Project, Scalar } from "../types";
import { totalDuration, constant } from "../types";
import { evalScalar } from "./animatable";
import { computeTimeline } from "./timeline";
import {
  composeObjectShader,
  type ResolvedEffect,
  type UniformBinding,
} from "./effects/composer";
import { findEffectDef } from "./effects/catalog";
import { TextOverlay, renderTextCard } from "./textOverlay";
import { loadTextCardFont } from "./fonts";
import { loadImage, loadModelGeometry } from "./loaders";

interface ActiveBinding extends UniformBinding {
  def: EffectDef;
}

// Vase-like profile revolved by LatheGeometry to build the 'lathe' primitive.
function latheProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const y = (t - 0.5) * 2.2;
    const radius =
      0.35 + 0.55 * Math.sin(t * Math.PI) + 0.15 * Math.sin(t * Math.PI * 4);
    points.push(new THREE.Vector2(Math.max(radius, 0.001), y));
  }
  return points;
}

// Trefoil-knot-like path used to build the 'tube' primitive.
class TubePathCurve extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super();
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 2;
    const x = Math.sin(a) + 2 * Math.sin(2 * a);
    const y = Math.cos(a) - 2 * Math.cos(2 * a);
    const z = -Math.sin(3 * a);
    return target.set(x, y, z).multiplyScalar(0.45);
  }
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private perspectiveCamera: THREE.PerspectiveCamera;
  private isometricCamera: THREE.OrthographicCamera;
  private camera: THREE.Camera;
  private objectGroup = new THREE.Group();
  // Optional second object. Shares the primary object's material; only its
  // geometry and transform are independent.
  private objectGroup2 = new THREE.Group();
  private objectMesh2: THREE.Object3D | null = null;
  private object2Sig = "";
  private overlay = new TextOverlay();

  private project: Project | null = null;

  // image
  // sRGB-normalized copy of the source image (see normalizeToSrgb). Used for
  // the object texture so colours match the file.
  private imageSource: CanvasImageSource | null = null;
  private imageTexture: THREE.Texture | null = null;
  private imageAspect = 1; // natural width / height of the loaded image
  private placeholder: THREE.Texture;
  private lastImageUrl: string | null = null;

  // object
  private objectMesh: THREE.Object3D | null = null;
  private objectMaterial: THREE.ShaderMaterial | null = null;
  private objectSig = "";
  private materialSig = "";
  private activeBindings: ActiveBinding[] = [];
  private modelToken = 0;
  private loadedModelGeo: THREE.BufferGeometry | null = null;
  private loadedModelUrl: string | null = null;

  // text cache
  private textCache = new Map<string, THREE.CanvasTexture>();

  // playback
  private playing = false;
  private playhead = 0;
  private raf = 0;
  private lastTs = 0;
  onTick: ((t: number) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onShaderError: ((msg: string | null) => void) | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Surface GLSL compile errors (used by the in-app shader editor).
    this.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
      const vlog = gl.getShaderInfoLog(vs) ?? "";
      const flog = gl.getShaderInfoLog(fs) ?? "";
      this.onShaderError?.([vlog, flog].filter(Boolean).join("\n").trim());
    };

    this.perspectiveCamera = new THREE.PerspectiveCamera(45, 1080 / 1350, 0.01, 100);
    this.perspectiveCamera.position.set(0, 0, 2.45);

    // Frustum half-height chosen to roughly match the perspective camera's
    // framing at its default distance (2 * 2.45 * tan(22.5deg) / 2).
    const isoHalfHeight = 1.0148;
    this.isometricCamera = new THREE.OrthographicCamera(
      -isoHalfHeight * (1080 / 1350),
      isoHalfHeight * (1080 / 1350),
      isoHalfHeight,
      -isoHalfHeight,
      0.01,
      100,
    );
    this.isometricCamera.position.set(2, 2, 2);
    this.isometricCamera.lookAt(0, 0, 0);

    this.camera = this.perspectiveCamera;

    this.scene.add(this.objectGroup);
    this.scene.add(this.objectGroup2);

    // 1x1 gray placeholder until an image is loaded
    this.placeholder = new THREE.DataTexture(
      new Uint8Array([90, 90, 110, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    this.placeholder.needsUpdate = true;

    // Load the custom text-card font, then refresh any cards already drawn with
    // the system fallback so they pick up Parabole.
    loadTextCardFont()
      .then(() => {
        this.clearTextCache();
        this.renderFrame(this.playhead);
      })
      .catch(() => {
        // Font failed to load; text cards keep the system-font fallback.
      });
  }

  mount(container: HTMLElement): void {
    const canvas = this.renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);
    this.setOutputSize(1080, 1350);
  }

  setOutputSize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    const isoHalfHeight = this.isometricCamera.top;
    this.isometricCamera.left = -isoHalfHeight * aspect;
    this.isometricCamera.right = isoHalfHeight * aspect;
    this.isometricCamera.updateProjectionMatrix();
  }

  getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  // -------------------------------------------------------------------------
  // Project reconciliation
  // -------------------------------------------------------------------------
  setProject(project: Project): void {
    const prev = this.project;
    this.project = project;
    this.setOutputSize(project.output.width, project.output.height);

    if (project.image.dataUrl !== this.lastImageUrl) {
      this.lastImageUrl = project.image.dataUrl;
      this.reloadImage();
    }
    this.reconcileObject();
    if (!prev) this.renderFrame(this.playhead);
  }

  // Browsers colour-manage a wide-gamut image (e.g. a macOS Display-P3
  // screenshot) into the destination colour space when drawing onto a 2D
  // canvas, which defaults to sRGB. Direct WebGL texture uploads skip this and
  // show the raw P3 values as sRGB, which reads as oversaturated. Routing the
  // image through an sRGB canvas first restores the file's real colours.
  private normalizeToSrgb(img: HTMLImageElement): CanvasImageSource {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return img;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0);
    return canvas;
  }

  private reloadImage(): void {
    const url = this.lastImageUrl;
    if (!url) {
      this.imageSource = null;
      this.imageTexture = null;
      this.applyTextureToObject();
      return;
    }
    loadImage(url)
      .then((img) => {
        if (this.lastImageUrl !== url) return;
        this.imageAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        this.imageSource = this.normalizeToSrgb(img);
        const tex = new THREE.CanvasTexture(
          this.imageSource as HTMLCanvasElement,
        );
        // NoColorSpace: avoid the GPU's hardware sRGB decode (SRGB8_ALPHA8),
        // which our custom ShaderMaterial never re-encodes on output. The 2D
        // canvas above already produced sRGB bytes; pass them through as-is.
        tex.colorSpace = THREE.NoColorSpace;
        tex.needsUpdate = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        this.imageTexture = tex;
        this.applyTextureToObject();
        this.objectSig = "";
        this.reconcileObject();
        this.renderFrame(this.playhead);
      })
      .catch(() => this.onError?.("Failed to load image"));
  }

  private applyTextureToObject(): void {
    const tex = this.imageTexture ?? this.placeholder;
    if (this.objectMaterial) this.objectMaterial.uniforms.uTexture.value = tex;
  }

  private resolvedEffects(): ResolvedEffect[] {
    const p = this.project!;
    const out: ResolvedEffect[] = [];
    for (const inst of p.effects) {
      if (!inst.enabled) continue;
      const def = findEffectDef(inst.defId, p.customEffects);
      if (def) out.push({ instance: inst, def });
    }
    return out;
  }

  private reconcileObject(): void {
    const p = this.project;
    if (!p) return;
    const sig = [
      p.object.primitive,
      p.object.modelDataUrl ? "model" : "none",
      p.object.mapping,
    ].join("|");

    if (sig !== this.objectSig) {
      this.objectSig = sig;
      this.rebuildObject();
    } else {
      this.reconcileMaterial();
    }
    this.reconcileObject2();
  }

  // Build/clear the optional second object. It reuses the primary object's
  // material (reconciled just above), so only its geometry needs rebuilding
  // when the chosen primitive changes.
  private reconcileObject2(): void {
    const p = this.project!;
    const o2 = p.object2;
    const sig = o2 ? o2.primitive : "";
    if (sig === this.object2Sig) return;
    this.object2Sig = sig;

    if (this.objectMesh2) {
      this.objectGroup2.remove(this.objectMesh2);
      this.objectMesh2 = null;
    }
    if (!o2 || !this.objectMaterial) return;
    const geo = this.primitiveGeometry(o2.primitive);
    this.objectMesh2 = new THREE.Mesh(geo, this.objectMaterial);
    this.objectGroup2.add(this.objectMesh2);
  }

  private clearObject(): void {
    if (this.objectMesh) {
      this.objectGroup.remove(this.objectMesh);
      this.objectMesh = null;
    }
  }

  private rebuildObject(): void {
    const p = this.project!;
    this.clearObject();

    // primitive (incl. plane) or imported model -> composed ShaderMaterial
    this.materialSig = ""; // force material build
    this.reconcileMaterial();

    if (p.object.modelDataUrl) {
      this.loadModelObject(
        p.object.modelDataUrl,
        p.object.modelName ?? "model.glb",
      );
    } else {
      const geo = this.primitiveGeometry(p.object.primitive);
      this.objectMesh = new THREE.Mesh(geo, this.objectMaterial!);
      this.objectGroup.add(this.objectMesh);
    }
  }

  private primitiveGeometry(primitive: string): THREE.BufferGeometry {
    switch (primitive) {
      case "plane":
        return new THREE.PlaneGeometry(1.6, 2.0, 256, 256);
      case "sphere":
      default:
        return new THREE.SphereGeometry(1.0, 128, 128);
      case "cylinder":
        return new THREE.CylinderGeometry(0.85, 0.85, 2.0, 128, 64, true);
      case "torus":
        return new THREE.TorusGeometry(0.78, 0.34, 96, 160);
      case "box":
        return new THREE.BoxGeometry(1.4, 1.7, 1.4, 64, 64, 64);
      case "cone":
        return new THREE.ConeGeometry(1, 2, 96, 24);
      case "lathe":
        return new THREE.LatheGeometry(latheProfile(), 128);
      case "tube":
        return new THREE.TubeGeometry(new TubePathCurve(), 200, 0.32, 32, true);
      case "polyhedron":
        return new THREE.IcosahedronGeometry(1.1, 2);
      case "dodecahedron":
        return new THREE.DodecahedronGeometry(1.15);
      case "icosahedron":
        return new THREE.IcosahedronGeometry(1.15);
      case "octahedron":
        return new THREE.OctahedronGeometry(1.25);
      case "tetrahedron":
        return new THREE.TetrahedronGeometry(1.35);
    }
  }

  private loadModelObject(dataUrl: string, name: string): void {
    if (this.loadedModelGeo && this.loadedModelUrl === dataUrl) {
      this.objectMesh = new THREE.Mesh(
        this.loadedModelGeo,
        this.objectMaterial!,
      );
      this.objectGroup.add(this.objectMesh);
      return;
    }
    const token = ++this.modelToken;
    loadModelGeometry(dataUrl, name)
      .then((geo) => {
        if (token !== this.modelToken) return;
        this.loadedModelGeo = geo;
        this.loadedModelUrl = dataUrl;
        this.clearObject();
        this.objectMesh = new THREE.Mesh(geo, this.objectMaterial!);
        this.objectGroup.add(this.objectMesh);
        this.renderFrame(this.playhead);
      })
      .catch(() => this.onError?.("Failed to load 3D model"));
  }

  private reconcileMaterial(): void {
    const p = this.project!;
    const effects = this.resolvedEffects();
    const composed = composeObjectShader(effects, p.object.mapping);
    if (composed.signature === this.materialSig && this.objectMaterial) return;
    this.materialSig = composed.signature;
    // Optimistically clear any previous compile error; onShaderError re-fires if it fails.
    this.onShaderError?.(null);

    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uTexture: { value: this.imageTexture ?? this.placeholder },
      uResolution: {
        value: new THREE.Vector2(p.output.width, p.output.height),
      },
      uImageScale: { value: new THREE.Vector2(1, 1) },
      uImageOffset: { value: new THREE.Vector2(0, 0) },
      uSilhouette: { value: 0 },
      uFlatColor: { value: new THREE.Vector3(0, 0, 0) },
      uOpacity: { value: 1 },
    };
    this.activeBindings = [];
    for (const b of composed.bindings) {
      uniforms[b.uniformKey] = { value: 0 };
      const def = effects.find(
        (e) => e.instance.instanceId === b.instanceId,
      )!.def;
      this.activeBindings.push({ ...b, def });
    }

    const mat = new THREE.ShaderMaterial({
      vertexShader: composed.vertexShader,
      fragmentShader: composed.fragmentShader,
      uniforms,
      side: THREE.DoubleSide,
      transparent: true,
      // DoubleSide + transparent makes three.js (r169) draw the mesh in two
      // passes (BackSide then FrontSide), each WITH backface culling enabled.
      // Deformers change gl_Position winding, so triangles get misclassified
      // between the passes and drop out — the surface renders as an open
      // lattice. forceSinglePass keeps it one pass with culling off, so every
      // triangle is always drawn and deformed surfaces stay closed.
      forceSinglePass: true,
    });
    this.objectMaterial = mat;
    if (this.objectMesh && (this.objectMesh as THREE.Mesh).isMesh) {
      (this.objectMesh as THREE.Mesh).material = mat;
    }
    // The second object shares this material, so keep it in sync on rebuild.
    if (this.objectMesh2 && (this.objectMesh2 as THREE.Mesh).isMesh) {
      (this.objectMesh2 as THREE.Mesh).material = mat;
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame evaluation + render (deterministic; pure function of t)
  // -------------------------------------------------------------------------
  private valueOf(
    instanceId: string,
    uniformName: string,
    def: EffectDef,
    t: number,
  ): number {
    const inst = this.project!.effects.find((e) => e.instanceId === instanceId);
    let scalar: Scalar | undefined = inst?.values[uniformName];
    if (!scalar) {
      const u = def.uniforms.find((x) => x.name === uniformName);
      scalar = constant(u?.default ?? 0);
    }
    return evalScalar(scalar, t);
  }

  // Apply an object's animated rotation/scale/position to its group. Position
  // is optional on older projects, so it falls back to the origin.
  private applyObjectTransform(
    group: THREE.Group,
    o: ObjectState,
    t: number,
  ): void {
    group.rotation.set(
      evalScalar(o.rotX, t),
      evalScalar(o.rotY, t),
      evalScalar(o.rotZ, t),
    );
    const s = evalScalar(o.scale, t);
    group.scale.set(s, s, s);
    group.position.set(
      evalScalar(o.posX ?? constant(0), t),
      evalScalar(o.posY ?? constant(0), t),
      evalScalar(o.posZ ?? constant(0), t),
    );
  }

  renderFrame(t: number): void {
    const p = this.project;
    if (!p) return;

    this.camera =
      p.scene.cameraType === "isometric"
        ? this.isometricCamera
        : this.perspectiveCamera;
    const tl = computeTimeline(p, t);

    // object material uniforms
    if (this.objectMaterial) {
      this.objectMaterial.uniforms.uTime.value = tl.sceneTime;
      for (const b of this.activeBindings) {
        const u = this.objectMaterial.uniforms[b.uniformKey];
        if (u) u.value = this.valueOf(b.instanceId, b.uniformName, b.def, t);
      }

      // Aspect-correct "cover" framing of the source image (plane object only).
      // Scale the visible UV window so the image fills the frame without
      // squeezing; the overflowing axis is positioned by image.offsetX/Y.
      const scaleU = this.objectMaterial.uniforms.uImageScale
        .value as THREE.Vector2;
      const offU = this.objectMaterial.uniforms.uImageOffset
        .value as THREE.Vector2;
      if (
        p.object.primitive === "plane" &&
        !p.object.modelDataUrl &&
        this.imageTexture
      ) {
        const frameAspect = p.output.width / p.output.height;
        let sx = 1;
        let sy = 1;
        if (this.imageAspect > frameAspect) sx = frameAspect / this.imageAspect;
        else sy = this.imageAspect / frameAspect;
        const posX = evalScalar(p.image.offsetX ?? constant(0.5), t);
        const posY = evalScalar(p.image.offsetY ?? constant(0.5), t);
        scaleU.set(sx, sy);
        offU.set(posX * (1 - sx), posY * (1 - sy));
      } else {
        scaleU.set(1, 1);
        offU.set(0, 0);
      }
    }

    // object transforms
    this.applyObjectTransform(this.objectGroup, p.object, t);
    this.objectGroup2.visible = !!p.object2 && !!this.objectMesh2;
    if (p.object2 && this.objectMesh2) {
      this.applyObjectTransform(this.objectGroup2, p.object2, t);
    }

    // Text-card backdrop: draw the object as a flat silhouette or wireframe
    // (still deformed by the active effects) under the text, over the card's
    // background color. Only meaningful when a textured object mesh exists.
    const backdropActive =
      !!tl.textCard &&
      tl.textCard.style.textBackdrop !== "none" &&
      !!this.objectMaterial;

    if (this.objectMaterial) {
      if (backdropActive) {
        this.objectMaterial.uniforms.uSilhouette.value = 1;
        (this.objectMaterial.uniforms.uFlatColor.value as THREE.Vector3).copy(
          this.hexToRgb01(tl.textCard!.style.textBackdropColor),
        );
        // The backdrop cuts in/out at full strength — only the card's
        // background colour and text fade, so the silhouette/wireframe stays
        // fully opaque regardless of the fade curve.
        this.objectMaterial.uniforms.uOpacity.value = 1;
        this.objectMaterial.wireframe =
          tl.textCard!.style.textBackdrop === "wireframe";
      } else {
        this.objectMaterial.uniforms.uSilhouette.value = 0;
        this.objectMaterial.uniforms.uOpacity.value = 1;
        this.objectMaterial.wireframe = false;
      }
    }

    // text overlay
    if (tl.textCard) {
      // With an active backdrop, the card's flat background fill is skipped
      // (the rendered backdrop + lerped clear color take its place) so only
      // the glyphs draw on top. The glyphs still fade with the card.
      const tex = this.textTexture(
        tl.textCard.segmentId,
        tl.textCard.style,
        backdropActive,
      );
      this.overlay.setTexture(tex);
      this.overlay.setOpacity(tl.textCard.opacity);
    } else {
      this.overlay.setOpacity(0);
    }

    // render
    let clearColor = new THREE.Color(p.scene.backgroundColor);
    if (backdropActive) {
      // Fade from the scene background to the card's color, same curve as
      // the card itself, so the backdrop appears to fade in with the card.
      clearColor = clearColor.lerp(
        new THREE.Color(tl.textCard!.style.backgroundColor),
        tl.textCard!.opacity,
      );
    }
    this.renderer.setClearColor(clearColor, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.overlay.opacity > 0.001 && this.overlay.hasTexture) {
      this.renderer.clearDepth();
      this.renderer.render(this.overlay.scene, this.overlay.camera);
    }
  }

  // Parse a #rrggbb / #rgb hex string into literal 0..1 sRGB components.
  // Deliberately NOT THREE.Color: the object shader outputs raw bytes via
  // NoColorSpace (see reloadImage()), so colour-managed sRGB->linear
  // conversion here would make uFlatColor render too dark.
  private hexToRgb01(hex: string): THREE.Vector3 {
    let h = hex.replace("#", "").trim();
    if (h.length === 3)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    const n = parseInt(h.padEnd(6, "0").slice(0, 6), 16);
    return new THREE.Vector3(
      ((n >> 16) & 255) / 255,
      ((n >> 8) & 255) / 255,
      (n & 255) / 255,
    );
  }

  private textTexture(
    segmentId: string,
    style: import("../types").TextStyle,
    transparentBg = false,
  ): THREE.CanvasTexture {
    const key = `${segmentId}|${transparentBg ? "t" : "o"}|${JSON.stringify(style)}`;
    const cached = this.textCache.get(key);
    if (cached) return cached;
    // drop stale textures for this segment
    for (const k of [...this.textCache.keys()]) {
      if (k.startsWith(`${segmentId}|`)) {
        this.textCache.get(k)?.dispose();
        this.textCache.delete(k);
      }
    }
    const p = this.project!;
    const canvas = renderTextCard(
      p.output.width,
      p.output.height,
      style,
      transparentBg,
    );
    const tex = new THREE.CanvasTexture(canvas);
    // See reloadImage(): avoid GPU sRGB decode that the TextOverlay shader
    // (also a passthrough ShaderMaterial) would never re-encode.
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.textCache.set(key, tex);
    return tex;
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------
  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastTs = performance.now();
    const loop = (ts: number): void => {
      if (!this.playing) return;
      const dt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      const total = this.project ? totalDuration(this.project) : 0;
      this.playhead += dt;
      if (this.playhead >= total)
        this.playhead = this.playhead % Math.max(0.001, total);
      this.renderFrame(this.playhead);
      this.onTick?.(this.playhead);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  seekTo(t: number): void {
    this.playhead = t;
    this.renderFrame(t);
    this.onTick?.(t);
  }

  getPlayhead(): number {
    return this.playhead;
  }

  private clearTextCache(): void {
    for (const t of this.textCache.values()) t.dispose();
    this.textCache.clear();
  }

  dispose(): void {
    this.pause();
    this.renderer.dispose();
    this.clearTextCache();
  }
}
