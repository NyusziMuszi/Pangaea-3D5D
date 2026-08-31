import { type CSSProperties, useEffect, useState } from "react";
import playIcon from "../assets/play_arrow_24dp_E3E3E3_FILL1_wght400_GRAD0_opsz24.svg";
import pauseIcon from "../assets/pause_24dp_E3E3E3_FILL1_wght400_GRAD0_opsz24.svg";
import { useStore } from "../state/store";
import { defaultSecondObject } from "../state/defaults";
import { engine } from "../engine/engineSingleton";
import { KeyframeTrack, DurationField, ColorSwatch } from "./controls";
import { accentVars, objectAccentColor } from "./accent";
import { objectKeyframeChannels } from "./keyframeChannels";
import { PRIMITIVE_OPTIONS, SURFACE_OPTIONS } from "./objectOptions";
import { bytesToDataUrl, mimeForName } from "./files";
import { isAnimated } from "./scalarUtils";
import {
  totalDuration,
  type ObjectState,
  type ObjectSurface,
  type PrimitiveModel,
  type Project,
  type Scalar,
  type TextBackdrop,
  type TextBlendMode,
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

  // Swatches across segments/objects can be Shift-clicked into a group so one
  // colour edit applies to all of them at once; ephemeral UI state, not part
  // of the serializable Project.
  const [groupKeys, setGroupKeys] = useState<Set<string>>(new Set());
  // Rebuilt every render so keys + mutators always match what's on screen.
  const swatchMutators = new Map<string, (p: Project, v: string) => void>();

  function toggleGroup(key: string): void {
    setGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // onChange handler shared by every timeline swatch: a swatch that belongs to
  // a group of 2+ applies the change to the whole group; otherwise it edits
  // only itself and collapses the group down to just that swatch (today's
  // plain-click behaviour).
  function applyColor(key: string, v: string): void {
    const keys =
      groupKeys.has(key) && groupKeys.size > 1 ? [...groupKeys] : [key];
    if (keys.length === 1) setGroupKeys(new Set(keys));
    update((p) => {
      for (const k of keys) swatchMutators.get(k)?.(p, v);
    });
  }

  // Same multi-select mechanic for text-segment dropdowns (textBackdrop,
  // textBlend). Shift-clicking a select prevents it from opening and instead
  // toggles its group membership; changing any grouped select applies to all.
  const [dropdownGroupKeys, setDropdownGroupKeys] = useState<Set<string>>(
    new Set(),
  );
  const dropdownMutators = new Map<string, (p: Project, v: string) => void>();

  function toggleDropdownGroup(key: string): void {
    setDropdownGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyDropdown(key: string, v: string): void {
    const keys =
      dropdownGroupKeys.has(key) && dropdownGroupKeys.size > 1
        ? [...dropdownGroupKeys]
        : [key];
    if (keys.length === 1) setDropdownGroupKeys(new Set(keys));
    update((p) => {
      for (const k of keys) dropdownMutators.get(k)?.(p, v);
    });
  }

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

  // Append a new object (the optional second object) and focus it so the
  // inspector edits its shape/transform straight away. The scene caps at two
  // objects, so the button only shows while there is room.
  function addObject(): void {
    const at = project.objects.length;
    update((p) => {
      p.objects.push(defaultSecondObject());
    });
    selectObject(at);
    selectSegment(null);
  }

  // Mirror the inspector's Type dropdown for an object in the timeline head.
  // "none" removes the object (selection falls back to the first); "bespoke"
  // opens the model importer; a real type swaps the primitive and drops any
  // imported model.
  function setObjectType(index: number, value: string): void {
    if (value === "none") {
      update((p) => {
        p.objects.splice(index, 1);
      });
      selectObject(0);
      return;
    }
    if (value === "bespoke") {
      void importModelFor(index);
      return;
    }
    update((p) => {
      const o = p.objects[index];
      if (o) {
        o.primitive = value as PrimitiveModel;
        o.modelDataUrl = null;
        o.modelName = null;
      }
    });
  }

  async function importModelFor(index: number): Promise<void> {
    const file = await window.api.openModelFile();
    if (!file) return;
    const dataUrl = bytesToDataUrl(file.data, mimeForName(file.name));
    update((p) => {
      const o = p.objects[index];
      if (o) {
        o.modelName = file.name;
        o.modelDataUrl = dataUrl;
      }
    });
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

  // Escape, or a click anywhere outside a swatch, clears the selection group.
  // mousedown fires before React's onClick (and its stopPropagation), so we
  // can't rely on that to keep clicks on a swatch from reaching this
  // listener — explicitly exclude swatches and their open colour popover
  // (portaled to document.body), mirroring ColorSwatch's own outside-click
  // handling for closing the popover.
  useEffect(() => {
    if (groupKeys.size === 0 && dropdownGroupKeys.size === 0) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setGroupKeys(new Set());
        setDropdownGroupKeys(new Set());
      }
    }
    function onDocPointer(e: MouseEvent): void {
      const t = e.target as Element | null;
      if (
        t?.closest(
          ".color-swatch, .color-popover, .object-head-select.selected",
        )
      )
        return;
      setGroupKeys(new Set());
      setDropdownGroupKeys(new Set());
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onDocPointer);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onDocPointer);
    };
  }, [groupKeys.size, dropdownGroupKeys.size]);

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
                      className={`segment ${isText ? "text" : "break"} ${selectedSegmentId === seg.id ? "sel" : ""}`}
                      style={{
                        left: pct(starts[i]),
                        width: pct(seg.durationSec),
                      }}
                      // Break (non-text) segments aren't editable as such, so
                      // they don't open the inspector; only text segments select.
                      onClick={isText ? () => selectOnly(seg.id) : undefined}
                    >
                      {isText && seg.text && (
                        <>
                          <div className="seg-swatches">
                            {(
                              [
                                [
                                  "Background colour",
                                  seg.text.backgroundColor,
                                  (t: TextStyle, v: string) =>
                                    (t.backgroundColor = v),
                                  `${seg.id}:bg`,
                                ],
                                [
                                  "Text colour",
                                  seg.text.textColor,
                                  (t: TextStyle, v: string) =>
                                    (t.textColor = v),
                                  `${seg.id}:text`,
                                ],
                              ] as [
                                string,
                                string,
                                (t: TextStyle, v: string) => void,
                                string,
                              ][]
                            ).map(([title, value, set, groupKey]) => {
                              swatchMutators.set(groupKey, (p, v) => {
                                const s = p.segments.find(
                                  (x) => x.id === seg.id,
                                );
                                if (s?.text) set(s.text, v);
                              });
                              return (
                                <ColorSwatch
                                  key={title}
                                  className="seg-swatch"
                                  title={title}
                                  value={value}
                                  selected={groupKeys.has(groupKey)}
                                  onShiftClick={() => toggleGroup(groupKey)}
                                  onChange={(v) => applyColor(groupKey, v)}
                                />
                              );
                            })}
                          </div>
                          <DurationField
                            className="tl-dur-input"
                            wrapInField={false}
                            stopClickPropagation
                            value={seg.durationSec}
                            onChange={(v) =>
                              update((p) => {
                                const s = p.segments.find(
                                  (x) => x.id === seg.id,
                                );
                                if (s) s.durationSec = v;
                              })
                            }
                          />
                          <div className="text-head">
                            {seg.text.textBackdrop !== "none" &&
                              (() => {
                                const groupKey = `${seg.id}:obj`;
                                swatchMutators.set(groupKey, (p, v) => {
                                  const s = p.segments.find(
                                    (x) => x.id === seg.id,
                                  );
                                  if (s?.text) s.text.textBackdropColor = v;
                                });
                                return (
                                  <ColorSwatch
                                    className="seg-swatch"
                                    title="Object colour"
                                    value={seg.text.textBackdropColor}
                                    selected={groupKeys.has(groupKey)}
                                    onShiftClick={() => toggleGroup(groupKey)}
                                    onChange={(v) => applyColor(groupKey, v)}
                                  />
                                );
                              })()}
                            {(() => {
                              const key = `${seg.id}:backdrop`;
                              dropdownMutators.set(key, (p, v) => {
                                const s = p.segments.find(
                                  (x) => x.id === seg.id,
                                );
                                if (s?.text)
                                  s.text.textBackdrop = v as TextBackdrop;
                              });
                              return (
                                <select
                                  className={`object-head-select${dropdownGroupKeys.has(key) ? " selected" : ""}`}
                                  value={seg.text.textBackdrop}
                                  onMouseDown={(e) => {
                                    if (e.shiftKey) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      toggleDropdownGroup(key);
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) =>
                                    applyDropdown(key, e.target.value)
                                  }
                                >
                                  <option value="none">None</option>
                                  <option value="silhouette">Silhouette</option>
                                  <option value="wireframe">Wireframe</option>
                                </select>
                              );
                            })()}
                            {seg.text.textBackdrop === "silhouette" && (() => {
                              const key = `${seg.id}:blend`;
                              dropdownMutators.set(key, (p, v) => {
                                const s = p.segments.find(
                                  (x) => x.id === seg.id,
                                );
                                if (s?.text)
                                  s.text.textBlend = v as TextBlendMode;
                              });
                              return (
                                <span className="tl-wide-only">
                                  <select
                                    className={`object-head-select${dropdownGroupKeys.has(key) ? " selected" : ""}`}
                                    value={seg.text.textBlend ?? "normal"}
                                    onMouseDown={(e) => {
                                      if (e.shiftKey) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        toggleDropdownGroup(key);
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      applyDropdown(key, e.target.value)
                                    }
                                  >
                                    <option value="normal">Normal</option>
                                    <option value="invert">Invert</option>
                                    <option value="exclusion">Exclusion</option>
                                    <option value="multiply">Multiply</option>
                                    <option value="screen">Screen</option>
                                  </select>
                                </span>
                              );
                            })()}
                          </div>
                        </>
                      )}
                      {!isText &&
                        (() => {
                          const groupKey = `${seg.id}:bg`;
                          swatchMutators.set(groupKey, (p, v) => {
                            const s = p.segments.find(
                              (x) => x.id === seg.id,
                            );
                            if (s) s.backgroundColor = v;
                          });
                          return (
                            <div className="seg-swatches">
                              <ColorSwatch
                                className="seg-swatch"
                                title="Background colour"
                                value={seg.backgroundColor ?? "#281b6c"}
                                selected={groupKeys.has(groupKey)}
                                onShiftClick={() => toggleGroup(groupKey)}
                                onChange={(v) => applyColor(groupKey, v)}
                              />
                            </div>
                          );
                        })()}
                      {!isText && (
                        <DurationField
                          className="tl-dur-input"
                          wrapInField={false}
                          stopClickPropagation
                          value={seg.durationSec}
                          onChange={(v) =>
                            update((p) => {
                              const s = p.segments.find(
                                (x) => x.id === seg.id,
                              );
                              if (s) s.durationSec = v;
                            })
                          }
                        />
                      )}
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
                  className={`segment object accented ${objectActive && selectedObjectIndex === index ? "sel" : ""}`}
                  style={accentVars(objectAccentColor(obj, index))}
                  onClick={() => selectObjectOnly(index)}
                >
                  <div className="object-head">
                    <select
                      className="object-head-select"
                      value={obj.modelDataUrl ? "bespoke" : obj.primitive}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setObjectType(index, e.target.value)}
                    >
                      <option value="none">None</option>
                      {PRIMITIVE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                      <option value="bespoke">Bespoke</option>
                    </select>
                    <select
                      className="object-head-select"
                      value={obj.surface ?? "image"}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        update((p) => {
                          const o = p.objects[index];
                          if (o) o.surface = e.target.value as ObjectSurface;
                        })
                      }
                    >
                      {SURFACE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {obj.surface !== "image" &&
                      (() => {
                        const groupKey = `obj:${index}:surface`;
                        swatchMutators.set(groupKey, (p, v) => {
                          const o = p.objects[index];
                          if (o) o.surfaceColor = v;
                        });
                        return (
                          <ColorSwatch
                            className="seg-swatch"
                            title="Surface colour"
                            value={obj.surfaceColor ?? "#878787"}
                            selected={groupKeys.has(groupKey)}
                            onShiftClick={() => toggleGroup(groupKey)}
                            onChange={(v) => applyColor(groupKey, v)}
                          />
                        );
                      })()}
                  </div>
                  {renderKeyframes(obj, index)}
                </div>
              ))}
              {project.objects.length < 2 && (
                <button
                  className="segment object tl-add-object"
                  onClick={addObject}
                  title="Add a second object"
                >
                  + Add object
                </button>
              )}
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
