import { type ReactNode } from "react";
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

// Lucide icons (github.com/lucide-icons/lucide), inlined so their
// stroke="currentColor" tracks each button's actual text colour.
function Icon({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

function FilePlusIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M9 15h6" />
      <path d="M12 18v-6" />
    </Icon>
  );
}

function FolderOpenIcon(): JSX.Element {
  return (
    <Icon>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </Icon>
  );
}

function SaveIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </Icon>
  );
}

function DownloadIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </Icon>
  );
}

function FileOutputIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4.226 20.925A2 2 0 0 0 6 22h12a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.127" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="m5 11-3 3" />
      <path d="m5 17-3-3h10" />
    </Icon>
  );
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
      <button className="btn-with-icon" onClick={onOpenPreferences}>
        <SettingsIcon />
        Preferences
      </button>
      <button className="btn-with-icon" onClick={newProject}>
        <FilePlusIcon />
        New
      </button>
      <button className="btn-with-icon" onClick={open}>
        <FolderOpenIcon />
        Open
      </button>
      <button className="btn-with-icon" onClick={save}>
        {window.api.canPickSaveLocation ? <SaveIcon /> : <DownloadIcon />}
        {window.api.canPickSaveLocation ? "Save" : "Download"}
      </button>
      <button className="important btn-with-icon" onClick={onOpenExport}>
        <FileOutputIcon />
        Export
      </button>
    </div>
  );
}
