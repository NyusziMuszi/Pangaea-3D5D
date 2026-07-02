import { create } from "zustand";
import type { ColorScheme, ObjectState, Project } from "../types";
import { BASE_PROJECT, BASE_SECOND_OBJECT } from "./defaultsBase";
import {
  applyTasteSignal,
  diffEditFeatures,
  DISLIKE_WEIGHT,
  EDIT_WEIGHT,
  EMPTY_TASTE_PROFILE,
  EXPORT_WEIGHT,
  extractSceneFeatures,
  LIKE_WEIGHT,
  SAVE_WEIGHT,
  type TasteProfile,
} from "./taste";

// The persisted user preferences: the blueprints defaultProject() /
// defaultSecondObject() clone from, one optional custom card font (embedded
// as a data URL so it lives inside preferences.json — no separate file copy),
// and the learned "Feeling lucky" taste profile (see state/taste.ts).
export interface Preferences {
  project: Project; // blueprint for defaultProject(); objects[0] = default primary object
  secondObject: ObjectState; // blueprint for defaultSecondObject()
  customFont: { name: string; dataUrl: string } | null;
  tasteProfile: TasteProfile;
}

interface PrefsState extends Preferences {
  // Replace the whole blob from the disk read at boot (or keep the base on null).
  hydrate: (p: Preferences | null) => void;
  setProject: (p: Project) => void;
  setSecondObject: (o: ObjectState) => void;
  setCustomFont: (f: Preferences["customFont"]) => void;
  // Explicit/implicit taste signals — see state/taste.ts for the weights and
  // what each one credits. colorScheme is whatever the last "Feeling lucky"
  // roll this session produced (store.lastLuckyColorScheme), or null if none.
  recordLike: (project: Project, colorScheme: ColorScheme | null) => void;
  recordDislike: (project: Project, colorScheme: ColorScheme | null) => void;
  recordSave: (project: Project, colorScheme: ColorScheme | null) => void;
  recordExport: (project: Project, colorScheme: ColorScheme | null) => void;
  recordEdit: (prev: Project, next: Project) => void;
  resetTaste: () => void;
  resetAll: () => void;
}

// The bare persisted shape, stripped of actions, for flushing to disk.
function snapshot(s: Preferences): Preferences {
  return {
    project: s.project,
    secondObject: s.secondObject,
    customFont: s.customFont,
    tasteProfile: s.tasteProfile,
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
  "project" | "secondObject" | "customFont" | "tasteProfile"
> {
  return {
    project: structuredClone(BASE_PROJECT),
    secondObject: structuredClone(BASE_SECOND_OBJECT),
    customFont: null,
    tasteProfile: EMPTY_TASTE_PROFILE,
  };
}

export const usePrefs = create<PrefsState>((set, get) => {
  // Shared by every like/dislike/save/export signal: credit whatever's
  // currently on screen, bump the profile, persist.
  const applySignal = (
    project: Project,
    colorScheme: ColorScheme | null,
    weight: number,
  ): void => {
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
      if (p)
        set({
          project: {
            ...p.project,
            lucky: {
              ...p.project.lucky,
              // Back-compat: blendModes and textBackdrops were added after the
              // initial explore config — fall back to BASE_PROJECT defaults when
              // the stored file predates them.
              blendModes:
                p.project.lucky.blendModes ?? BASE_PROJECT.lucky.blendModes,
              textBackdrops:
                p.project.lucky.textBackdrops ??
                BASE_PROJECT.lucky.textBackdrops,
            },
          },
          secondObject: p.secondObject,
          customFont: p.customFont,
          // Back-compat: older preferences.json files predate new axes.
          tasteProfile: { ...EMPTY_TASTE_PROFILE, ...p.tasteProfile },
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
    resetTaste: () => {
      set({ tasteProfile: EMPTY_TASTE_PROFILE });
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
