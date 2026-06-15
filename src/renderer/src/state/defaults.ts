import type { EffectDef, EffectInstance, Project, Scalar } from "../types";
import { constant } from "../types";

export function uid(prefix = "id"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

export function instanceFromDef(def: EffectDef): EffectInstance {
  const values: Record<string, Scalar> = {};
  for (const u of def.uniforms) values[u.name] = constant(u.default);
  return { instanceId: uid("fx"), defId: def.id, enabled: true, values };
}

export function defaultProject(): Project {
  return {
    version: 1,
    output: { width: 1080, height: 1350, fps: 30 },
    scene: {
      backgroundColor: "#0b0b0f",
      sceneTimeDuringCards: "continue",
      textBackdrop: "none",
      textBackdropColor: "#000000",
    },
    image: {
      name: null,
      dataUrl: null,
      offsetX: constant(0.5),
      offsetY: constant(0.5),
    },
    subject: {
      mode: "plane",
      primitive: "plane",
      modelName: null,
      modelDataUrl: null,
      mapping: "uv",
      rotX: constant(0),
      rotY: constant(0),
      rotZ: constant(0),
      scale: constant(1.02),
      particle: {
        density: 160,
        pointSize: constant(3),
        dissolve: constant(0),
        explode: constant(0),
        swirl: constant(0),
      },
    },
    effects: [],
    camera: {
      fov: constant(45),
      posX: constant(0),
      posY: constant(0),
      posZ: constant(2.45),
      targetX: constant(0),
      targetY: constant(0),
      targetZ: constant(0),
    },
    segments: [
      { id: uid("seg"), kind: "animation", label: "Intro", durationSec: 2.5 },
      {
        id: uid("seg"),
        kind: "text",
        label: "Text 1",
        durationSec: 2.5,
        text: {
          content: "Your first line",
          fontSize: 96,
          align: "center",
          textColor: "#000000",
          backgroundColor: "#A3D6DC",
          reveal: "fade",
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
        label: "Text 2",
        durationSec: 2.5,
        text: {
          content: "Sculpture as a Tool for Wider Learning",
          fontSize: 96,
          align: "center",
          textColor: "#000000",
          backgroundColor: "#A3D6DC",
          reveal: "fade",
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
        label: "Closing",
        durationSec: 2.5,
        text: {
          content: "3D–5D Learning Revolution",
          fontSize: 120,
          align: "center",
          textColor: "#000000",
          backgroundColor: "#A3D6DC",
          reveal: "fade",
        },
      },
    ],
    customEffects: [],
  };
}
