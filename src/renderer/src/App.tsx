import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "./state/store";
import { engine } from "./engine/engineSingleton";
import { ProjectActions } from "./ui/ProjectActions";
import { LibraryPanel } from "./ui/LibraryPanel";
import { PreviewPanel } from "./ui/PreviewPanel";
import { TimelinePanel } from "./ui/TimelinePanel";
import { InspectorPanel } from "./ui/InspectorPanel";
import { ShaderEditorModal } from "./ui/ShaderEditorModal";
import { ExportDialog } from "./ui/ExportDialog";
import { runSelfTest } from "./ui/selftest";

export default function App(): JSX.Element {
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);
  const [exportOpen, setExportOpen] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(240);
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef<number>(240);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      dragStartY.current = e.clientY;
      dragStartH.current = timelineHeight;

      const onMove = (ev: MouseEvent): void => {
        if (dragStartY.current === null) return;
        const delta = dragStartY.current - ev.clientY;
        const next = Math.max(
          80,
          Math.min(window.innerHeight * 0.75, dragStartH.current + delta),
        );
        setTimelineHeight(next);
      };
      const onUp = (): void => {
        dragStartY.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [timelineHeight],
  );

  // Wire engine callbacks once.
  useEffect(() => {
    // The engine renders at 60fps; pushing every tick into the store would
    // re-render the timeline/inspector each frame and compete with the engine.
    // Throttle store updates during playback (the playhead indicator + live
    // slider values stay responsive at ~12fps); seeks while paused push
    // immediately so scrubbing feels exact.
    let lastPush = 0;
    engine.onTick = (t) => {
      const now = performance.now();
      if (engine.isPlaying && now - lastPush < 80) return;
      lastPush = now;
      useStore.getState().setPlayhead(t);
    };
    engine.onError = (m) => useStore.getState().setToast(m);
    engine.onShaderError = (m) => useStore.getState().setShaderError(m);
    return () => {
      engine.onTick = null;
      engine.onError = null;
      engine.onShaderError = null;
    };
  }, []);

  // Push project changes into the engine; re-render current frame when paused.
  useEffect(() => {
    engine.setProject(project);
    if (!engine.isPlaying) engine.renderFrame(engine.getPlayhead());
  }, [project]);

  // Headless self-test (launched with ?selftest=1) for automated verification.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("selftest")) {
      const id = setTimeout(() => void runSelfTest(), 1200);
      return () => clearTimeout(id);
    }
    return undefined;
  }, []);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast, setToast]);

  return (
    <div className="app">
      <div
        className={`workspace ${libraryCollapsed ? "library-collapsed" : ""} ${
          inspectorCollapsed ? "inspector-collapsed" : ""
        }`}
      >
        <LibraryPanel
          collapsed={libraryCollapsed}
          onToggleCollapse={() => setLibraryCollapsed((c) => !c)}
        />
        <div
          className="center"
          style={
            {
              "--timeline-height": `${timelineHeight}px`,
            } as React.CSSProperties
          }
        >
          <PreviewPanel />
          <div className="timeline-resize-handle" onMouseDown={startResize} />
          <TimelinePanel />
        </div>
        <div className="right-col">
          <ProjectActions onOpenExport={() => setExportOpen(true)} />
          <InspectorPanel
            collapsed={inspectorCollapsed}
            onToggleCollapse={() => setInspectorCollapsed((c) => !c)}
          />
        </div>
      </div>
      <ShaderEditorModal />
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
