import * as THREE from "three";
import type {
  EffectDef,
  EffectInstance,
  ObjectState,
  Project,
  Scalar,
} from "../types";
import { totalDuration, constant } from "../types";
import { evalScalar } from "./animatable";
import { computeTimeline, buildTimelineIndex } from "./timeline";
import type { TimelineIndex } from "./timeline";
import {
  composeObjectShader,
  type ResolvedEffect,
  type UniformBinding,
} from "./effects/composer";
import { findEffectDef } from "./effects/catalog";
import { TextOverlay, renderTextCard } from "./textOverlay";
import { loadTextCardFont } from "./fonts";
import { loadModelGeometry } from "./loaders";
import { assetUrl } from "../state/assets";

// A composed uniform binding resolved once at material-build time: holds a
// direct reference to the owning effect instance and the uniform's default
// scalar, so the per-frame uniform loop never searches the effect stack.
interface ActiveBinding extends UniformBinding {
  instance: EffectInstance;
  defaultScalar: Scalar;
}

type Timeline = ReturnType<typeof computeTimeline>;
type OutputSize = { width: number; height: number };

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

// Trefoil-knot-like path used to build the 'knot' primitive.
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

function withBarycentric(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const count = g.getAttribute("position").count;
  const bary = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = i % 3; // 0,1,2 per triangle
    bary[i * 3 + v] = 1;
  }
  g.setAttribute("aBary", new THREE.BufferAttribute(bary, 3));
  return g;
}

function primitiveGeometry(primitive: string): THREE.BufferGeometry {
  switch (primitive) {
    case "plane":
      return new THREE.PlaneGeometry(1.6, 2.0, 96, 96);
    case "sphere":
      return new THREE.SphereGeometry(1.0, 96, 96);
    case "portal":
    default:
      return new THREE.CylinderGeometry(1, 1, 3, 4, 96, true);
    case "cylinder":
      return new THREE.CylinderGeometry(0.85, 0.85, 2.0, 96, 48, true);

    case "capsule":
      return new THREE.CapsuleGeometry(1, 3, 14, 34, 5);

    case "torus":
      return new THREE.TorusGeometry(0.78, 0.34, 60, 80);
    case "box":
      return new THREE.BoxGeometry(1.4, 1.8, 1.4, 12, 12, 12);
    case "lathe":
      return new THREE.LatheGeometry(latheProfile(), 96);
    case "knot":
      return new THREE.TubeGeometry(new TubePathCurve(), 200, 0.32, 32, true);
    case "twist":
      return new THREE.TorusKnotGeometry(0.3, 0.8, 14, 100, 1, 2);
    case "polyhedron":
      return new THREE.IcosahedronGeometry(1.1, 3);
    case "dodecahedron":
      return new THREE.DodecahedronGeometry(0.9);
  }
}

// Browsers colour-manage a wide-gamut image (e.g. a macOS Display-P3
// screenshot) into the destination colour space when drawing onto a 2D
// canvas, which defaults to sRGB. Direct WebGL texture uploads skip this and
// show the raw P3 values as sRGB, which reads as oversaturated. Routing the
// already-decoded + resized bitmap through an sRGB canvas first restores the
// file's real colours.
function normalizeToSrgb(source: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, source.width);
  canvas.height = Math.max(1, source.height);
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(source, 0, 0);
  return canvas;
}

// Largest texture edge uploaded to the GPU. 4096 still exceeds the 1080×1350
// output, so capped textures stay sharp on export while bounding VRAM and
// upload cost for huge (e.g. 8K) source images.
const MAX_TEXTURE_EDGE = 4096;

// Parse a #rrggbb / #rgb hex string into literal 0..1 sRGB components, writing
// into `target` (no allocation per call).
// Deliberately NOT THREE.Color: the object shader outputs raw bytes via
// NoColorSpace (see ObjectSlot.reloadImage), so colour-managed sRGB->linear
// conversion here would make uFlatColor render too dark.
function hexToRgb01(hex: string, target: THREE.Vector3): THREE.Vector3 {
  let h = hex.replace("#", "").trim();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h.padEnd(6, "0").slice(0, 6), 16);
  return target.set(
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  );
}

// Enabled effects on this object, paired with their resolved definitions.
function resolvedEffects(
  object: ObjectState,
  customEffects: EffectDef[],
): ResolvedEffect[] {
  const out: ResolvedEffect[] = [];
  for (const inst of object.effects) {
    if (!inst.enabled) continue;
    const def = findEffectDef(inst.defId, customEffects);
    if (def) out.push({ instance: inst, def });
  }
  return out;
}

