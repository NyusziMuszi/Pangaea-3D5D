import { create } from "zustand";
import { branding } from "@branding";
import {
  COLOR_SCHEMES,
  type ColorScheme,
  type LuckLocks,
  type ObjectState,
  type PaletteColor,
  type PaletteRole,
  type Project,
} from "../types";
import { BASE_PROJECT, BASE_SECOND_OBJECT } from "./defaultsBase";
import { EXPLORE_SECTIONS, type ExploreSectionId } from "./exploreSections";
import { LUCKY_EFFECTS } from "../engine/effects/catalog";
import {
  applyTasteSignal,
  diffEditFeatures,
  DISLIKE_WEIGHT,
  EDIT_WEIGHT,
  EMPTY_TASTE_PROFILE,
  EXPORT_WEIGHT,
  extractLockedFeatures,
  extractSceneFeatures,
  LIKE_WEIGHT,
  LOCK_WEIGHT,
  SAVE_WEIGHT,
  type TasteProfile,
} from "./taste";

// Pre-unification shape: two flat colour-string pools instead of one
// PaletteColor list with role checkboxes.
type LegacyLucky = Project["lucky"] & {
  typeColors?: string[];
  surfaceColors?: string[];
};

// Mirrors ui/PaletteColorList.tsx's MAX_COLORS — duplicated rather than
// imported (state shouldn't depend on ui) as a defensive ceiling so a
// hand-edited or merged preferences.json can't hand the UI an unbounded
// palette.
const MAX_COLORS = 16;

// Fold the legacy typeColors/surfaceColors pools into one PaletteColor list,
// keyed by lowercased hex so a colour present in both pools (e.g. #ffffff)
// merges into a single entry with both roles rather than duplicating. First
// occurrence wins for the stored hex casing; order is type colours first,
// then any surface-only colours.
function foldLegacyColors(legacy: LegacyLucky): PaletteColor[] {
  const byHex = new Map<string, PaletteColor>();
  const fold = (hexes: string[] | undefined, roles: PaletteRole[]): void => {
    for (const hex of hexes ?? []) {
      if (typeof hex !== "string") continue;
      const key = hex.toLowerCase();
      const existing = byHex.get(key);
      if (existing) {
        for (const r of roles) if (!existing.roles.includes(r)) existing.roles.push(r);
      } else {
        byHex.set(key, { hex, roles: [...roles] });
      }
    }
  };
  fold(legacy.typeColors, ["type"]);
  fold(legacy.surfaceColors, ["background", "object"]);
  return Array.from(byHex.values());
}

// Fills in lucky-config fields added after the initial explore config, drops
// any colorSchemes entries no longer recognised (types.ts's COLOR_SCHEMES),
// and folds the pre-unification typeColors/surfaceColors pools into `colors`
// — shared by prefs hydration (reading preferences.json) and ProjectActions'
// file-open path (reading a saved .pangaea), which otherwise has no migration
// at all and throws as soon as Explore renders a project predating a field
// like `surfaces`.
export function migrateLuckyConfig(lucky: Project["lucky"]): Project["lucky"] {
  const incoming = lucky as LegacyLucky;
  const colorSchemes = lucky.colorSchemes.filter((cs) =>
    COLOR_SCHEMES.includes(cs),
  );
  const colors = (incoming.colors ?? foldLegacyColors(incoming))
    .filter((c) => typeof c.hex === "string")
    .map((c) => (c.weight === 1 || c.weight === 3 ? c : { ...c, weight: undefined }))
    .slice(0, MAX_COLORS);

  const migrated: LegacyLucky = {
    ...incoming,
    colors,
    colorSchemes: colorSchemes.length
      ? colorSchemes
      : BASE_PROJECT.lucky.colorSchemes,
    surfaces: lucky.surfaces ?? BASE_PROJECT.lucky.surfaces,
    blendModes: lucky.blendModes ?? BASE_PROJECT.lucky.blendModes,
    textBackdrops: lucky.textBackdrops ?? BASE_PROJECT.lucky.textBackdrops,
    // multiply/mask were once offered in the Explore pool but can never roll
    // (see catalog.ts's OTHER_OBJECT_EFFECT_IDS). Drop them so a stored set can
    // still reach "every option ticked", which collapses to undefined = all.
    enabledEffectIds: lucky.enabledEffectIds?.filter((id) =>
      LUCKY_EFFECTS.some((e) => e.id === id),
    ),
    objectCounts: lucky.objectCounts ?? BASE_PROJECT.lucky.objectCounts,
    images: lucky.images ?? BASE_PROJECT.lucky.images,
    animation: lucky.animation ?? BASE_PROJECT.lucky.animation,
  };
  // The {...incoming} spread above would otherwise carry these stale legacy
  // keys through into re-persisted prefs.
  delete migrated.typeColors;
  delete migrated.surfaceColors;
  return migrated;
}

