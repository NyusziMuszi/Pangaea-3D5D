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
  ObjectImage,
  ObjectState,
  Project,
  Scalar,
} from "../types";
import { constant } from "../types";
import { branding } from "@branding";

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
    colorSchemes: ["byPair", "byType"],
    surfaces: ["image", "faceted"],
    blendModes: ["normal"],
    textBackdrops: ["silhouette"],
    animation: 0.42,
    locks: { colours: false, motion: false, effects: false, objects: false },
  },
};
