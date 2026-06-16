import { useEffect, useState } from 'react'
import { useStore } from './state/store'
import { engine } from './engine/engineSingleton'
import { TopBar } from './ui/TopBar'
import { LibraryPanel } from './ui/LibraryPanel'
import { PreviewPanel } from './ui/PreviewPanel'
import { TimelinePanel } from './ui/TimelinePanel'
import { InspectorPanel } from './ui/InspectorPanel'
import { ShaderEditorModal } from './ui/ShaderEditorModal'
import { ExportDialog } from './ui/ExportDialog'
import { runSelfTest } from './ui/selftest'

export default function App(): JSX.Element {
  const project = useStore((s) => s.project)
  const toast = useStore((s) => s.toast)
  const setToast = useStore((s) => s.setToast)
  const [exportOpen, setExportOpen] = useState(false)

  // Wire engine callbacks once.
  useEffect(() => {
    engine.onTick = (t) => useStore.getState().setPlayhead(t)
    engine.onError = (m) => useStore.getState().setToast(m)
    engine.onShaderError = (m) => useStore.getState().setShaderError(m)
    return () => {
      engine.onTick = null
      engine.onError = null
      engine.onShaderError = null
    }
  }, [])

  // Push project changes into the engine; re-render current frame when paused.
  useEffect(() => {
    engine.setProject(project)
    if (!engine.isPlaying) engine.renderFrame(engine.getPlayhead())
  }, [project])

  // Headless self-test (launched with ?selftest=1) for automated verification.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('selftest')) {
      const id = setTimeout(() => void runSelfTest(), 1200)
      return () => clearTimeout(id)
    }
    return undefined
  }, [])

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(id)
  }, [toast, setToast])

  return (
    <div className="app">
      <div className="workspace">
        <LibraryPanel />
        <div className="center">
          <PreviewPanel />
          <TimelinePanel />
        </div>
        <div className="right-col">
          <TopBar onOpenExport={() => setExportOpen(true)} />
          <InspectorPanel />
        </div>
      </div>
      <ShaderEditorModal />
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
