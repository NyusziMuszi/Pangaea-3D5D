import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { engine } from "../engine/engineSingleton";
import { totalDuration } from "../types";
import { defaultFilename } from "../state/filename";
import { exportVideo, type ExportProgress } from "../engine/export/exporter";

const QUALITY = {
  Standard: 10_000_000,
  High: 18_000_000,
  Max: 28_000_000,
} as const;

export function ExportDialog({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  const project = useStore((s) => s.project);
  const [fps, setFps] = useState(project.output.fps);
  const [duration, setDuration] = useState(
    Number(totalDuration(project).toFixed(2)),
  );
  const [quality, setQuality] = useState<keyof typeof QUALITY>("High");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function run(): Promise<void> {
    const path = await window.api.saveFileDialog({
      defaultName: defaultFilename("mp4"),
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });
    if (!path) return;

    engine.pause();
    setBusy(true);
    setStatus("Rendering frames…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { encoder } = await exportVideo(
        engine,
        project,
        { fps, durationSec: duration, bitrate: QUALITY[quality] },
        path,
        (p) => setProgress(p),
        controller.signal,
      );
      setStatus(`Done — exported with ${encoder}. Saved to ${path}`);
      setDone(true);
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") setStatus("Cancelled.");
      else setStatus(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
      // restore the live preview frame
      engine.setOutputSize(project.output.width, project.output.height);
      engine.renderFrame(engine.getPlayhead());
    }
  }

  const pct = progress
    ? Math.round((progress.frame / progress.totalFrames) * 100)
    : 0;

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Export video</h3>
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="export-body">
          <label className="field">
            <span className="field-label">Resolution</span>
            <span className="readonly">
              {project.output.width}×{project.output.height} (Instagram
              portrait)
            </span>
          </label>
          <label className="field">
            <span className="field-label">Frame rate</span>
            <select
              value={fps}
              onChange={(e) => setFps(parseInt(e.target.value, 10))}
            >
              <option value={24}>24 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Duration (s)</span>
            <input
              type="number"
              min={0.5}
              max={120}
              step={0.5}
              value={duration}
              onChange={(e) => setDuration(parseFloat(e.target.value || "1"))}
            />
          </label>
          <label className="field">
            <span className="field-label">Quality</span>
            <select
              value={quality}
              onChange={(e) =>
                setQuality(e.target.value as keyof typeof QUALITY)
              }
            >
              {Object.keys(QUALITY).map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>

          <div className="export-summary">
            {Math.round(duration * fps)} frames · H.264 MP4
          </div>

          {busy && (
            <div className="progress">
              <div className="bar">
                <div className="fill" style={{ width: `${pct}%` }} />
              </div>
              <span>
                {pct}% ({progress?.frame ?? 0}/{progress?.totalFrames ?? 0})
              </span>
            </div>
          )}
          {status && <p className="status">{status}</p>}
        </div>

        <div className="modal-foot">
          {busy ? (
            <button onClick={() => abortRef.current?.abort()}>Cancel</button>
          ) : done ? (
            <button className="important" onClick={onClose}>
              Done
            </button>
          ) : (
            <button className="important" onClick={run}>
              Choose location & export
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
