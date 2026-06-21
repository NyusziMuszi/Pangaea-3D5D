import { useStore } from "../state/store";
import { defaultProject } from "../state/defaults";
import type { Project } from "../types";
import { defaultFilename } from "../state/filename";

export function ProjectActions({
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
      defaultName: defaultFilename("pangaea"),
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
    <div className="project-actions">
      <button className="important" onClick={newProject}>
        New
      </button>
      <button className="important" onClick={open}>
        Open
      </button>
      <button className="important" onClick={save}>
        Save
      </button>
      <button className="important" onClick={onOpenExport}>
        Export
      </button>
    </div>
  );
}
