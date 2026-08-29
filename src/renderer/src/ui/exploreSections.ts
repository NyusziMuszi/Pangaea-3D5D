// Single source of truth for which "Feeling lucky" Explore sections exist and
// which render by default, shared by LibraryPanel (renders the panel from
// this list) and PreferencesPanel (edits the visibility list). Mirrors the
// role objectOptions.ts plays for surface/shape option lists.

export type ExploreSectionId =
  | "typeColors"
  | "surfaceColors"
  | "images"
  | "mappings"
  | "objectCounts"
  | "surfaces"
  | "rampColors"
  | "shapes"
  | "colorSchemes"
  | "textBackdrops"
  | "blendModes"
  | "effects"
  | "animation";

// Panel order.
export const EXPLORE_SECTIONS: { id: ExploreSectionId; label: string }[] = [
  { id: "typeColors", label: "Palette: Typography" },
  { id: "surfaceColors", label: "Palette: Surface" },
  { id: "images", label: "Palette: Image" },
  { id: "mappings", label: "Image mapping" },
  { id: "objectCounts", label: "Object #" },
  { id: "surfaces", label: "Object surface" },
  { id: "rampColors", label: "Light colour" },
  { id: "shapes", label: "Shapes" },
  { id: "colorSchemes", label: "Colour Rhythm" },
  { id: "textBackdrops", label: "Text background" },
  { id: "blendModes", label: "Blend" },
  { id: "effects", label: "Effects pool" },
  { id: "animation", label: "Animations" },
];

// == what Explore shows today.
export const DEFAULT_EXPLORE_SECTIONS: ExploreSectionId[] = [
  "typeColors",
  "surfaceColors",
  "images",
  "mappings",
  "objectCounts",
  "surfaces",
  "rampColors",
  "colorSchemes",
  "animation",
];
