import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { engine } from "../engine/engineSingleton";
import {
  totalDuration,
  SURFACE_COLOR_LIGHT_DEFAULT,
  SURFACE_COLOR_LOW_DEFAULT,
  type ObjectSurface,
} from "../types";
import { defaultFilename, defaultStem } from "../state/filename";
import { exportVideo, type ExportProgress } from "../engine/export/exporter";
import { setPngDpi } from "../engine/export/pngDpi";
import { getPrefs } from "../state/prefs";
import { FLAT_SURFACES } from "../state/taste";
import { FLAT_SURFACE_OPTIONS } from "./objectOptions";
import { Modal } from "./Modal";

const QUALITY = {
  Standard: 10_000_000,
  High: 18_000_000,
  Max: 28_000_000,
} as const;

type Format = "mp4" | "png" | "sequence";

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
  const [seqStart, setSeqStart] = useState(
    Number(engine.getPlayhead().toFixed(2)),
  );
  const [seqCount, setSeqCount] = useState(6);
  const [seqSpacing, setSeqSpacing] = useState(0.4);
  const [seqSurfaces, setSeqSurfaces] = useState<Set<ObjectSurface>>(
    () => new Set(FLAT_SURFACES),
  );
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [seqProgress, setSeqProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const pngHeight = Math.round(
    (pngWidth * project.output.height) / project.output.width,
  );
  const pngWidthMm = (pngWidth / pngDpi) * 25.4;
  const pngHeightMm = (pngHeight / pngDpi) * 25.4;

  const seqTimes = Array.from(
    { length: seqCount },
    (_, i) => seqStart + i * seqSpacing,
  );
  const seqSurfaceList = FLAT_SURFACES.filter((s) => seqSurfaces.has(s));
  const seqTotalFiles = seqTimes.length * seqSurfaceList.length;
  const seqExceedsDuration =
    seqTimes.length > 0 &&
    seqTimes[seqTimes.length - 1] > totalDuration(project);
  const seqObject = project.objects[0];

  function toggleSeqSurface(s: ObjectSurface): void {
    setSeqSurfaces((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

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

  async function runSequence(): Promise<void> {
    const dir = await window.api.openDirectoryDialog();
    if (!dir) return;

    engine.pause();
    setBusy(true);
    setStatus("Rendering frames…");
    const controller = new AbortController();
    abortRef.current = controller;
    const stem = defaultStem();
    const total = seqTotalFiles;
    let doneCount = 0;
    setSeqProgress({ done: 0, total });
    try {
      for (const surface of seqSurfaceList) {
        for (let i = 0; i < seqTimes.length; i++) {
          if (controller.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          const bytes = await engine.captureStillAt(
            seqTimes[i],
            pngWidth,
            pngHeight,
            surface,
          );
          const name = `${stem}-${surface}-${String(i + 1).padStart(2, "0")}.png`;
          await window.api.writeFile(`${dir}/${name}`, setPngDpi(bytes, pngDpi));
          doneCount++;
          setSeqProgress({ done: doneCount, total });
        }
      }
      setStatus(`Done — exported ${total} files to ${dir}`);
      setDone(true);
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") setStatus("Cancelled.");
      else setStatus(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
      engine.setOutputSize(project.output.width, project.output.height);
      engine.renderFrame(engine.getPlayhead());
    }
  }

  const run =
    format === "mp4" ? runVideo : format === "png" ? runStill : runSequence;

  const pct = progress
    ? Math.round((progress.frame / progress.totalFrames) * 100)
    : 0;

  return (
    <Modal
      onClose={() => !busy && onClose()}
      modalClassName="export-dialog"
      head={
        <>
          <h3>
            Export{" "}
            {format === "mp4"
              ? "video"
              : format === "png"
                ? "still frame"
                : "image sequence"}
          </h3>
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
            <button
              className="important"
              onClick={run}
              disabled={format === "sequence" && seqTotalFiles === 0}
            >
              {format === "sequence"
                ? "Choose folder & export"
                : "Choose location & export"}
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
            <option value="sequence">
              Image sequence (PNG, transparent)
            </option>
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

            {format === "sequence" && (
              <>
                <label className="field">
                  <span className="field-label">Start time (s)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={seqStart}
                    onChange={(e) =>
                      setSeqStart(parseFloat(e.target.value || "0"))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field-label">Frame count</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={seqCount}
                    onChange={(e) =>
                      setSeqCount(parseInt(e.target.value, 10) || 1)
                    }
                  />
                </label>
                <label className="field">
                  <span className="field-label">Spacing (s)</span>
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={seqSpacing}
                    onChange={(e) =>
                      setSeqSpacing(parseFloat(e.target.value || "0.01"))
                    }
                  />
                </label>

                <div className="export-summary">
                  Times: {seqTimes.map((t) => t.toFixed(2)).join(", ")}
                  {seqExceedsDuration && (
                    <>
                      {" "}
                      · ⚠ past end of timeline (
                      {totalDuration(project).toFixed(2)}s)
                    </>
                  )}
                </div>

                <div className="field">
                  <span className="field-label">Surfaces</span>
                  <div className="export-surfaces">
                    {FLAT_SURFACE_OPTIONS.map((o) => (
                      <label key={o.value} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={seqSurfaces.has(o.value)}
                          onChange={() => toggleSeqSurface(o.value)}
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="export-summary">
                  Surface look comes from{" "}
                  {seqObject ? "Object 1" : "the object"}&rsquo;s Inspector
                  settings — colour{" "}
                  <span className="readonly">
                    {seqObject?.surfaceColor ?? "#878787"}
                  </span>
                  , line weight{" "}
                  <span className="readonly">
                    {seqObject?.surfaceWireWidth ?? 1.5}
                  </span>
                  , facet light{" "}
                  <span className="readonly">
                    {seqObject?.surfaceColorLight ?? SURFACE_COLOR_LIGHT_DEFAULT}
                  </span>
                  , depth low{" "}
                  <span className="readonly">
                    {seqObject?.surfaceColorLow ?? SURFACE_COLOR_LOW_DEFAULT}
                  </span>{" "}
                  / range{" "}
                  <span className="readonly">
                    {seqObject?.depthRange ?? 0.5}
                  </span>
                  . Edit these in the Inspector.
                </div>
              </>
            )}

            <div className="export-summary">
              {format === "sequence"
                ? `${seqTotalFiles} files · ${seqTimes.length} frames × ${seqSurfaceList.length} surfaces · ${pngWidth}×${pngHeight} · transparent`
                : `PNG · transparent background · ${pngWidth}×${pngHeight} · ${pngDpi}dpi (≈ ${pngWidthMm.toFixed(0)}×${pngHeightMm.toFixed(0)}mm)`}
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
        {busy && seqProgress && (
          <div className="progress">
            <div className="bar">
              <div
                className="fill"
                style={{
                  width: `${Math.round((seqProgress.done / seqProgress.total) * 100)}%`,
                }}
              />
            </div>
            <span>
              {seqProgress.done}/{seqProgress.total}
            </span>
          </div>
        )}
        {status && <p className="status">{status}</p>}
      </div>
    </Modal>
  );
}
