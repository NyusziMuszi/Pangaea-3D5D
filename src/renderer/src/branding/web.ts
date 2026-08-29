import fontUrl from "@assets/SpaceMono-Bold.ttf?url";
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
  lucky: {
    typeColors: ["#9AD6E6", "#8E1818", "#D9D9D9"],
    surfaceColors: ["#FF4A14", "#8E8355", "#A170AF", "#4F83B7"],
  },
};
