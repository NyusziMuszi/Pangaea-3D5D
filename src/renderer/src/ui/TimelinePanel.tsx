import { type CSSProperties, useEffect } from "react";
import playIcon from "../assets/play_arrow_24dp_E3E3E3_FILL1_wght400_GRAD0_opsz24.svg";
import pauseIcon from "../assets/pause_24dp_E3E3E3_FILL1_wght400_GRAD0_opsz24.svg";
import { useStore } from "../state/store";
import { engine } from "../engine/engineSingleton";
import { KeyframeTrack, DurationField, ColorSwatch } from "./controls";
import { objectKeyframeChannels } from "./keyframeChannels";
import { isAnimated } from "./scalarUtils";
import {
  objectAccentClass,
  objectLabel,
  objectLetterLabel,
  totalDuration,
  type ObjectState,
  type Scalar,
  type TextStyle,
} from "../types";

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
  // The playhead lines share the inset time axis used by the keyframe strips
  // and the scrub thumb, not the full container width. The kf-track sits inside
  // the object segment's horizontal padding (--space-4), so the axis runs from
  // that inset on the left to its mirror on the right; interpolate within it.
  const playheadLeft = (v: number): string => {
    const f = total > 0 ? v / total : 0;
    return `calc(var(--space-4) + ${f.toFixed(4)} * (100% - 2 * var(--space-4)))`;
  };
  // An object is the active context whenever no segment is selected; selecting
  // an effect from the inspector no longer deactivates it.
  const objectActive = !selectedSegmentId;

  function selectOnly(id: string): void {
    selectSegment(id);
  }

  // Select an object block (clearing any segment selection) so the inspector
  // edits that object's transform + effects.
  function selectObjectOnly(index: number): void {
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

  // Space bar toggles playback, except while typing in a form field.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code !== "Space" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      togglePlay();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function updateObject(
    index: number,
    apply: (o: ObjectState, s: Scalar) => void,
    s: Scalar,
  ): void {
    update((p) => {
      const o = p.objects[index];
      if (o) apply(o, s);
    });
  }

  // One draggable marker strip per animated property, captioned with its
  // section + property name on the shared time scale.
  function renderKeyframes(obj: ObjectState, index: number): JSX.Element {
    const channels = objectKeyframeChannels(obj, project.customEffects).filter(
      (c) => isAnimated(c.scalar),
    );
    if (channels.length === 0) {
      return <p className="fx-empty">No keyframes.</p>;
    }
    return (
      <div className="kf-stack">
        {channels.map((c) => (
          <div className="kf-channel" key={c.key}>
            <KeyframeTrack
              className="tl-kf-track"
              scalar={c.scalar}
              onChange={(s) => updateObject(index, c.apply, s)}
            />
            <div className="kf-channel-label">
              <span className="kf-channel-section">{c.section}</span>
              <span className="kf-channel-prop">{c.property}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="timeline">
      <div className="tl-play">
        <button className="btn-icon play" onClick={togglePlay}>
          <img
            src={playing ? pauseIcon : playIcon}
            alt={playing ? "pause" : "play"}
          />
        </button>
      </div>
      <div className="timeline-section">
        <div className="tl-tracks">
          {/* The scrub bar and the segment track stay pinned to the top of the
              scroll area so they remain visible while the object track (which
              grows tall as keyframes stack) scrolls beneath them. */}
          <div className="tl-sticky-head">
            <div className="tl-row tl-scrub-row">
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
                      {isText && seg.text && (
                        <div className="seg-swatches">
                          {(
                            [
                              [
                                "Background colour",
                                seg.text.backgroundColor,
                                (t, v) => (t.backgroundColor = v),
                              ],
                              [
                                "Text colour",
                                seg.text.textColor,
                                (t, v) => (t.textColor = v),
                              ],

                              [
                                "Object colour",
                                seg.text.textBackdropColor,
                                (t, v) => (t.textBackdropColor = v),
                              ],
                            ] as [
                              string,
                              string,
                              (t: TextStyle, v: string) => void,
                            ][]
                          ).map(([title, value, set]) => (
                            <ColorSwatch
                              key={title}
                              className="seg-swatch"
                              title={title}
                              value={value}
                              onChange={(v) =>
                                update((p) => {
                                  const s = p.segments.find(
                                    (x) => x.id === seg.id,
                                  );
                                  if (s?.text) set(s.text, v);
                                })
                              }
                            />
                          ))}
                        </div>
                      )}
                      {!isText && (
                        <div className="seg-swatches">
                          <ColorSwatch
                            className="seg-swatch"
                            title="Background colour"
                            value={seg.backgroundColor ?? "#281b6c"}
                            onChange={(v) =>
                              update((p) => {
                                const s = p.segments.find((x) => x.id === seg.id);
                                if (s) s.backgroundColor = v;
                              })
                            }
                          />
                        </div>
                      )}
                      <DurationField
                        className="tl-dur-input"
                        wrapInField={false}
                        stopClickPropagation
                        value={seg.durationSec}
                        onChange={(v) =>
                          update((p) => {
                            const s = p.segments.find((x) => x.id === seg.id);
                            if (s) s.durationSec = v;
                          })
                        }
                      />
                    </div>
                  );
                })}
                <div
                  className="tl-playhead"
                  style={{ left: playheadLeft(playhead) }}
                />
              </div>
            </div>
          </div>

          <div className="tl-row">
            <div className="tl-track tl-track-object">
              {project.objects.map((obj, index) => (
                <div
                  key={index}
                  className={`segment object ${index === 0 ? "object-a" : "object-2 " + objectAccentClass(index)} ${objectActive && selectedObjectIndex === index ? "sel" : ""}`}
                  onClick={() => selectObjectOnly(index)}
                >
                  <div className="object-head">
                    <span className="segment-label">
                      Object {objectLetterLabel(index)} — {objectLabel(obj)}
                    </span>
                    {index === 0 && (
                      <span className="segment-dur">{total.toFixed(1)}s</span>
                    )}
                  </div>
                  {renderKeyframes(obj, index)}
                </div>
              ))}
              <div
                className="tl-playhead"
                style={{ left: playheadLeft(playhead) }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
