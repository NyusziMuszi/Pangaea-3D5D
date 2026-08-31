import { useStore } from "../state/store";
import { defaultProject } from "../state/defaults";
import { getPrefs, migrateLuckyConfig } from "../state/prefs";
import type { Project } from "../types";
import { defaultFilename } from "../state/filename";
import {
  assetBytes,
  assetMime,
  registerAssetWithId,
} from "../state/assets";
import { base64ToBytes, bytesToBase64 } from "./files";

// On-disk shape: the project plus the bytes of every image asset it references,
// embedded as base64 only at this I/O boundary. The live model keeps just the
// assetIds (state/assets.ts); the bytes never touch the per-edit clone path.
interface SavedFile {
  project: Project;
  assets: Record<string, { mime: string; base64: string }>;
}

// Every distinct image assetId referenced by the project's objects.
function referencedAssetIds(p: Project): string[] {
  const ids = new Set<string>();
  for (const o of p.objects) if (o.image.assetId) ids.add(o.image.assetId);
  return [...ids];
}

export function ProjectActions({
  onOpenExport,
  onOpenPreferences,
}: {
  onOpenExport: () => void;
  onOpenPreferences: () => void;
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
    try {
      const path = await window.api.saveFileDialog({
        defaultName: defaultFilename(project, "pangaea"),
        filters: [{ name: "Pangaea Project", extensions: ["pangaea"] }],
      });
      if (!path) return;
      const assets: SavedFile["assets"] = {};
      for (const id of referencedAssetIds(project)) {
        const bytes = assetBytes(id);
        const mime = assetMime(id);
        if (bytes && mime) assets[id] = { mime, base64: bytesToBase64(bytes) };
      }
      const payload: SavedFile = { project, assets };
      const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
      await window.api.writeFile(path, bytes);
      setToast(
        window.api.canPickSaveLocation ? "Project saved" : "Project downloaded",
      );
      getPrefs().recordSave(project, useStore.getState().lastLuckyColorScheme);
    } catch {
      setToast(
        window.api.canPickSaveLocation
          ? "Could not save project"
          : "Could not download project",
      );
    }
  }

  async function open(): Promise<void> {
    try {
      const file = await window.api.openProjectFile();
      if (!file) return;
      const text = new TextDecoder().decode(file.data);
      const parsed = JSON.parse(text) as SavedFile;
      // Re-register every embedded asset under its saved id *before* setting the
      // project, so the engine resolves each object.image.assetId immediately.
      for (const [id, a] of Object.entries(parsed.assets ?? {})) {
        registerAssetWithId(id, base64ToBytes(a.base64), a.mime);
      }
      setProject({
        ...parsed.project,
        lucky: migrateLuckyConfig(parsed.project.lucky),
      });
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
        {window.api.canPickSaveLocation ? "Save" : "Download"}
      </button>
      <button className="important" onClick={onOpenExport}>
        Export
      </button>
      <button className="important" onClick={onOpenPreferences}>
        Preferences
      </button>
    </div>
  );
}
