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
  animBackgrounds: ["#281b6c", "#1b6c4f", "#6c2b1b"],
  textCards: [
    {
      content: "Making ideas visible.\n\nGiving thinking form.",
      textColor: "#000000",
      backgroundColor: "#A3D6DC",
      textBackdropColor: "#64e36e",
    },
    {
      content: "Sculpture \nas a Tool for Wider Learning",
      textColor: "#000000",
      backgroundColor: "#A3D6DC",
      textBackdropColor: "#6473e3",
    },
    {
      content: "3D–5D Learning Revolution",
      textColor: "#000000",
      backgroundColor: "#A3D6DC",
      textBackdropColor: "#64e36e",
    },
  ],
  objectSurfaceColor: "#878787",
  lucky: {
    typeColors: ["#ffffff", "#000000"],
    surfaceColors: [
      "#878787",
      "#a3d6dc",
      "#6fec79",
      "#291b6f",
      "#d9f066",
      "#eeb720",
      "#816575",
    ],
  },
};
