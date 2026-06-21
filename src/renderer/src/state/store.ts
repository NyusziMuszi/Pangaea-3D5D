import { create } from 'zustand'
import type { ObjectState, Project } from '../types'
import { defaultProject } from './defaults'

interface AppState {
  project: Project
  selectedEffectId: string | null
  selectedSegmentId: string | null
  // Which object the inspector edits: index into project.objects (0 = primary).
  selectedObjectIndex: number
  shaderEditorEffectId: string | null
  playhead: number
  playing: boolean
  toast: string | null
  shaderError: string | null

  setProject: (p: Project) => void
  update: (mutator: (p: Project) => void) => void
  setPlayhead: (t: number) => void
  setPlaying: (v: boolean) => void
  selectEffect: (id: string | null) => void
  selectSegment: (id: string | null) => void
  selectObject: (index: number) => void
  openShaderEditor: (effectDefId: string | null) => void
  setToast: (msg: string | null) => void
  setShaderError: (msg: string | null) => void
}

export const useStore = create<AppState>((set) => ({
  project: defaultProject(),
  selectedEffectId: null,
  selectedSegmentId: null,
  selectedObjectIndex: 0,
  shaderEditorEffectId: null,
  playhead: 0,
  playing: false,
  toast: null,
  shaderError: null,

  setProject: (p) => set({ project: p }),
  update: (mutator) =>
    set((s) => {
      const next = structuredClone(s.project) as Project
      mutator(next)
      return { project: next }
    }),
  setPlayhead: (t) => set({ playhead: t }),
  setPlaying: (v) => set({ playing: v }),
  selectEffect: (id) => set({ selectedEffectId: id }),
  selectSegment: (id) => set({ selectedSegmentId: id }),
  selectObject: (index) => set({ selectedObjectIndex: index }),
  openShaderEditor: (effectDefId) => set({ shaderEditorEffectId: effectDefId }),
  setToast: (msg) => set({ toast: msg }),
  setShaderError: (msg) => set({ shaderError: msg })
}))

// The object index the inspector currently edits, clamped to a valid object
// (a stale selection — e.g. after removing the second object — falls back to 0).
export function activeObjectIndex(p: Project, selected: number): number {
  return p.objects[selected] ? selected : 0
}

// The object the inspector/preview/timeline currently edits. Single source of
// truth for the "which object is active" logic shared across panels. Returns
// undefined when the scene has no objects (every object can be set to None).
export function getActiveObject(
  p: Project,
  selected: number
): ObjectState | undefined {
  return p.objects[activeObjectIndex(p, selected)]
}

export function useActiveObject(): ObjectState | undefined {
  return useStore((s) => getActiveObject(s.project, s.selectedObjectIndex))
}
