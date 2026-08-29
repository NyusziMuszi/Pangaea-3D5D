// Shape of the per-target "brand": the small set of factory values that differ
// between the Electron ("offline") and Web ("online") builds. Both
// branding/electron.ts and branding/web.ts must satisfy this interface. Because
// both files sit in the tsconfig include glob they are type-checked even though
// each build only bundles one — the `@branding` alias (see electron.vite.config.ts
// and vite.config.web.ts) resolves to a different file per target — so any drift
// between the two variants fails `npm run typecheck` / CI.

import type { PaletteColor } from "../types";

export interface BrandTextCard {
  content: string;
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  textBackdropColor: string;
}

export interface BrandLuckyPalette {
  colors: PaletteColor[];
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
  /** "Feeling lucky" default colour pools (the non-colour lucky fields stay shared across builds). */
  lucky: BrandLuckyPalette;
}