// The persisted user preferences: the blueprints defaultProject() /
// defaultSecondObject() clone from, one optional custom card font (embedded
// as a data URL so it lives inside preferences.json — no separate file copy),
// the learned "Feeling lucky" taste profile (see state/taste.ts), and which
// Explore sections render in the panel (app-wide chrome, not project data —
// kept off Project so it never ends up in a saved .pangaea file).
export interface Preferences {
  project: Project; // blueprint for defaultProject(); objects[0] = default primary object
  secondObject: ObjectState; // blueprint for defaultSecondObject()
  customFont: { name: string; dataUrl: string } | null;
  tasteProfile: TasteProfile;
  // Whether the learned taste profile biases "Feeling lucky" rolls. Toggling
  // this off freezes the profile in place (no new signals recorded, no bias
  // applied) rather than clearing it — Reset taste profile is the separate,
  // explicit way to clear it.
  tasteEnabled: boolean;
  exploreSections: ExploreSectionId[];
}

interface PrefsState extends Preferences {
  // Replace the whole blob from the disk read at boot (or keep the base on null).
  hydrate: (p: Preferences | null) => void;
  setProject: (p: Project) => void;
  setSecondObject: (o: ObjectState) => void;
  setCustomFont: (f: Preferences["customFont"]) => void;
  setExploreSections: (s: ExploreSectionId[]) => void;
  // Explicit/implicit taste signals — see state/taste.ts for the weights and
  // what each one credits. colorScheme is whatever the last "Feeling lucky"
  // roll this session produced (store.lastLuckyColorScheme), or null if none.
  recordLike: (project: Project, colorScheme: ColorScheme | null) => void;
  recordDislike: (project: Project, colorScheme: ColorScheme | null) => void;
  recordSave: (project: Project, colorScheme: ColorScheme | null) => void;
  recordExport: (project: Project, colorScheme: ColorScheme | null) => void;
  recordEdit: (prev: Project, next: Project) => void;
  // Called once, when a lock category is switched on (not on every re-roll
  // while it stays locked — see LockPanel.tsx): credits that category's
  // current values (see taste.ts's extractLockedFeatures for exactly what
  // each lock credits). `locks` should have only the just-toggled category
  // set to true, so only that axis is credited.
  recordLocks: (project: Project, locks: LuckLocks, colorScheme: ColorScheme | null) => void;
  resetTaste: () => void;
  setTasteEnabled: (v: boolean) => void;
  resetAll: () => void;
}

// The bare persisted shape, stripped of actions, for flushing to disk.
function snapshot(s: Preferences): Preferences {
  return {
    project: s.project,
    secondObject: s.secondObject,
    customFont: s.customFont,
    tasteProfile: s.tasteProfile,
    tasteEnabled: s.tasteEnabled,
    exploreSections: s.exploreSections,
  };
}

// Fire-and-forget flush to userData/preferences.json. window.api is absent only
// in non-Electron contexts (never in the real app); guard so those don't throw.
function persist(s: Preferences): void {
  void window.api?.writePreferences(snapshot(s));
}

// Mirrors state/defaults.ts's defaultProject() — the blueprint state prefs
// resets to, both on initial store creation and on an explicit reset.
function defaultPrefsState(): Pick<
  PrefsState,
  | "project"
  | "secondObject"
  | "customFont"
  | "tasteProfile"
  | "tasteEnabled"
  | "exploreSections"
> {
  return {
    project: structuredClone(BASE_PROJECT),
    secondObject: structuredClone(BASE_SECOND_OBJECT),
    customFont: null,
    tasteProfile: EMPTY_TASTE_PROFILE,
    tasteEnabled: true,
    exploreSections: [...branding.exploreSections],
  };
}

