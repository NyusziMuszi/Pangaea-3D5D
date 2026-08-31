// Shape of the per-target "brand": the small set of factory values that differ
// between the Electron ("offline") and Web ("online") builds. Both
// branding/electron.ts and branding/web.ts must satisfy this interface. Because
// both files sit in the tsconfig include glob they are type-checked even though
// each build only bundles one — the `@branding` alias (see electron.vite.config.ts
// and vite.config.web.ts) resolves to a different file per target — so any drift
// between the two variants fails `npm run typecheck` / CI.

import type {
  ColorScheme,
  Mapping,
  ObjectSurface,
  PaletteColor,
  RampColorMode,
  TextBlendMode,
} from "../types";
import type { ExploreSectionId } from "../state/exploreSections"; // type-only: no runtime cycle

export interface BrandTextCard {
  content: string;
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  textBackdropColor: string;
}

// Per-target "Feeling lucky" factory defaults: the Explore config a brand-new
// project (or a fresh "Reset to factory") starts with. `images`, `locks`, and
// `enabledEffectIds` stay shared in state/defaultsBase.ts — they are identical
// on both targets and not brand-shaped.
export interface BrandLucky {
  colors: PaletteColor[];
  objectCounts: (1 | 2)[];
  colorSchemes: ColorScheme[];
  surfaces: ObjectSurface[];
  blendModes: TextBlendMode[];
  textBackdrops: ("silhouette" | "wireframe")[];
  rampColors: RampColorMode[];
  mappings: Mapping[];
  animation: number;
}

export interface Branding {
  font: {
    /** Bundled TTF/OTF url (a `?url` import, so only this target's file is emitted into the build). */
    url: string;
    /** Family name we register the FontFace under and draw text cards with. */
    family: string;
    /** CSS weight range for the single static face (e.g. '100 900' maps the card's 600 request without faux-bolding). */
    weight: string;
  };
  /** Background colours for the 3 animation-break segments, in order. */
  animBackgrounds: [string, string, string];
  /** The 3 text-card segments, in order (content + colours; fontSize/align stay shared). */
  textCards: [BrandTextCard, BrandTextCard, BrandTextCard];
  /** Default surface colour for the primary and second object. */
  objectSurfaceColor: string;
  /** "Feeling lucky" factory defaults for this target. */
  lucky: BrandLucky;
  /** Which Explore sections a fresh install shows by default. */
  exploreSections: ExploreSectionId[];
  /** Prepended to every exported/saved filename stem (see state/filename.ts). */
  filenamePrefix: string;
}
