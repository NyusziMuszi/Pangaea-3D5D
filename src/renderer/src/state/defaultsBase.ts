// Dependency-free defaults: the hard-coded base blueprints plus the pure id
// helpers. This module imports nothing from prefs.ts, which is what keeps the
// defaults <-> prefs relationship acyclic (prefs.ts seeds its initial state from
// these constants; defaults.ts reads stored prefs at call time). Keeping the
// base here — rather than in defaults.ts — avoids a temporal-dead-zone crash if
// defaults.ts happens to evaluate first in the import graph.
//
// The colours and text-card messages that differ between the Electron and web
// builds come from `@branding` (a per-target module selected by a vite alias;
// see src/renderer/src/branding). Everything else here is shared by both builds.

import type {
  EffectDef,
  EffectInstance,
  HingeEdge,
  ObjectImage,
  ObjectState,
  Project,
  Scalar,
} from "../types";
import { constant } from "../types";
import { branding } from "@branding";
import { BUILTIN_EFFECTS } from "../engine/effects/catalog";

export function uid(prefix = "id"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

export function instanceFromDef(def: EffectDef): EffectInstance {
  const values: Record<string, Scalar> = {};
  for (const u of def.uniforms) values[u.name] = constant(u.default);
  return { instanceId: uid("fx"), defId: def.id, enabled: true, values };
}

// An empty per-object image, centered for cover-fit framing.
export function defaultObjectImage(): ObjectImage {
  return {
    name: null,
    assetId: null,
    offsetX: constant(0.5),
    offsetY: constant(0.5),
  };
}

// The hard-coded blueprint for the optional second object: a small portal parked
// to the right of the primary object so it reads as a distinct, separate shape.
export const BASE_SECOND_OBJECT: ObjectState = {
  primitive: "portal",
  modelName: null,
  modelDataUrl: null,
  mapping: "uv",
  surface: "image",
  surfaceColor: branding.objectSurfaceColor,
  surfaceWireWidth: 1,
  image: defaultObjectImage(),
  effects: [],
  rotX: constant(0),
  rotY: constant(-4.443),
  rotZ: constant(-3.413),
  scale: constant(0.54),
  posX: constant(0),
  posY: constant(0),
  posZ: constant(0.42),
};

// The hard-coded blueprint a brand-new project starts from. defaultProject()
// clones either this or the user's stored prefs blueprint, regenerating ids.
export const BASE_PROJECT: Project = {
  version: 1,
  output: { width: 1080, height: 1350, fps: 30 },
  scene: {
    cameraType: "perspective",
  },
  objects: [
    {
      primitive: "plane",
      modelName: null,
      modelDataUrl: null,
      mapping: "uv",
      surface: "image",
      surfaceColor: branding.objectSurfaceColor,
      surfaceWireWidth: 1,
      image: defaultObjectImage(),
      effects: [],
      rotX: constant(0),
      rotY: constant(0),
      rotZ: constant(0),
      scale: constant(0.7),
      posX: constant(0),
      posY: constant(0),
      posZ: constant(0),
    },
  ],
  segments: [
    {
      id: uid("seg"),
      kind: "animation",
      label: "Intro",
      durationSec: 2.5,
      backgroundColor: branding.animBackgrounds[0],
    },
    {
      id: uid("seg"),
      kind: "text",
      label: "Unique message",
      durationSec: 2.5,
      text: {
        content: branding.textCards[0].content,
        fontSize: branding.textCards[0].fontSize,
        align: "center",
        textColor: branding.textCards[0].textColor,
        backgroundColor: branding.textCards[0].backgroundColor,
        reveal: "fade",
        textBackdrop: "silhouette",
        textBackdropColor: branding.textCards[0].textBackdropColor,
        textBackdropWireWidth: 1,
      },
    },
    {
      id: uid("seg"),
      kind: "animation",
      label: "Continue",
      durationSec: 2.5,
      backgroundColor: branding.animBackgrounds[1],
    },
    {
      id: uid("seg"),
      kind: "text",
      label: "Sculpture as a Tool",
      durationSec: 2.5,
      text: {
        content: branding.textCards[1].content,
        fontSize: branding.textCards[1].fontSize,
        align: "center",
        textColor: branding.textCards[1].textColor,
        backgroundColor: branding.textCards[1].backgroundColor,
        reveal: "fade",
        textBackdrop: "silhouette",
        textBackdropColor: branding.textCards[1].textBackdropColor,
        textBackdropWireWidth: 1,
      },
    },
    {
      id: uid("seg"),
      kind: "animation",
      label: "Conclude",
      durationSec: 2.5,
      backgroundColor: branding.animBackgrounds[2],
    },
    {
      id: uid("seg"),
      kind: "text",
      label: "3D–5D Learning Revolution",
      durationSec: 2.5,
      text: {
        content: branding.textCards[2].content,
        fontSize: branding.textCards[2].fontSize,
        align: "center",
        textColor: branding.textCards[2].textColor,
        backgroundColor: branding.textCards[2].backgroundColor,
        reveal: "fade",
        textBackdrop: "silhouette",
        textBackdropColor: branding.textCards[2].textBackdropColor,
        textBackdropWireWidth: 1,
      },
    },
  ],
  customEffects: [],
  lucky: {
    typeColors: [...branding.lucky.typeColors],
    surfaceColors: [...branding.lucky.surfaceColors],
    images: [],
    objectCounts: [1, 2],
    colorSchemes: ["byPair", "byType", "random"],
    blendModes: ["normal", "exclusion", "invert", "multiply", "screen"],
    textBackdrops: ["silhouette", "wireframe"],
    animation: 0.42,
    locks: { colours: false, motion: false, effects: false, objects: false },
  },
};

function builtinEffectInstance(
  id: string,
  overrides?: Record<string, Scalar>,
): EffectInstance {
  const def = BUILTIN_EFFECTS.find((e) => e.id === id);
  if (!def) throw new Error(`Missing built-in effect: ${id}`);
  const inst = instanceFromDef(def);
  if (overrides) Object.assign(inst.values, overrides);
  return inst;
}

// Folds a bit past perpendicular — the panel body sits at local -x from the
// pivot, so a positive Y-rotation sends it to z = -x*sin(angle) >= 0: angle 0
// is a *closed* card (the two panels coincident), and this value opens it up
// to receding-and-turned-away from camera, matching the reference layout.
export const STILL_FOLD_ANGLE = -1.2;

// The card's layout for each hinge edge — four mirror images of one design.
// Engine.applyFold already mirrors the *fold* rotation per edge (left negates
// the Y euler, bottom negates X); this table mirrors the *photo* layer to
// match, so the hinge edge is always the one nearest the camera and the photo
// tilts away from the panel. Position stays centred (0, 0) on both axes —
// the photo is meant to sit in the middle of the frame regardless of edge.
export const STILL_HINGE_LAYOUTS: Record<
  HingeEdge,
  { rotX: number; rotY: number; posX: number; posY: number; angle: number }
> = {
  right: { rotX: 0, rotY: -0.35, posX: 0, posY: 0, angle: STILL_FOLD_ANGLE },
  left: { rotX: 0, rotY: 0.35, posX: 0, posY: 0, angle: STILL_FOLD_ANGLE },
  top: { rotX: 0.35, rotY: 0, posX: 0, posY: 0, angle: STILL_FOLD_ANGLE },
  bottom: { rotX: -0.35, rotY: 0, posX: 0, posY: 0, angle: STILL_FOLD_ANGLE },
};

const STILL_DEFAULT_LAYOUT = STILL_HINGE_LAYOUTS.right;

// The hard-coded blueprint a new still starts from: two stacked landscape
// planes sharing one image — layer 0 flat and clean, layer 1 a wireframe mesh
// pre-loaded with the displace + relief deformers so it's ready to sculpt.
// A single animation segment (no text card) keeps the timeline/playhead
// machinery usable for scrubbing without pulling in the video-reel structure.
export const BASE_STILL_PROJECT: Project = {
  version: 1,
  mode: "still",
  output: { width: 1620, height: 1080, fps: 30 },
  scene: {
    cameraType: "perspective",
  },
  fold: {
    enabled: true,
    edge: "right",
    angle: constant(STILL_DEFAULT_LAYOUT.angle),
  },
  objects: [
    {
      primitive: "landscape",
      modelName: null,
      modelDataUrl: null,
      mapping: "uv",
      surface: "image",
      surfaceColor: branding.objectSurfaceColor,
      surfaceWireWidth: 1,
      image: defaultObjectImage(),
      effects: [],
      rotX: constant(STILL_DEFAULT_LAYOUT.rotX),
      rotY: constant(STILL_DEFAULT_LAYOUT.rotY),
      rotZ: constant(0),
      scale: constant(0.9),
      posX: constant(STILL_DEFAULT_LAYOUT.posX),
      posY: constant(STILL_DEFAULT_LAYOUT.posY),
      posZ: constant(0),
    },
    {
      primitive: "landscape",
      modelName: null,
      modelDataUrl: null,
      mapping: "uv",
      surface: "wireframe",
      surfaceColor: branding.objectSurfaceColor,
      // Recessed end of the depth ramp — a dark neutral coherent with the
      // grey surfaceColor tones used by both brand palettes.
      surfaceColorLow: "#2a2a2a",
      surfaceWireWidth: 1,
      depthRange: 0.5,
      image: defaultObjectImage(),
      // Bias +1: the mesh panel only ever displaces *behind* its own plane,
      // so the plane's hinge edge stays the panel's front-most extent and
      // meets the photo's edge exactly, instead of the default symmetric
      // displacement poking a bulge out past the seam. Flip to -1 if the
      // running app shows the strip on the wrong side of the hinge.
      effects: [
        builtinEffectInstance("displace", { uBias: constant(1) }),
        builtinEffectInstance("relief", { uBias: constant(1) }),
      ],
      rotX: constant(0),
      rotY: constant(0),
      rotZ: constant(0),
      // Ignored while the fold is on (the mesh panel's transform is derived
      // in Engine.applyFold) — mirrors the image layer so it takes over
      // seamlessly if the fold is switched off.
      scale: constant(0.9),
      posX: constant(STILL_DEFAULT_LAYOUT.posX),
      posY: constant(STILL_DEFAULT_LAYOUT.posY),
      posZ: constant(0.01),
    },
  ],
  segments: [
    {
      id: uid("seg"),
      kind: "animation",
      label: "Still",
      durationSec: 5,
      // White by default — a still is typically composed for print, not a
      // branded video card, so it starts on a neutral page rather than a
      // brand accent colour.
      backgroundColor: "#ffffff",
    },
  ],
  customEffects: [],
  lucky: {
    typeColors: [...branding.lucky.typeColors],
    surfaceColors: [...branding.lucky.surfaceColors],
    images: [],
    objectCounts: [1, 2],
    colorSchemes: ["byPair", "byType", "random"],
    blendModes: ["normal", "exclusion", "invert", "multiply", "screen"],
    textBackdrops: ["silhouette", "wireframe"],
    animation: 0.42,
    locks: { colours: false, motion: false, effects: false, objects: false },
  },
};

// The blueprint for a still's optional third layer: a real 3D shape piercing
// the photo plane (unlike the mesh layer, which is a flat ghost the engine
// keeps strictly behind the photo — see Engine.ts's two-pass fold render).
// Not part of BASE_STILL_PROJECT — a new still stays two layers; the shape is
// opt-in via "+ Add shape". Triplanar mapping rather than "uv": it looks
// correct on any primitive's own UVs, which stretch badly on a sphere.
export const BASE_STILL_SHAPE: ObjectState = {
  primitive: "sphere",
  modelName: null,
  modelDataUrl: null,
  mapping: "triplanar",
  surface: "image",
  surfaceColor: branding.objectSurfaceColor,
  surfaceWireWidth: 1,
  image: defaultObjectImage(), // overwritten by normalizeStill on first edit
  effects: [],
  rotX: constant(0),
  rotY: constant(0),
  rotZ: constant(0),
  scale: constant(0.4),
  // Straddles the photo plane (posZ 0) so it visibly pierces it; centred
  // under the photo layer, which itself sits at posX 0.
  posX: constant(0),
  posY: constant(0),
  posZ: constant(0),
};
