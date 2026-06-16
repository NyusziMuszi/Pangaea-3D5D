import { useStore } from "../state/store";
import { defaultProject } from "../state/defaults";
import type { Project } from "../types";

export function TopBar({
  onOpenExport,
}: {
  onOpenExport: () => void;
}): JSX.Element {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const selectEffect = useStore((s) => s.selectEffect);
  const selectSegment = useStore((s) => s.selectSegment);
  const setToast = useStore((s) => s.setToast);

  function newProject(): void {
    setProject(defaultProject());
    selectEffect(null);
    selectSegment(null);
    setToast("New project");
  }

  async function save(): Promise<void> {
    const path = await window.api.saveFileDialog({
      defaultName: "project.pangaea",
      filters: [{ name: "Pangaea Project", extensions: ["pangaea"] }],
    });
    if (!path) return;
    const bytes = new TextEncoder().encode(JSON.stringify(project, null, 2));
    await window.api.writeFile(path, bytes);
    setToast("Project saved");
  }

  async function open(): Promise<void> {
    const file = await window.api.openProjectFile();
    if (!file) return;
    try {
      const text = new TextDecoder().decode(file.data);
      const parsed = JSON.parse(text) as Project;
      setProject(parsed);
      selectEffect(null);
      selectSegment(null);
      setToast("Project loaded");
    } catch {
      setToast("Could not read project file");
    }
  }

  return (
    <div className="topbar">
      <button onClick={newProject}>New</button>
      <button onClick={open}>Open</button>
      <button onClick={save}>Save</button>
      <button onClick={onOpenExport}>Export</button>
    </div>
  );
}
