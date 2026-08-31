import fontUrl from "@assets/SpaceMono-Bold.ttf?url";
import { constant } from "../types";
import type { Branding } from "./types";

// Web ("online") brand: a distinct factory palette + placeholder messages,
// keeping the open-licensed Space Mono Bold font (safe to publish to GitHub
// Pages). This is the variant the CI `build:web` and the Pages deploy bundle.
//

export const branding: Branding = {
  font: {
    url: fontUrl,
    family: "Space Mono Bold",
    weight: "100 900",
  },
  animBackgrounds: ["#FF4A14", "#A170AF", "#4F83B7"],
  textCards: [
    {
      content: "Start with a bold statement.\n\nThen a supporting line.",
      fontSize: 128,
      textColor: "#8E1818",
      backgroundColor: "#9AD6E6",
      textBackdropColor: "#4F83B7",
    },
    {
      content: "Add your\nmain message here",
      fontSize: 150,
      textColor: "#D9D9D9",
      backgroundColor: "#FF4A14",
      textBackdropColor: "#A170AF",
    },
    {
      content: "End with a memorable line",
      fontSize: 150,
      textColor: "#D9D9D9",
      backgroundColor: "#FF4A14",
      textBackdropColor: "#8E8355",
    },
  ],
  objectSurfaceColor: "#9AD6E6",
  // A twisting, rippling dodecahedron — so a fresh web session has an object
  // and animation on screen right away instead of a static plane. Values
  // copied from a hand-tuned "Feeling lucky" roll.
  defaultObject: {
    primitive: "dodecahedron",
    modelName: null,
    modelDataUrl: null,
    mapping: "uv",
    surface: "depth",
    surfaceColor: "#4F83B7",
    surfaceColorLow: "#ffffff",
    surfaceWireWidth: 1,
    image: { name: null, assetId: null, offsetX: constant(0.5), offsetY: constant(0.5) },
    effects: [
      {
        instanceId: "fx8ltjxhp",
        defId: "twist",
        enabled: true,
        values: { uTwist: constant(1), uSpeed: constant(0.4) },
      },
      {
        instanceId: "fxjz5kgz7",
        defId: "ripple",
        enabled: true,
        values: {
          uAmplitude: constant(0.12),
          uFrequency: constant(14),
          uSpeed: constant(2),
          uAxis: constant(2),
        },
      },
      {
        instanceId: "fx3pwjvcg",
        defId: "jitter",
        enabled: true,
        values: { uScale: constant(3), uAmount: constant(0.12), uSpeed: constant(2) },
      },
      {
        instanceId: "fx8doey6l",
        defId: "wave",
        enabled: true,
        values: {
          uAmplitude: {
            kind: "keys",
            keys: [
              { t: 0, value: 0.5215837032391858, ease: "easeInOut" },
              { t: 15, value: 0.5226147747622744, ease: "easeInOut" },
            ],
          },
          uFrequency: constant(6),
          uSpeed: constant(1.6),
        },
      },
    ],
    rotX: constant(0),
    rotY: {
      kind: "keys",
      keys: [
        { t: 0, value: 0, ease: "easeInOut" },
        { t: 15, value: -5.780530482605219, ease: "easeInOut" },
      ],
    },
    rotZ: constant(0),
    scale: {
      kind: "keys",
      keys: [
        { t: 0, value: 0.8146059037887439, ease: "easeInOut" },
        { t: 15, value: 0.6710768659360921, ease: "easeInOut" },
      ],
    },
    posX: constant(0),
    posY: {
      kind: "keys",
      keys: [
        { t: 0, value: 0.1642451801142924, ease: "easeInOut" },
        { t: 15, value: 0.18705994039839385, ease: "easeInOut" },
      ],
    },
    posZ: constant(0),
  },
  lucky: {
    colors: [
      { hex: "#9AD6E6", roles: ["type"] },
      { hex: "#8E1818", roles: ["type"], weight: 3 },
      { hex: "#D9D9D9", roles: ["type"] },
      { hex: "#FF4A14", roles: ["background", "object"], weight: 1 },
      { hex: "#8E8355", roles: ["background", "object"] },
      { hex: "#A170AF", roles: ["background", "object"] },
      { hex: "#4F83B7", roles: ["background", "object"] },
    ],
    objectCounts: [1, 2],
    colorSchemes: ["byPair", "byType"],
    surfaces: ["image", "depth"],
    blendModes: ["multiply"],
    textBackdrops: ["silhouette"],
    rampColors: ["coloured", "black"],
    mappings: ["triplanar", "reflection"],
    animation: 0.42,
  },
  exploreSections: [
    "colors",
    "images",
    "mappings",
    "objectCounts",
    "surfaces",
    "rampColors",
    "colorSchemes",
    "textBackdrops",
    "blendModes",
    "animation",
  ],
  filenamePrefix: "",
};