// Hidden per-primitive base rotation, added on top of the user's Rotate X.
// The portal geometry only faces the camera when tilted, but we don't want
// that baked into the user-facing control — so it lives here instead, leaving
// the rotX value clean when switching to another shape.
function primitiveRotXOffset(primitive: string): number {
  return primitive === "portal" ? -1.533 : 0;
}

// Apply an object's animated rotation/scale/position to its group. Position
// is optional on older projects, so it falls back to the origin.
function applyObjectTransform(
  group: THREE.Group,
  o: ObjectState,
  t: number,
): void {
  group.rotation.set(
    evalScalar(o.rotX, t) + primitiveRotXOffset(o.primitive),
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

// ---------------------------------------------------------------------------
// One renderable object: owns its geometry/mesh, composed ShaderMaterial,
// source texture, and per-instance uniform bindings. The Engine keeps two of
// these (primary + optional second), each fully independent.
// ---------------------------------------------------------------------------
class ObjectSlot {
  readonly group = new THREE.Group();
  private mesh: THREE.Object3D | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private objectSig = "";
  private materialSig = "";
  private activeBindings: ActiveBinding[] = [];

  // image
  private imageSource: CanvasImageSource | null = null;
  private imageTexture: THREE.Texture | null = null;
  private imageAspect = 1; // natural width / height of the loaded image
  private lastImageId: string | null = null;

  // model
  private modelToken = 0;
  private loadedModelGeo: THREE.BufferGeometry | null = null;
  private loadedModelUrl: string | null = null;

  constructor(
    private placeholder: THREE.Texture,
    private requestRender: () => void,
    private reportError: (msg: string) => void,
    private reportShaderError: (msg: string | null) => void,
  ) {}

  get hasMesh(): boolean {
    return !!this.mesh;
  }

  get hasMaterial(): boolean {
    return !!this.material;
  }

  // Reconcile this slot to an object (or clear it when null).
  update(
    object: ObjectState | null,
    customEffects: EffectDef[],
    output: OutputSize,
  ): void {
    if (!object) {
      this.clearAll();
      return;
    }
    this.reconcileImage(object);
    this.reconcile(object, customEffects, output);
  }

  private reconcileImage(object: ObjectState): void {
    const id = object.image?.assetId ?? null;
    if (id === this.lastImageId) return;
    this.lastImageId = id;
    this.reloadImage();
  }

  // Swap in a new image texture, disposing the one it replaces so abandoned
  // GPU textures (and the 2D canvas each keeps alive) don't accumulate across
  // image changes — e.g. every "Explore" generation that lands a different
  // image asset on this object.
  private setImageTexture(tex: THREE.Texture | null): void {
    if (this.imageTexture && this.imageTexture !== tex) this.imageTexture.dispose();
    this.imageTexture = tex;
  }

  private reloadImage(): void {
    const id = this.lastImageId;
    const url = id ? assetUrl(id) : null;
    if (!id || !url) {
      this.imageSource = null;
      this.setImageTexture(null);
      this.applyTextureToMaterial();
      return;
    }
    this.decodeTexture(id, url).catch(() =>
      this.reportError("Failed to load image"),
    );
  }

  // Decode the asset off the main thread (createImageBitmap), capping the
  // longest edge at MAX_TEXTURE_EDGE so oversized images don't blow up VRAM or
  // stall the upload. imageAspect is read from the natural (pre-cap) size so
  // cover-fit framing is unaffected by the cap. The id guards against a newer
  // image winning the race while this decode is in flight.
  private async decodeTexture(id: string, url: string): Promise<void> {
    const blob = await (await fetch(url)).blob();
    // Probe to learn the natural size; reused directly when no resize is needed.
    const probe = await createImageBitmap(blob);
    if (this.lastImageId !== id) {
      probe.close();
      return;
    }
    const natW = probe.width;
    const natH = probe.height;
    this.imageAspect = natW / Math.max(1, natH);

    const scale = Math.min(1, MAX_TEXTURE_EDGE / Math.max(natW, natH));
    let bitmap = probe;
    if (scale < 1) {
      bitmap = await createImageBitmap(blob, {
        resizeWidth: Math.max(1, Math.round(natW * scale)),
        resizeHeight: Math.max(1, Math.round(natH * scale)),
        resizeQuality: "high",
      });
      probe.close();
      if (this.lastImageId !== id) {
        bitmap.close();
        return;
      }
    }

    this.imageSource = normalizeToSrgb(bitmap);
    bitmap.close();
    const tex = new THREE.CanvasTexture(this.imageSource as HTMLCanvasElement);
    // NoColorSpace: avoid the GPU's hardware sRGB decode (SRGB8_ALPHA8),
    // which our custom ShaderMaterial never re-encodes on output. The 2D
    // canvas above already produced sRGB bytes; pass them through as-is.
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    // Final guard: a newer image may have won the race after the resize checks
    // above but before the texture existed. Drop ours rather than overwrite
    // (and leak past) the current one.
    if (this.lastImageId !== id) {
      tex.dispose();
      return;
    }
    this.setImageTexture(tex);
    this.applyTextureToMaterial();
    this.requestRender();
  }

  private applyTextureToMaterial(): void {
    const tex = this.imageTexture ?? this.placeholder;
    if (this.material) this.material.uniforms.uTexture.value = tex;
  }

  private reconcile(
    object: ObjectState,
    customEffects: EffectDef[],
    output: OutputSize,
  ): void {
    const sig = [
      object.primitive,
      object.modelDataUrl ? "model" : "none",
      object.mapping,
    ].join("|");

    if (sig !== this.objectSig) {
      this.objectSig = sig;
      this.rebuild(object, customEffects, output);
    } else {
      this.reconcileMaterial(object, customEffects, output);
    }
  }

  private rebuild(
    object: ObjectState,
    customEffects: EffectDef[],
    output: OutputSize,
  ): void {
    this.clearMesh();
    this.materialSig = ""; // force material build
    this.reconcileMaterial(object, customEffects, output);

    if (object.modelDataUrl) {
      this.loadModelObject(
        object.modelDataUrl,
        object.modelName ?? "model.glb",
      );
    } else {
      const geo = withBarycentric(primitiveGeometry(object.primitive));
      this.mesh = new THREE.Mesh(geo, this.material!);
      this.group.add(this.mesh);
    }
  }

  private loadModelObject(dataUrl: string, name: string): void {
    if (this.loadedModelGeo && this.loadedModelUrl === dataUrl) {
      this.mesh = new THREE.Mesh(this.loadedModelGeo, this.material!);
      this.group.add(this.mesh);
      return;
    }
    const token = ++this.modelToken;
    loadModelGeometry(dataUrl, name)
      .then((rawGeo) => {
        if (token !== this.modelToken) return;
        const geo = withBarycentric(rawGeo);
        this.loadedModelGeo = geo;
        this.loadedModelUrl = dataUrl;
        this.clearMesh();
        this.mesh = new THREE.Mesh(geo, this.material!);
        this.group.add(this.mesh);
        this.requestRender();
      })
      .catch(() => this.reportError("Failed to load 3D model"));
  }

  private reconcileMaterial(
    object: ObjectState,
    customEffects: EffectDef[],
    output: OutputSize,
  ): void {
    const effects = resolvedEffects(object, customEffects);
    const composed = composeObjectShader(effects, object.mapping);
    // The shader signature ignores scalar values, so a value-only edit reuses
    // the material. But `setProject` hands us freshly cloned EffectInstances,
    // so we must re-resolve the cached binding refs even on this fast path —
    // otherwise applyFrame would keep reading the previous project's values.
    if (composed.signature === this.materialSig && this.material) {
      this.bindActive(composed.bindings, effects);
      return;
    }
    this.materialSig = composed.signature;
    // Optimistically clear any previous compile error; reportShaderError re-fires if it fails.
    this.reportShaderError(null);

    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uTexture: { value: this.imageTexture ?? this.placeholder },
      uTextureB: { value: this.placeholder },
      uResolution: { value: new THREE.Vector2(output.width, output.height) },
      uImageScale: { value: new THREE.Vector2(1, 1) },
      uImageOffset: { value: new THREE.Vector2(0, 0) },
      uSilhouette: { value: 0 },
      uFlatColor: { value: new THREE.Vector3(0, 0, 0) },
      uOpacity: { value: 1 },
      uWireframe: { value: 0 },
      uWireWidth: { value: 1.5 },
      uFaceted: { value: 0 },
    };
    for (const b of composed.bindings) uniforms[b.uniformKey] = { value: 0 };
    this.bindActive(composed.bindings, effects);

    // Replacing the material without disposing the old ShaderMaterial leaks its
    // compiled GPU program; dispose the previous one first.
    this.material?.dispose();

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
    this.material = mat;
    if (this.mesh && (this.mesh as THREE.Mesh).isMesh) {
      (this.mesh as THREE.Mesh).material = mat;
    }
  }

  // Resolve each composed binding to a direct EffectInstance reference and the
  // uniform's default scalar, so applyFrame can read values without scanning
  // the effect stack. Called on every reconcile (the cloned instances change).
  private bindActive(
    bindings: UniformBinding[],
    effects: ResolvedEffect[],
  ): void {
    this.activeBindings = bindings.map((b) => {
      const re = effects.find((e) => e.instance.instanceId === b.instanceId)!;
      const ud = re.def.uniforms.find((u) => u.name === b.uniformName);
      return {
        ...b,
        instance: re.instance,
        defaultScalar: constant(ud?.default ?? 0),
      };
    });
  }

  get currentTexture(): THREE.Texture | null {
    return this.imageTexture;
  }

  setOtherTexture(tex: THREE.Texture | null): void {
    if (this.material)
      this.material.uniforms.uTextureB.value = tex ?? this.placeholder;
  }

  // Per-frame: drive this object's transform, time, effect uniforms, and the
  // aspect-correct "cover" framing of its source image (plane object only).
  applyFrame(
    object: ObjectState,
    t: number,
    tl: Timeline,
    output: OutputSize,
  ): void {
    applyObjectTransform(this.group, object, t);

    const mat = this.material;
    if (!mat) return;
    mat.uniforms.uTime.value = tl.sceneTime;
    for (const b of this.activeBindings) {
      const u = mat.uniforms[b.uniformKey];
      if (u)
        u.value = evalScalar(
          b.instance.values[b.uniformName] ?? b.defaultScalar,
          t,
        );
    }

    const scaleU = mat.uniforms.uImageScale.value as THREE.Vector2;
    const offU = mat.uniforms.uImageOffset.value as THREE.Vector2;
    if (
      object.primitive === "plane" &&
      !object.modelDataUrl &&
      this.imageTexture
    ) {
      const frameAspect = output.width / output.height;
      let sx = 1;
      let sy = 1;
      if (this.imageAspect > frameAspect) sx = frameAspect / this.imageAspect;
      else sy = this.imageAspect / frameAspect;
      const posX = evalScalar(object.image.offsetX ?? constant(0.5), t);
      const posY = evalScalar(object.image.offsetY ?? constant(0.5), t);
      scaleU.set(sx, sy);
      offU.set(posX * (1 - sx), posY * (1 - sy));
    } else {
      scaleU.set(1, 1);
      offU.set(0, 0);
    }

    this.applySurface(object);
  }

  // The object's own surface mode: textured image (today's default), or a flat
  // silhouette / wireframe drawn in surfaceColor. Sets the per-frame base that
  // applyBackdrop overrides when a text card is active (it runs after this in
  // the same frame). No-op without a material.
  private applySurface(object: ObjectState): void {
    const mat = this.material;
    if (!mat) return;
    const surface = object.surface ?? "image";
    if (surface === "image") {
      mat.uniforms.uSilhouette.value = 0;
      mat.uniforms.uWireframe.value = 0;
      mat.uniforms.uFaceted.value = 0;
    } else {
      // silhouette, wireframe and faceted all colour the surface with
      // surfaceColor; each then sets exactly one flag for its shader branch.
      hexToRgb01(
        object.surfaceColor ?? "#878787",
        mat.uniforms.uFlatColor.value as THREE.Vector3,
      );
      mat.uniforms.uSilhouette.value = surface === "silhouette" ? 1 : 0;
      mat.uniforms.uWireframe.value = surface === "wireframe" ? 1 : 0;
      mat.uniforms.uFaceted.value = surface === "faceted" ? 1 : 0;
      mat.uniforms.uWireWidth.value = object.surfaceWireWidth ?? 1.5;
    }
    mat.uniforms.uOpacity.value = 1;
  }

  // Text-card backdrop: draw the object as a flat silhouette or wireframe
  // (still deformed by the active effects) under the text. When inactive the
  // object's own surface — already applied this frame by applySurface — stands.
  // No-op without a material.
  applyBackdrop(active: boolean, tl: Timeline): void {
    const mat = this.material;
    if (!mat) return;
    if (active && tl.textCard) {
      mat.uniforms.uSilhouette.value = 1;
      hexToRgb01(
        tl.textCard.style.textBackdropColor,
        mat.uniforms.uFlatColor.value as THREE.Vector3,
      );
      // The backdrop cuts in/out at full strength — only the card's background
      // colour and text fade, so the silhouette/wireframe stays fully opaque.
      mat.uniforms.uOpacity.value = 1;
      const isWire = tl.textCard.style.textBackdrop === "wireframe";
      mat.uniforms.uWireframe.value = isWire ? 1 : 0;
      mat.uniforms.uWireWidth.value =
        tl.textCard.style.textBackdropWireWidth ?? 1.5;
      // Clear any faceted flag left by the object's own surface, else its shader
      // branch would override the flat backdrop fill.
      mat.uniforms.uFaceted.value = 0;
    }
  }

  private clearMesh(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      // Dispose the mesh's geometry to free its GPU buffers — but never the
      // cached model geometry, which is reused across rebuilds. The material is
      // owned/disposed separately (reconcileMaterial / clearAll).
      const geo = (this.mesh as THREE.Mesh).geometry;
      if (geo && geo !== this.loadedModelGeo) geo.dispose();
      this.mesh = null;
    }
  }

  private clearAll(): void {
    this.clearMesh();
    this.material?.dispose();
    this.material = null;
    this.loadedModelGeo?.dispose();
    this.loadedModelGeo = null;
    this.loadedModelUrl = null;
    this.setImageTexture(null);
    this.objectSig = "";
    this.materialSig = "";
    this.activeBindings = [];
    this.imageSource = null;
    this.lastImageId = null;
  }
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private perspectiveCamera: THREE.PerspectiveCamera;
  private isometricCamera: THREE.OrthographicCamera;
  private camera: THREE.Camera;
  // One slot per project object — independent peers, each with its own
  // geometry, material, texture and effect stack. Slots are created on demand
  // (and reused/cleared) as the object count changes.
  private slots: ObjectSlot[] = [];
  private overlay = new TextOverlay();

  private project: Project | null = null;

  private placeholder: THREE.Texture;

  // Cumulative segment starts, rebuilt only when segments change (setProject)
  // rather than every frame.
  private timelineIndex: TimelineIndex = { starts: [], total: 0 };

  // Persistent scratch instances reused every frame to avoid per-frame
  // allocation in the hot render path.
  private clearColorScratch = new THREE.Color();
  private cardColorScratch = new THREE.Color();
  private raycaster = new THREE.Raycaster();

  // The text card currently drawn this frame (for click-to-select). Tracks the
  // segment whose card is on screen plus its source 2D canvas, so pickTextAt can
  // sample glyph/background alpha at the cursor. Null when no card is showing.
  private currentTextSegmentId: string | null = null;
  private currentTextCanvas: HTMLCanvasElement | null = null;

  // text cache
  private textCache = new Map<string, THREE.CanvasTexture>();
  // Memoize the (expensive) JSON.stringify of a style object by identity. The
  // style object is stable across all frames of a project version, so this
  // collapses a per-frame stringify into one per edit.
  private styleKeyCache = new WeakMap<object, string>();

  // Logical output size (camera framing + uResolution) is independent of the
  // render-buffer size. During interactive playback we shrink the buffer
  // (renderScale < 1) and let CSS upscale it; still frames render full-res.
  private logicalWidth = 1080;
  private logicalHeight = 1350;
  private renderScale = 1;

  // playback
  private playing = false;
  private playhead = 0;
  private raf = 0;
  private lastTs = 0;
  onTick: ((t: number) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onShaderError: ((msg: string | null) => void) | null = null;

  private requestRender = (): void => this.renderFrame(this.playhead);
  private reportError = (msg: string): void => this.onError?.(msg);
  private reportShaderError = (msg: string | null): void =>
    this.onShaderError?.(msg);

  // Create a new slot wired to this engine's placeholder + callbacks and add
  // its group to the scene. Slots are pooled across object-count changes.
  private createSlot(): ObjectSlot {
    const slot = new ObjectSlot(
      this.placeholder,
      this.requestRender,
      this.reportError,
      this.reportShaderError,
    );
    this.scene.add(slot.group);
    return slot;
  }

  // Raycast against the visible, mesh-bearing slots and return the index of the
  // nearest hit object (mapping the hit back to its slot), or null on a miss.
  // ndc coords are in clip space ([-1, 1], y-up) from the canvas frame.
  pickObjectAt(ndcX: number, ndcY: number): number | null {
    this.raycaster.setFromCamera(
      new THREE.Vector2(ndcX, ndcY),
      this.camera,
    );
    const groups = this.slots
      .filter((s) => s.group.visible && s.hasMesh)
      .map((s) => s.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length === 0) return null;
    // Walk the nearest hit's parent chain up to the slot group it belongs to.
    let node: THREE.Object3D | null = hits[0].object;
    while (node) {
      const idx = this.slots.findIndex((s) => s.group === node);
      if (idx !== -1) return idx;
      node = node.parent;
    }
    return null;
  }

  // Hit-test the on-screen text card and return its segment id, or null. A solid
  // card covers the whole frame (any point hits); a transparent backdrop/behind
  // card only hits where glyphs are drawn. Samples the source 2D canvas's alpha
  // at the cursor so clicking through transparent gaps falls through to objects.
  // ndc coords are clip space ([-1, 1], y-up) from the canvas frame.
  pickTextAt(ndcX: number, ndcY: number): string | null {
    const seg = this.currentTextSegmentId;
    const canvas = this.currentTextCanvas;
    // Ignore cards that have faded out — they're not meaningfully visible.
    if (!seg || !canvas || this.overlay.opacity < 0.05) return null;
    const px = Math.floor(((ndcX + 1) / 2) * canvas.width);
    const py = Math.floor((1 - (ndcY + 1) / 2) * canvas.height);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height)
      return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const alpha = ctx.getImageData(px, py, 1, 1).data[3];
    return alpha > 10 ? seg : null;
  }

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

    this.perspectiveCamera = new THREE.PerspectiveCamera(
      45,
      1080 / 1350,
      0.01,
      100,
    );
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
    // Camera framing comes from the *logical* size, so aspect/framing stay
    // identical regardless of the render-buffer scale.
    this.logicalWidth = w;
    this.logicalHeight = h;
    const aspect = w / h;
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    const isoHalfHeight = this.isometricCamera.top;
    this.isometricCamera.left = -isoHalfHeight * aspect;
    this.isometricCamera.right = isoHalfHeight * aspect;
    this.isometricCamera.updateProjectionMatrix();
    this.applyRenderSize();
  }

  // Size the actual drawing buffer to logical size × renderScale. CSS keeps the
  // canvas at 100%, so a sub-1 scale is upscaled by the browser for free.
  private applyRenderSize(): void {
    this.renderer.setSize(
      Math.max(1, Math.round(this.logicalWidth * this.renderScale)),
      Math.max(1, Math.round(this.logicalHeight * this.renderScale)),
      false,
    );
  }

  // Change the interactive render-buffer scale (1 = full res). Re-renders the
  // current frame at the new resolution. Export forces this back to 1.
  setRenderScale(scale: number): void {
    if (scale === this.renderScale) return;
    this.renderScale = scale;
    this.applyRenderSize();
    this.renderFrame(this.playhead);
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
    this.timelineIndex = buildTimelineIndex(project.segments);

    const objects = project.objects;
    for (let i = 0; i < objects.length; i++) {
      if (!this.slots[i]) this.slots[i] = this.createSlot();
      this.slots[i].update(objects[i], project.customEffects, project.output);
    }
    // Clear (but keep) any pooled slots beyond the current object count.
    for (let i = objects.length; i < this.slots.length; i++) {
      this.slots[i].update(null, project.customEffects, project.output);
    }

    if (!prev) this.renderFrame(this.playhead);
  }

  // -------------------------------------------------------------------------
  // Per-frame evaluation + render (deterministic; pure function of t)
  // -------------------------------------------------------------------------
  renderFrame(t: number): void {
    const p = this.project;
    if (!p) return;

    this.camera =
      p.scene.cameraType === "isometric"
        ? this.isometricCamera
        : this.perspectiveCamera;
    const tl = computeTimeline(p, t, this.timelineIndex);

    // per-object transforms + material uniforms
    const objects = p.objects;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const obj = objects[i];
      slot.group.visible = !!obj && slot.hasMesh;
      if (obj) slot.applyFrame(obj, t, tl, p.output);
    }

    // Cross-wire each slot's "other" texture every frame so blend effects
    // survive material rebuilds (e.g. toggling an effect re-creates the
    // material). Object 0 samples object 1; every later object samples object
    // 0's texture (the semantic the multiply/mask effects rely on).
    const tex0 = this.slots[0]?.currentTexture ?? null;
    const tex1 = this.slots[1]?.currentTexture ?? null;
    for (let i = 0; i < this.slots.length; i++) {
      if (objects[i]) this.slots[i].setOtherTexture(i === 0 ? tex1 : tex0);
    }

    // Text-card backdrop: render each object as a flat silhouette or wireframe
    // under the text, over the card's background color.
    const backdropActive =
      !!tl.textCard &&
      !tl.textCard.behind &&
      tl.textCard.style.textBackdrop !== "none" &&
      (this.slots[0]?.hasMaterial ?? false);

    for (let i = 0; i < this.slots.length; i++) {
      if (objects[i]) this.slots[i].applyBackdrop(backdropActive, tl);
    }

    // text overlay
    if (tl.textCard) {
      // With an active backdrop, the card's flat background fill is skipped
      // (the rendered backdrop + lerped clear color take its place) so only
      // the glyphs draw on top. The glyphs still fade with the card.
      const tex = this.textTexture(
        tl.textCard.segmentId,
        tl.textCard.style,
        backdropActive || tl.textCard.behind,
      );
      this.overlay.setTexture(tex);
      this.overlay.setOpacity(tl.textCard.opacity);
      this.currentTextSegmentId = tl.textCard.segmentId;
      this.currentTextCanvas = tex.image as HTMLCanvasElement;
    } else {
      this.overlay.setOpacity(0);
      this.currentTextSegmentId = null;
      this.currentTextCanvas = null;
    }

    // render
    const clearColor = this.clearColorScratch.set(tl.backgroundColor);
    // Ease the break's background into the title card's background instead of
    // snapping at the cut. With a backdrop this fades in with the card; during
    // the fade-in tail (`behind`) it shifts the break colour toward the upcoming
    // title's colour so the change is smooth across the break→title boundary.
    // The glyphs fade in over the whole tail, but the colour shift is biased
    // toward the end (cubic) so the break holds its colour until close to the
    // cut rather than drifting from the start.
    if (backdropActive || tl.textCard?.behind) {
      const o = tl.textCard!.opacity;
      const mix = tl.textCard!.behind ? o * o * o : o;
      clearColor.lerp(
        this.cardColorScratch.set(tl.textCard!.style.backgroundColor),
        mix,
      );
    }
    this.renderer.setClearColor(clearColor, 1);
    this.renderer.clear();
    const overlayVisible =
      this.overlay.opacity > 0.001 && this.overlay.hasTexture;
    // Fade-in tail ("behind"): keep the scene's depth and depth-test the text
    // against it so *every* object — including transparent ones like the second
    // object — occludes the emerging glyphs. On-top cards clear depth first so
    // the text always wins.
    const behind = !!tl.textCard?.behind;
    this.overlay.setBehind(behind);
    this.renderer.render(this.scene, this.camera);
    if (overlayVisible) {
      if (!behind) this.renderer.clearDepth();
      this.renderer.render(this.overlay.scene, this.overlay.camera);
    }
  }

  private textTexture(
    segmentId: string,
    style: import("../types").TextStyle,
    transparentBg = false,
  ): THREE.CanvasTexture {
    let styleKey = this.styleKeyCache.get(style);
    if (styleKey === undefined) {
      styleKey = JSON.stringify(style);
      this.styleKeyCache.set(style, styleKey);
    }
    const key = `${segmentId}|${transparentBg ? "t" : "o"}|${styleKey}`;
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
    // See ObjectSlot.reloadImage(): avoid GPU sRGB decode that the TextOverlay
    // shader (also a passthrough ShaderMaterial) would never re-encode.
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
    // Drop to a smaller render buffer during playback (CSS upscales it); the
    // crisp full-res frame is restored on pause/seek.
    this.renderScale = 0.5;
    this.applyRenderSize();
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
    // Restore full resolution so the paused frame is crisp.
    if (this.renderScale !== 1) {
      this.renderScale = 1;
      this.applyRenderSize();
      this.renderFrame(this.playhead);
    }
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  seekTo(t: number): void {
    this.playhead = t;
    // A seek lands on a still frame — render it full-res.
    if (this.renderScale !== 1) {
      this.renderScale = 1;
      this.applyRenderSize();
    }
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