export const usePrefs = create<PrefsState>((set, get) => {
  // Shared by every like/dislike/save/export signal: credit whatever's
  // currently on screen, bump the profile, persist. No-ops while the taste
  // profile is disabled, so a paused profile stays exactly as the user left it.
  const applySignal = (
    project: Project,
    colorScheme: ColorScheme | null,
    weight: number,
  ): void => {
    if (!get().tasteEnabled) return;
    const features = extractSceneFeatures(project, colorScheme);
    set({
      tasteProfile: applyTasteSignal(get().tasteProfile, features, weight),
    });
    persist(get());
  };

  return {
    // Seed from the hard-coded base so the store is valid before the boot hydrate.
    ...defaultPrefsState(),

    hydrate: (p) => {
      if (!p) return;
      const stored: string[] = p.exploreSections ?? branding.exploreSections;
      // Upgrade: the old typeColors/surfaceColors sections collapsed into one
      // "colors" id — splice it in at the old position so a user who had
      // reordered or hidden the palette sections doesn't lose the section
      // outright under the knownSectionIds filter below.
      const legacyIdx = stored.findIndex(
        (id) => id === "typeColors" || id === "surfaceColors",
      );
      const upgraded =
        legacyIdx >= 0 && !stored.includes("colors")
          ? [...stored.slice(0, legacyIdx), "colors", ...stored.slice(legacyIdx)]
          : stored;
      // A removed section id from an old preferences.json can't leak in.
      const knownSectionIds = new Set<string>(EXPLORE_SECTIONS.map((s) => s.id));
      const exploreSections = upgraded.filter(
        (id): id is ExploreSectionId => knownSectionIds.has(id),
      );
      set({
        project: {
          ...p.project,
          lucky: migrateLuckyConfig(p.project.lucky),
        },
        secondObject: p.secondObject,
        customFont: p.customFont,
        // Back-compat: older preferences.json files predate new axes.
        tasteProfile: { ...EMPTY_TASTE_PROFILE, ...p.tasteProfile },
        // Back-compat: preferences.json predating this flag had taste always on.
        tasteEnabled: p.tasteEnabled ?? true,
        exploreSections,
      });
    },
    setProject: (project) => {
      set({ project });
      persist(get());
    },
    setSecondObject: (secondObject) => {
      set({ secondObject });
      persist(get());
    },
    setCustomFont: (customFont) => {
      set({ customFont });
      persist(get());
    },
    setExploreSections: (exploreSections) => {
      set({ exploreSections });
      persist(get());
    },
    recordLike: (project, colorScheme) =>
      applySignal(project, colorScheme, LIKE_WEIGHT),
    recordDislike: (project, colorScheme) =>
      applySignal(project, colorScheme, DISLIKE_WEIGHT),
    recordSave: (project, colorScheme) =>
      applySignal(project, colorScheme, SAVE_WEIGHT),
    recordExport: (project, colorScheme) =>
      applySignal(project, colorScheme, EXPORT_WEIGHT),
    // Called from the hot update() path on every mutation — must stay cheap.
    // Bail before set/persist when nothing relevant changed, so a slider drag
    // never rewrites preferences.json.
    recordEdit: (prev, next) => {
      if (!get().tasteEnabled) return;
      const features = diffEditFeatures(prev, next);
      if (Object.keys(features).length === 0) return;
      set({
        tasteProfile: applyTasteSignal(
          get().tasteProfile,
          features,
          EDIT_WEIGHT,
        ),
      });
      persist(get());
    },
    recordLocks: (project, locks, colorScheme) => {
      if (!get().tasteEnabled) return;
      const features = extractLockedFeatures(project, colorScheme, locks);
      if (Object.keys(features).length === 0) return;
      set({
        tasteProfile: applyTasteSignal(get().tasteProfile, features, LOCK_WEIGHT),
      });
      persist(get());
    },
    resetTaste: () => {
      set({ tasteProfile: EMPTY_TASTE_PROFILE });
      persist(get());
    },
    setTasteEnabled: (tasteEnabled) => {
      set({ tasteEnabled });
      persist(get());
    },
    resetAll: () => {
      set(defaultPrefsState());
      persist(get());
    },
  };
});

// Non-hook accessor for use inside defaults.ts (and other non-React callers).
export function getPrefs(): PrefsState {
  return usePrefs.getState();
}
