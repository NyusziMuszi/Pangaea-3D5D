import { type CSSProperties } from "react";
import { useStore } from "../state/store";
import { engine } from "../engine/engineSingleton";
import { findEffectDef } from "../engine/effects/catalog";
import { objectLabel, totalDuration } from "../types";

function fmt(t: number): string {
  const s = Math.floor(t);
  const cs = Math.floor((t - s) * 100);
  return `${s}.${String(cs).padStart(2, "0")}s`;
}

export function TimelinePanel(): JSX.Element {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const selectedEffectId = useStore((s) => s.selectedEffectId);
  const selectedObjectIndex = useStore((s) => s.selectedObjectIndex);
  const selectSegment = useStore((s) => s.selectSegment);
  const selectEffect = useStore((s) => s.selectEffect);
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
  const objectActive = !selectedSegmentId && !selectedEffectId;

  function selectOnly(id: string): void {
    selectSegment(id);
    selectEffect(null);
  }

  // Select an object block (clearing any segment/effect selection) so the
  // inspector edits that object's transform.
  function selectObjectOnly(index: 0 | 1): void {
    selectObject(index);
    selectSegment(null);
    selectEffect(null);
  }

  function removeSecondObject(): void {
    update((p) => {
      p.object2 = null;
    });
    selectObjectOnly(0);
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

  function moveEffect(index: number, dir: -1 | 1): void {
    const j = index + dir;
    if (j < 0 || j >= project.effects.length) return;
    update((p) => {
      const arr = p.effects;
      [arr[index], arr[j]] = [arr[j], arr[index]];
    });
  }

  return (
    <div className="timeline">
      <div className="timeline-section">
        <div className="tl-tracks">
          <div className="tl-row tl-scrub-row">
            <div className="tl-row-label">
              <button className="play" onClick={togglePlay}>
                {playing ? "⏸" : "▶"}
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
                    className={`segment ${isText ? "text" : "break"} ${selectedSegmentId === seg.id ? "sel" : ""}`}
                    style={{
                      left: pct(starts[i]),
                      width: pct(seg.durationSec),
                    }}
                    onClick={() => selectOnly(seg.id)}
                  >
                    <span className="segment-label">
                      {isText ? "Text" : "Break"}
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
                className={`segment object ${objectActive && selectedObjectIndex === 0 ? "sel" : ""}`}
                onClick={() => selectObjectOnly(0)}
              >
                <div className="object-head">
                  <span className="segment-label">
                    {objectLabel(project.object)}
                  </span>
                  <span className="segment-dur">{total.toFixed(1)}s</span>
                </div>
                {project.effects.length === 0 ? (
                  <p className="fx-empty">
                    No effects. Add deformers/shaders from the Library.
                  </p>
                ) : (
                  <div className="fx-stack">
                    {project.effects.map((inst, i) => {
                      const def = findEffectDef(
                        inst.defId,
                        project.customEffects,
                      );
                      return (
                        <div
                          key={inst.instanceId}
                          className={`fx-row ${selectedEffectId === inst.instanceId ? "sel" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectEffect(inst.instanceId);
                            selectSegment(null);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={inst.enabled}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              update((p) => {
                                const t = p.effects.find(
                                  (x) => x.instanceId === inst.instanceId,
                                );
                                if (t) t.enabled = e.target.checked;
                              })
                            }
                          />
                          <span className="fx-name">
                            {def?.name ?? inst.defId}
                          </span>
                          <span className="spacer" />
                          <button
                            className="mini"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveEffect(i, -1);
                            }}
                          >
                            ↑
                          </button>
                          <button
                            className="mini"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveEffect(i, 1);
                            }}
                          >
                            ↓
                          </button>
                          <button
                            className="mini"
                            onClick={(e) => {
                              e.stopPropagation();
                              update((p) => {
                                p.effects = p.effects.filter(
                                  (x) => x.instanceId !== inst.instanceId,
                                );
                              });
                              if (selectedEffectId === inst.instanceId)
                                selectEffect(null);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {project.object2 && (
                <div
                  className={`segment object object-2 ${objectActive && selectedObjectIndex === 1 ? "sel" : ""}`}
                  onClick={() => selectObjectOnly(1)}
                >
                  <div className="object-head">
                    <span className="segment-label">
                      {objectLabel(project.object2)}
                    </span>
                    <button
                      className="mini"
                      title="Remove second object"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSecondObject();
                      }}
                    >
                      ✕
                    </button>
                  </div>
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
