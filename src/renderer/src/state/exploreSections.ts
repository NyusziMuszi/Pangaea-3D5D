// Single source of truth for which "Feeling lucky" Explore sections exist, what
// each is called, and how an option set is toggled. Shared by LibraryPanel
// (renders the Explore panel), PreferencesPanel (edits the factory defaults and
// the visibility list), and prefs.ts (sanitises a stored visibility list).
//
// Lives in state/ rather than ui/ because state/prefs.ts and branding/types.ts
// both depend on it — a ui/ home made state/ import from ui/, which is the very
// dependency prefs.ts's MAX_COLORS comment goes out of its way to avoid.

export type ExploreSectionId =
  | "colors"
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

// Sections whose options only affect text cards. Hidden from the Explore panel
// when the timeline has no text segments — the controls would be inert.
//
// Note "colorSchemes" (Colour Rhythm) is deliberately in this set even though it
// is not strictly inert without text cards: it also decides the background
// colour of every *animation* segment (see lucky.ts's scheme branches), so a
// hidden Colour Rhythm still shapes a roll. Kept hidden by product decision —
// this is a known trade-off, not an oversight.
export const TEXT_CARD_SECTIONS: ReadonlySet<ExploreSectionId> = new Set([
  "colorSchemes",
  "textBackdrops",
  "blendModes",
]);

// Panel order, and the one place each section's label (and its Explore-panel
// info-button copy) is written. Both panels read labels from here so they
// cannot drift apart; only the Explore panel (LibraryPanel) renders `info`.
export const EXPLORE_SECTIONS: { id: ExploreSectionId; label: string; info: string }[] = [
  {
    id: "colors",
    label: "Palette: Colours",
    info: "Colours available to a roll. Tick which roles each swatch may fill — Typography, Background, Object, Text block background, Text block object — a colour is only drawn for roles it's ticked for. Drag a swatch's edge (or use +/−) to set its importance: more important colours are picked more often, though every ticked colour stays possible.",
  },
  {
    id: "images",
    label: "Palette: Image",
    info: "Reference photos a generated object can be textured with. With at least one loaded, Object surface's Image option becomes available, and a roll may dress one — or occasionally, with two objects, both — in a random photo from this pool.",
  },
  {
    id: "mappings",
    label: "Image mapping",
    info: "How a photo is projected onto an object wearing the Image surface: UV, Triplanar, Spherical, Cylindrical, or Reflection. Only appears once at least one palette image is loaded.",
  },
  {
    id: "objectCounts",
    label: "Object #",
    info: "Mono generates a single object; Duo generates two, side by side. The gap between them is randomised each roll, biased toward overlapping rather than spreading fully apart.",
  },
  {
    id: "surfaces",
    label: "Object surface",
    info: "How each object is drawn: Silhouette, Wireframe, Faceted, or Depth for a flat surface, or Image to wear a palette photo (greyed out until one is loaded). With two objects and at least one photo loaded, usually only one object wears the image and the other stays flat — occasionally both do. Two flat objects are given distinct surfaces where this set allows, so a fully-flat pair still reads differently.",
  },
  {
    id: "rampColors",
    label: "Light colour (Faceted, Depth)",
    info: "The second colour of a Faceted or Depth surface's ramp: plain white, plain black, or a colour drawn from the palette that contrasts with the surface's main colour.",
  },
  {
    id: "shapes",
    label: "Shapes",
    info: "Which primitive shapes an object may take.",
  },
  {
    id: "colorSchemes",
    label: "Colour Rhythm",
    info: "How colour trios are dealt across the timeline. ~ + ~ + ~ +: one trio for every animation break, a different trio for every text card. ~ ~ + + x x: each animation break and the text card(s) that follow it share their own trio, so the break reads continuously into its card. Random: every segment is coloured independently.",
  },
  {
    id: "textBackdrops",
    label: "Text background",
    info: "Whether a text card shows the object as a Silhouette or a Wireframe backdrop. One style is picked per generation and applied to every card.",
  },
  {
    id: "blendModes",
    label: "Blend (Text)",
    info: "How the text glyphs composite over the object's backdrop on a text card — only visible when that card's backdrop is Silhouette. One blend mode is picked per generation and applied to every card.",
  },
  {
    id: "effects",
    label: "Effects pool",
    info: "Which built-in effects Explore is allowed to use. Effects that need a palette image (Displace, Relief, Fresnel, Multiply, Mask) stay greyed out until one is loaded.",
  },
  {
    id: "animation",
    label: "Animations",
    info: "Overall animation amount. Higher settings roll more effects at once, more keyframes per animated value, more extra animated transform properties, and a faster rotation sweep.",
  },
];

// Sections that start expanded in the Explore panel; every other visible
// section renders folded. Explore has grown past a screenful, so showing all of
// it open buries the roll button — folding the rarely-touched axes keeps every
// control one click away without hiding that it exists. Not a per-target
// branding choice: both builds open on the same three.
export const EXPLORE_DEFAULT_OPEN: ReadonlySet<ExploreSectionId> = new Set([
  "colors",
  "images",
  "animation",
]);

const LABELS: Record<ExploreSectionId, string> = Object.fromEntries(
  EXPLORE_SECTIONS.map((s) => [s.id, s.label]),
) as Record<ExploreSectionId, string>;

const INFO: Record<ExploreSectionId, string> = Object.fromEntries(
  EXPLORE_SECTIONS.map((s) => [s.id, s.info]),
) as Record<ExploreSectionId, string>;

// The panel label for a section id.
export function exploreLabel(id: ExploreSectionId): string {
  return LABELS[id];
}

// The Explore-panel info-button copy for a section id.
export function exploreInfo(id: ExploreSectionId): string {
  return INFO[id];
}

// Toggle `value` in an Explore option set, for every axis in both panels.
//
// Two storage conventions exist in Project["lucky"] and this preserves both:
//   - required axes (objectCounts, surfaces, ...) always hold a concrete array;
//   - optional axes (shapes, mappings, rampColors, enabledEffectIds) are typed
//     `T[] | undefined`, where undefined means "all" — pass `optional: true` and
//     the set collapses back to undefined once every option is on.
//
// A set is never left empty. lucky.ts already treats an empty pool as "all", so
// emptying one re-selects everything instead of persisting a `[]` that would
// leave every box unticked while the generator quietly rolled all of them.
export function toggleExploreSet<T>(
  current: T[] | undefined,
  value: T,
  all: readonly T[],
  opts?: { optional?: boolean },
): T[] | undefined {
  const base = current ?? [...all];
  const next = base.includes(value)
    ? base.filter((v) => v !== value)
    : [...base, value];
  if (next.length === 0) return [...all];
  if (opts?.optional && next.length === all.length) return undefined;
  return next;
}
