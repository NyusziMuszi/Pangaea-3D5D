import { create } from 'zustand'
import type { Project } from '../types'
import { defaultProject } from './defaults'

interface AppState {
  project: Project
  selectedEffectId: string | null
  selectedSegmentId: string | null
  // Which object the inspector edits: 0 = primary, 1 = optional second object.
  selectedObjectIndex: 0 | 1
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
  selectObject: (index: 0 | 1) => void
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
