import { useStore } from '../state/store'
import { defaultProject } from '../state/defaults'
import type { Project } from '../types'

export function TopBar({ onOpenExport }: { onOpenExport: () => void }): JSX.Element {
  const project = useStore((s) => s.project)
  const setProject = useStore((s) => s.setProject)
  const selectEffect = useStore((s) => s.selectEffect)
  const selectSegment = useStore((s) => s.selectSegment)
  const setToast = useStore((s) => s.setToast)

  function newProject(): void {
    setProject(defaultProject())
    selectEffect(null)
    selectSegment(null)
    setToast('New project')
  }

  function resetToDefault(): void {
    const fresh = defaultProject()

    // Preserve scene background colour
    fresh.scene.backgroundColor = project.scene.backgroundColor

    // Preserve the uploaded image asset (pan offsets reset to default centre)
    fresh.image.name = project.image.name
    fresh.image.dataUrl = project.image.dataUrl

    // Preserve the subject choice (mode / primitive / loaded model).
    // Transforms (rot, scale) and particle controls reset to default.
    fresh.subject.mode = project.subject.mode
    fresh.subject.primitive = project.subject.primitive
    fresh.subject.modelName = project.subject.modelName
    fresh.subject.modelDataUrl = project.subject.modelDataUrl

    // Preserve the typed words, mapped onto the default text segments in order.
    const typed = project.segments
      .filter((s) => s.kind === 'text' && s.text)
      .map((s) => s.text!.content)
    let i = 0
    for (const seg of fresh.segments) {
      if (seg.kind === 'text' && seg.text && i < typed.length) {
        seg.text.content = typed[i++]
      }
    }

    setProject(fresh)
    selectEffect(null)
    selectSegment(null)
    setToast('Reset to default')
  }

  async function save(): Promise<void> {
    const path = await window.api.saveFileDialog({
      defaultName: 'project.pangaea',
      filters: [{ name: 'Pangaea Project', extensions: ['pangaea'] }]
    })
    if (!path) return
    const bytes = new TextEncoder().encode(JSON.stringify(project, null, 2))
    await window.api.writeFile(path, bytes)
    setToast('Project saved')
  }

  async function open(): Promise<void> {
    const file = await window.api.openProjectFile()
    if (!file) return
    try {
      const text = new TextDecoder().decode(file.data)
      const parsed = JSON.parse(text) as Project
      setProject(parsed)
      selectEffect(null)
      selectSegment(null)
      setToast('Project loaded')
    } catch {
      setToast('Could not read project file')
    }
  }

  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">◓</span> Pangaea
      </div>
      <span className="spacer" />
      <button onClick={newProject}>New</button>
      <button onClick={open}>Open…</button>
      <button onClick={save}>Save…</button>
      <button onClick={resetToDefault}>Reset to default</button>
      <button className="primary" onClick={onOpenExport}>
        Export ▸
      </button>
    </div>
  )
}
