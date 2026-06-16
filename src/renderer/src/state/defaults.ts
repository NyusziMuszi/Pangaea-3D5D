import type {
  EffectDef,
  EffectInstance,
  ObjectState,
  Project,
  Scalar,
} from "../types";
import { constant } from "../types";

export function uid(prefix = "id"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

export function instanceFromDef(def: EffectDef): EffectInstance {
  const values: Record<string, Scalar> = {};
  for (const u of def.uniforms) values[u.name] = constant(u.default);
  return { instanceId: uid("fx"), defId: def.id, enabled: true, values };
}

// A fresh optional second object. Defaults to a small sphere parked to the
// right of the primary object so it reads as a distinct, separate shape.
export function defaultSecondObject(): ObjectState {
  return {
    primitive: "sphere",
    modelName: null,
    modelDataUrl: null,
    mapping: "uv",
    rotX: constant(0),
    rotY: constant(0),
    rotZ: constant(0),
    scale: constant(0.6),
    posX: constant(1.2),
    posY: constant(0),
    posZ: constant(0),
  };
}

export function defaultProject(): Project {
  return {
    version: 1,
    output: { width: 1080, height: 1350, fps: 30 },
    scene: {
      backgroundColor: "#281b6c",
      cameraType: "perspective",
    },
    image: {
      name: null,
      dataUrl: null,
      offsetX: constant(0.5),
      offsetY: constant(0.5),
    },
    object: {
      primitive: "plane",
      modelName: null,
      modelDataUrl: null,
      mapping: "uv",
      rotX: constant(0),
      rotY: constant(0),
      rotZ: constant(0),
      scale: constant(1.02),
      posX: constant(0),
      posY: constant(0),
      posZ: constant(0),
    },
    object2: null,
    effects: [],
    segments: [
      { id: uid("seg"), kind: "animation", label: "Intro", durationSec: 2.5 },
      {
        id: uid("seg"),
        kind: "text",
        label: "Unique message",
        durationSec: 2.5,
        text: {
          content: "Making ideas visible. Giving thinking form.",
          fontSize: 96,
          align: "center",
          textColor: "#000000",
          backgroundColor: "#A3D6DC",
          reveal: "fade",
          textBackdrop: "silhouette",
          textBackdropColor: "#64e36e",
        },
      },
      {
        id: uid("seg"),
        kind: "animation",
        label: "Continue",
        durationSec: 2.5,
      },
      {
        id: uid("seg"),
        kind: "text",
        label: "Sculpture as a Tool",
        durationSec: 2.5,
        text: {
          content: "Sculpture as a Tool for Wider Learning",
          fontSize: 96,
          align: "center",
          textColor: "#000000",
          backgroundColor: "#A3D6DC",
          reveal: "fade",
          textBackdrop: "silhouette",
          textBackdropColor: "#64e36e",
        },
      },
      {
        id: uid("seg"),
        kind: "animation",
        label: "Conclude",
        durationSec: 2.5,
      },
      {
        id: uid("seg"),
        kind: "text",
        label: "3D–5D Learning Revolution",
        durationSec: 2.5,
        text: {
          content: "3D–5D Learning Revolution",
          fontSize: 120,
          align: "center",
          textColor: "#000000",
          backgroundColor: "#A3D6DC",
          reveal: "fade",
          textBackdrop: "silhouette",
          textBackdropColor: "#64e36e",
        },
      },
    ],
    customEffects: [],
  };
}
