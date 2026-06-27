import { create } from "zustand";
import type { ObjectState, Project } from "../types";
import { BASE_PROJECT, BASE_SECOND_OBJECT } from "./defaultsBase";

// The persisted user preferences: the blueprints defaultProject() /
// defaultSecondObject() clone from, plus one optional custom card font (embedded
// as a data URL so it lives inside preferences.json — no separate file copy).
export interface Preferences {
  project: Project; // blueprint for defaultProject(); objects[0] = default primary object
  secondObject: ObjectState; // blueprint for defaultSecondObject()
  customFont: { name: string; dataUrl: string } | null;
}

interface PrefsState extends Preferences {
  // Replace the whole blob from the disk read at boot (or keep the base on null).
  hydrate: (p: Preferences | null) => void;
  setProject: (p: Project) => void;
  setSecondObject: (o: ObjectState) => void;
  setCustomFont: (f: Preferences["customFont"]) => void;
  resetAll: () => void;
}

// The bare persisted shape, stripped of actions, for flushing to disk.
function snapshot(s: Preferences): Preferences {
  return {
    project: s.project,
    secondObject: s.secondObject,
    customFont: s.customFont,
  };
}

// Fire-and-forget flush to userData/preferences.json. window.api is absent only
// in non-Electron contexts (never in the real app); guard so those don't throw.
function persist(s: Preferences): void {
  void window.api?.writePreferences(snapshot(s));
}

export const usePrefs = create<PrefsState>((set, get) => ({
  // Seed from the hard-coded base so the store is valid before the boot hydrate.
  project: structuredClone(BASE_PROJECT),
  secondObject: structuredClone(BASE_SECOND_OBJECT),
  customFont: null,

  hydrate: (p) => {
    if (p) set({ project: p.project, secondObject: p.secondObject, customFont: p.customFont });
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
  resetAll: () => {
    set({
      project: structuredClone(BASE_PROJECT),
      secondObject: structuredClone(BASE_SECOND_OBJECT),
      customFont: null,
    });
    persist(get());
  },
}));

// Non-hook accessor for use inside defaults.ts (and other non-React callers).
export function getPrefs(): PrefsState {
  return usePrefs.getState();
}
