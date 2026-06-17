import { type CSSProperties } from "react";
import playIcon from "../assets/play_arrow_24dp_E3E3E3_FILL1_wght400_GRAD0_opsz24.svg";
import pauseIcon from "../assets/pause_24dp_E3E3E3_FILL1_wght400_GRAD0_opsz24.svg";
import { useStore } from "../state/store";
import { engine } from "../engine/engineSingleton";
import { findEffectDef } from "../engine/effects/catalog";
import { totalDuration, type ObjectState } from "../types";

function fmt(t: number): string {
  const s = Math.floor(t);
  const cs = Math.floor((t - s) * 100);
  return `${s}.${String(cs).padStart(2, "0")}s`;
}

export function TimelinePanel(): JSX.Element {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const selectedObjectIndex = useStore((s) => s.selectedObjectIndex);
  const selectSegment = useStore((s) => s.selectSegment);
  const selectObject = useStore((s) => s.selectObject);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const playhead = useStore((s) => s.playhead);
  const total = totalDuration(project) || 1;

  // Cumulative start time of each segment, so blocks can be positioned
  // faithfully to time on a shared horizontal scale across both tracks.
  const starts: number[] = [];
  let acc = 0;
  for (const seg of project.segments) {
    starts.push(acc);
    acc += seg.durationSec;
  }
  const pct = (v: number): string => `${(v / total) * 100}%`;
  // An object is the active context whenever no segment is selected; selecting
  // an effect from the inspector no longer deactivates it.
  const objectActive = !selectedSegmentId;

  function selectOnly(id: string): void {
    selectSegment(id);
  }

  // Select an object block (clearing any segment selection) so the inspector
  // edits that object's transform + effects.
  function selectObjectOnly(index: 0 | 1): void {
    selectObject(index);
    selectSegment(null);
  }

  function togglePlay(): void {
    if (engine.isPlaying) {
      engine.pause();
      setPlaying(false);
    } else {
      engine.play();
      setPlaying(true);
    }
  }

  // Read-only effect labels for an object. Editing (reorder/toggle/delete and
  // per-effect uniforms) lives in the inspector now.
  function renderEffects(obj: ObjectState): JSX.Element {
    if (obj.effects.length === 0) {
      return (
        <p className="fx-empty">
          No effects. Add deformers/shaders from the Library.
        </p>
      );
    }
    return (
      <div className="fx-stack">
        {obj.effects.map((inst) => {
          const def = findEffectDef(inst.defId, project.customEffects);
          return (
            <div
              key={inst.instanceId}
              className={`fx-row read-only ${inst.enabled ? "" : "fx-disabled"}`}
            >
              <span className="fx-name">{def?.name ?? inst.defId}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="timeline">
      <div className="timeline-section">
        <div className="tl-tracks">
          <div className="tl-row tl-scrub-row">
            <div className="tl-row-label">
              <button className="btn-icon play" onClick={togglePlay}>
                <img
                  src={playing ? pauseIcon : playIcon}
                  alt={playing ? "pause" : "play"}
                />
              </button>
            </div>
            <div className="tl-scrub-area">
              <div className="tl-time">
                {fmt(playhead)} / {fmt(total)}
              </div>
              <input
                className="scrub"
                type="range"
                min={0}
                max={total}
                step={1 / 120}
                value={playhead}
                style={
                  {
                    ["--slider-pct" as string]: `${
                      total > 0 ? (playhead / total) * 100 : 0
                    }%`,
                  } as CSSProperties
                }
                onChange={(e) => {
                  if (engine.isPlaying) {
                    engine.pause();
                    setPlaying(false);
                  }
                  engine.seekTo(parseFloat(e.target.value));
                }}
              />
            </div>
          </div>

          <div className="tl-row">
            <div className="tl-row-label">Text</div>
            <div className="tl-track">
              {project.segments.map((seg, i) => {
                const isText = seg.kind === "text";
                return (
                  <div
                    key={seg.id}
                    className={`segment ${isText ? "text id-text" : "break"} ${selectedSegmentId === seg.id ? "sel" : ""}`}
                    style={{
                      left: pct(starts[i]),
                      width: pct(seg.durationSec),
                    }}
                    onClick={() => selectOnly(seg.id)}
                  >
                    <span className="segment-label">
                      {isText ? "Text" : "—"}
                    </span>
                    <input
                      type="number"
                      className="tl-dur-input"
                      min={0.2}
                      max={20}
                      step={0.1}
                      value={seg.durationSec}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        update((p) => {
                          const s = p.segments.find((x) => x.id === seg.id);
                          if (s)
                            s.durationSec = Math.max(
                              0.2,
                              parseFloat(e.target.value || "1"),
                            );
                        })
                      }
                    />
                  </div>
                );
              })}
              <div className="tl-playhead" style={{ left: pct(playhead) }} />
            </div>
          </div>

          <div className="tl-row">
            <div className="tl-row-label">Object</div>
            <div className="tl-track tl-track-object">
              <div
                className={`segment object object-a ${objectActive && selectedObjectIndex === 0 ? "sel" : ""}`}
                onClick={() => selectObjectOnly(0)}
              >
                <div className="object-head">
                  <span className="segment-label">Object A</span>
                  <span className="segment-dur">{total.toFixed(1)}s</span>
                </div>
                {renderEffects(project.object)}
              </div>
              {project.object2 && (
                <div
                  className={`segment object object-2 object-b ${objectActive && selectedObjectIndex === 1 ? "sel" : ""}`}
                  onClick={() => selectObjectOnly(1)}
                >
                  <div className="object-head">
                    <span className="segment-label">Object B</span>
                  </div>
                  {renderEffects(project.object2)}
                </div>
              )}
              <div className="tl-playhead" style={{ left: pct(playhead) }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
