// Labelled option lists for the Explore checkbox groups, derived from the const
// arrays in types.ts so each option's label is written exactly once and both
// panels render the same set. Mirrors the role objectOptions.ts plays for the
// inspector's dropdowns; PRIMITIVE_OPTIONS and SURFACE_OPTIONS are reused from
// there rather than redefined.
import {
  COLOR_SCHEMES,
  EXPLORE_TEXT_BACKDROPS,
  MAPPINGS,
  OBJECT_COUNTS,
  RAMP_COLOR_MODES,
  TEXT_BLEND_MODES,
  type ColorScheme,
  type ExploreTextBackdrop,
  type Mapping,
  type ObjectCount,
  type RampColorMode,
  type TextBlendMode,
} from "../types";

export interface ExploreOption<T> {
  value: T;
  label: string;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const OBJECT_COUNT_OPTIONS: ExploreOption<ObjectCount>[] = [
  { value: OBJECT_COUNTS[0], label: "Mono" },
  { value: OBJECT_COUNTS[1], label: "Duo" },
];

// "uv" is an initialism, so it capitalises differently from the rest.
export const MAPPING_OPTIONS: ExploreOption<Mapping>[] = MAPPINGS.map((v) => ({
  value: v,
  label: v === "uv" ? "UV" : cap(v),
}));

// The glyphs read as a rhythm: "~" an animation break, "+" / "x" a text card.
const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  byType: "~ + ~ + ~ +",
  byPair: "~ ~ + + x x",
  random: "Random",
};
export const COLOR_SCHEME_OPTIONS: ExploreOption<ColorScheme>[] =
  COLOR_SCHEMES.map((v) => ({ value: v, label: COLOR_SCHEME_LABELS[v] }));

export const RAMP_COLOR_OPTIONS: ExploreOption<RampColorMode>[] =
  RAMP_COLOR_MODES.map((v) => ({ value: v, label: cap(v) }));

export const TEXT_BACKDROP_OPTIONS: ExploreOption<ExploreTextBackdrop>[] =
  EXPLORE_TEXT_BACKDROPS.map((v) => ({ value: v, label: cap(v) }));

export const BLEND_MODE_OPTIONS: ExploreOption<TextBlendMode>[] =
  TEXT_BLEND_MODES.map((v) => ({ value: v, label: cap(v) }));
