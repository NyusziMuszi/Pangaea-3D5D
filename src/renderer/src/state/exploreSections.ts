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

// Panel order, and the one place each section's label is written. Both panels
// read labels from here so they cannot drift apart.
export const EXPLORE_SECTIONS: { id: ExploreSectionId; label: string }[] = [
  { id: "colors", label: "Palette: Colours" },
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

const LABELS: Record<ExploreSectionId, string> = Object.fromEntries(
  EXPLORE_SECTIONS.map((s) => [s.id, s.label]),
) as Record<ExploreSectionId, string>;

// The panel label for a section id.
export function exploreLabel(id: ExploreSectionId): string {
  return LABELS[id];
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
