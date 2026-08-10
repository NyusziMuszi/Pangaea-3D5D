import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { engine } from "../engine/engineSingleton";
import { totalDuration } from "../types";
import { defaultFilename } from "../state/filename";
import { exportVideo, type ExportProgress } from "../engine/export/exporter";
import { setPngDpi } from "../engine/export/pngDpi";
import { getPrefs } from "../state/prefs";
import { Modal } from "./Modal";

const QUALITY = {
  Standard: 10_000_000,
  High: 18_000_000,
  Max: 28_000_000,
} as const;

type Format = "mp4" | "png";

export function ExportDialog({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  const project = useStore((s) => s.project);
  const [format, setFormat] = useState<Format>("mp4");
  const [fps, setFps] = useState(project.output.fps);
  const [duration, setDuration] = useState(
    Number(totalDuration(project).toFixed(2)),
  );
  const [quality, setQuality] = useState<keyof typeof QUALITY>("High");
  const [pngWidth, setPngWidth] = useState(project.output.width * 4);
  const [pngDpi, setPngDpiValue] = useState(300);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const pngHeight = Math.round(
    (pngWidth * project.output.height) / project.output.width,
  );
  const pngWidthMm = (pngWidth / pngDpi) * 25.4;
  const pngHeightMm = (pngHeight / pngDpi) * 25.4;

  async function runVideo(): Promise<void> {
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
      getPrefs().recordExport(project, useStore.getState().lastLuckyColorScheme);
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

  async function runStill(): Promise<void> {
    const path = await window.api.saveFileDialog({
      defaultName: defaultFilename("png"),
      filters: [{ name: "PNG Image", extensions: ["png"] }],
    });
    if (!path) return;

    engine.pause();
    setBusy(true);
    setStatus("Rendering frame…");
    try {
      const bytes = await engine.captureStill(pngWidth, pngHeight);
      await window.api.writeFile(path, setPngDpi(bytes, pngDpi));
      setStatus(`Done — saved to ${path}`);
      setDone(true);
    } catch (e) {
      setStatus(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const run = format === "mp4" ? runVideo : runStill;

  const pct = progress
    ? Math.round((progress.frame / progress.totalFrames) * 100)
    : 0;

  return (
    <Modal
      onClose={() => !busy && onClose()}
      modalClassName="export-dialog"
      head={
        <>
          <h3>Export {format === "mp4" ? "video" : "still frame"}</h3>
          <span className="spacer" />
        </>
      }
      foot={
        busy ? (
          <button onClick={() => abortRef.current?.abort()}>Cancel</button>
        ) : done ? (
          <button className="important" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button onClick={onClose}>Cancel</button>
            <button className="important" onClick={run}>
              Choose location & export
            </button>
          </>
        )
      }
    >
      <div className="export-body">
        <label className="field">
          <span className="field-label">Format</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as Format)}
          >
            <option value="mp4">MP4 video</option>
            <option value="png">Still frame (PNG, transparent)</option>
          </select>
        </label>

        {format === "mp4" ? (
          <>
            <label className="field">
              <span className="field-label">Resolution</span>
              <span className="readonly">
                {project.output.width}×{project.output.height}
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
                onChange={(e) =>
                  setDuration(parseFloat(e.target.value || "1"))
                }
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
          </>
        ) : (
          <>
            <label className="field">
              <span className="field-label">Width (px)</span>
              <input
                type="number"
                min={100}
                max={20000}
                step={10}
                value={pngWidth}
                onChange={(e) =>
                  setPngWidth(parseInt(e.target.value, 10) || 1)
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Height (px)</span>
              <span className="readonly">{pngHeight}</span>
            </label>
            <label className="field">
              <span className="field-label">DPI</span>
              <input
                type="number"
                min={72}
                max={1200}
                step={1}
                value={pngDpi}
                onChange={(e) =>
                  setPngDpiValue(parseInt(e.target.value, 10) || 1)
                }
              />
            </label>

            <div className="export-summary">
              PNG · transparent background · {pngWidth}×{pngHeight} ·{" "}
              {pngDpi}dpi (≈ {pngWidthMm.toFixed(0)}×{pngHeightMm.toFixed(0)}
              mm)
            </div>
          </>
        )}

        {busy && progress && (
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
    </Modal>
  );
}
