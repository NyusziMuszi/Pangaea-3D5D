import fontUrl from "@assets/SpaceMono-Bold.ttf?url";
import type { Branding } from "./types";

// Web ("online") brand: a distinct factory palette + placeholder messages,
// keeping the open-licensed Space Mono Bold font (safe to publish to GitHub
// Pages). This is the variant the CI `build:web` and the Pages deploy bundle.
//
// Palette: text #003548 / #D9D9D9 · surfaces/backgrounds #FBF09B / #810933 /
// #9BFBD0 / #BEBEBE. Messages are placeholders — tune to taste.
export const branding: Branding = {
  font: {
    url: fontUrl,
    family: "Space Mono Bold",
    weight: "100 900",
  },
  animBackgrounds: ["#810933", "#9BFBD0", "#FBF09B"],
  textCards: [
    {
      content: "Start with a bold statement.\n\nThen a supporting line.",
      fontSize: 128,
      textColor: "#003548",
      backgroundColor: "#FBF09B",
      textBackdropColor: "#810933",
    },
    {
      content: "Add your\nmain message here",
      fontSize: 150,
      textColor: "#003548",
      backgroundColor: "#9BFBD0",
      textBackdropColor: "#810933",
    },
    {
      content: "End with a memorable line",
      fontSize: 150,
      textColor: "#D9D9D9",
      backgroundColor: "#810933",
      textBackdropColor: "#FBF09B",
    },
  ],
  objectSurfaceColor: "#BEBEBE",
  lucky: {
    typeColors: ["#003548", "#D9D9D9"],
    surfaceColors: ["#FBF09B", "#810933", "#9BFBD0", "#BEBEBE", "#003548"],
  },
};
