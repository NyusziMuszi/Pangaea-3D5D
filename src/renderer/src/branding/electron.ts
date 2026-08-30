import fontUrl from "@assets/parabole-mediumdisplay.otf?url";
import type { Branding } from "./types";

// Electron ("offline") brand: the app's existing factory colours and messages,
// paired with the Parabole display font.
//
// The Parabole file is deliberately NOT committed (see .gitignore) — it ships
// only in local Electron builds, never to GitHub or the web bundle. Nothing
// breaks from its absence on CI: the web build never imports this module, and
// the `?url` import above resolves against vite's ambient module type, so
// `npm run typecheck` passes even when the font file isn't on disk.
export const branding: Branding = {
  font: {
    url: fontUrl,
    family: "Parabole",
    weight: "100 900",
  },
  animBackgrounds: ["#2C1A74", "#ffffff", "#8E95DA"],
  textCards: [
    {
      content: "Making ideas visible.\n\nGiving thinking form.",
      fontSize: 150,
      textColor: "#000000",
      backgroundColor: "#ffffff",
      textBackdropColor: "#866476",
    },
    {
      content: "Sculpture \nas a Tool for Wider Learning",
      fontSize: 150,
      textColor: "#000000",
      backgroundColor: "#ffffff",
      textBackdropColor: "#2C1A74",
    },
    {
      content: "3D–5D Learning Revolution",
      fontSize: 200,
      textColor: "#000000",
      backgroundColor: "#ffffff",
      textBackdropColor: "#F3FF0D",
    },
  ],
  objectSurfaceColor: "#a3d6dc",
  lucky: {
    colors: [
      { hex: "#ffffff", roles: ["background"] },
      { hex: "#000000", roles: ["type"] },
      { hex: "#C4E2EE", roles: ["background", "object"] },
      { hex: "#2C1A74", roles: ["object"], weight: 1 },
      { hex: "#F3FF0D", roles: ["object"] },
      { hex: "#C5D12B", roles: ["object"] },

      { hex: "#8E95DA", roles: ["object"] },
      { hex: "#866476", roles: ["object"], weight: 1 },
    ],
    objectCounts: [1, 2],
    colorSchemes: ["byPair", "byType"],
    surfaces: ["image", "faceted"],
    blendModes: ["normal"],
    textBackdrops: ["silhouette"],
    rampColors: ["white"],
    mappings: ["triplanar", "reflection"],
    animation: 0.42,
  },
  exploreSections: [
    "colors",
    "images",
    "mappings",
    "objectCounts",
    "surfaces",
    "colorSchemes",
    "animation",
    "rampColors",
  ],
};
