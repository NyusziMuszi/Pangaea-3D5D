import { activeObjectIndex as resolveActiveIndex, useStore } from "../state/store";
import arrowUpIcon from "../assets/arrow_drop_up_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg";
import arrowDownIcon from "../assets/arrow_drop_down_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg";
import closeIcon from "../assets/close_small_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg";
import deleteIcon from "../assets/cancel.svg";

import { findEffectDef } from "../engine/effects/catalog";
import {
  constant,
  objectAccentClass,
  objectLabel,
  objectLetterLabel,
  type ObjectState,
  type Scalar,
  type TextBackdrop,
} from "../types";
import {
  Section,
  Field,
  ScalarControl,
  ColorRow,
  DurationField,
} from "./controls";
import { defaultProject } from "../state/defaults";
import type { CSSProperties } from "react";

const TAU = Math.PI * 2;

export function InspectorPanel(): JSX.Element {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const setProject = useStore((s) => s.setProject);
  const selectEffect = useStore((s) => s.selectEffect);
  const selectedEffectId = useStore((s) => s.selectedEffectId);
  const selectSegment = useStore((s) => s.selectSegment);
  const setToast = useStore((s) => s.setToast);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const selectedObjectIndex = useStore((s) => s.selectedObjectIndex);
  const openShaderEditor = useStore((s) => s.openShaderEditor);

  function resetToDefault(): void {
    const fresh = defaultProject();
    fresh.scene.backgroundColor = project.scene.backgroundColor;
    const src0 = project.objects[0];
    const dst0 = fresh.objects[0];
    // Carry the primary object's shape/image across the reset, but only if it
    // still exists (Object A can be set to None).
    if (src0) {
      dst0.image.name = src0.image.name;
      dst0.image.dataUrl = src0.image.dataUrl;
      dst0.primitive = src0.primitive;
      dst0.modelName = src0.modelName;
      dst0.modelDataUrl = src0.modelDataUrl;
    }
    // Keep the existing objects so a reset doesn't silently drop them; fall back
    // to the fresh default object when the scene has none.
    fresh.objects =
      project.objects.length > 0
        ? [dst0, ...project.objects.slice(1).map((o) => structuredClone(o))]
        : [dst0];
    const typed = project.segments
      .filter((s) => s.kind === "text" && s.text)
      .map((s) => s.text!.content);
    let i = 0;
    for (const seg of fresh.segments) {
      if (seg.kind === "text" && seg.text && i < typed.length) {
        seg.text.content = typed[i++];
      }
    }
    setProject(fresh);
    selectEffect(null);
    selectSegment(null);
    setToast("Reset to default");
  }

  const segment = project.segments.find((s) => s.id === selectedSegmentId);

  // Which object the inspector edits. Guard against a stale index pointing at
  // an object that no longer exists.
  const activeObjectIndex = resolveActiveIndex(project, selectedObjectIndex);
  const activeObject: ObjectState | undefined =
    project.objects[activeObjectIndex];

  function updateObject(fn: (o: ObjectState) => void): void {
    update((p) => {
      const o = p.objects[activeObjectIndex];
      if (o) fn(o);
    });
  }

  function moveEffect(index: number, dir: -1 | 1): void {
    if (!activeObject) return;
    const j = index + dir;
    if (j < 0 || j >= activeObject.effects.length) return;
    updateObject((o) => {
      const arr = o.effects;
      [arr[index], arr[j]] = [arr[j], arr[index]];
    });
  }

  function toggleEffect(instanceId: string, enabled: boolean): void {
    updateObject((o) => {
      const t = o.effects.find((x) => x.instanceId === instanceId);
      if (t) t.enabled = enabled;
    });
  }

  function deleteEffect(instanceId: string): void {
    updateObject((o) => {
      o.effects = o.effects.filter((x) => x.instanceId !== instanceId);
    });
    if (selectedEffectId === instanceId) selectEffect(null);
  }

  return (
    <div className="panel inspector">
      {segment && (
        <>
          <div className="inspector-object-header id-text">
            <span className="inspector-object-title">
              {segment.kind === "text"
                ? `Text — ${segment.label}`
                : "Text — None"}
            </span>
          </div>

          {segment.kind === "text" && segment.text ? (
            <>
              <Section title="Message" className="id-text">
                <DurationField
                  value={segment.durationSec}
                  onChange={(v) =>
                    update((p) => {
                      const s = p.segments.find((x) => x.id === segment.id);
                      if (s) s.durationSec = v;
                    })
                  }
                />
                <Field label="Message">
                  <textarea
                    rows={3}
                    value={segment.text.content}
                    onChange={(e) =>
                      update((p) => {
                        const s = p.segments.find((x) => x.id === segment.id);
                        if (s?.text) s.text.content = e.target.value;
                      })
                    }
                  />
                </Field>
                <Field label="Font size">
                  <input
                    type="number"
                    min={20}
                    max={300}
                    value={segment.text.fontSize}
                    onChange={(e) =>
                      update((p) => {
                        const s = p.segments.find((x) => x.id === segment.id);
                        if (s?.text)
                          s.text.fontSize = parseInt(
                            e.target.value || "96",
                            10,
                          );
                      })
                    }
                  />
                </Field>
                <Field label="Alignment">
                  <select
                    value={segment.text.align}
                    onChange={(e) =>
                      update((p) => {
                        const s = p.segments.find((x) => x.id === segment.id);
                        if (s?.text)
                          s.text.align = e.target.value as
                            | "left"
                            | "center"
                            | "right";
                      })
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </Field>
                <ColorRow
                  label="Text colour"
                  value={segment.text.textColor}
                  onChange={(v) =>
                    update((p) => {
                      const s = p.segments.find((x) => x.id === segment.id);
                      if (s?.text) s.text.textColor = v;
                    })
                  }
                />
              </Section>

              <Section title="Background" className="id-text">
                <ColorRow
                  label="Background colour"
                  value={segment.text.backgroundColor}
                  onChange={(v) =>
                    update((p) => {
                      const s = p.segments.find((x) => x.id === segment.id);
                      if (s?.text) s.text.backgroundColor = v;
                    })
                  }
                />
                {segment.text.textBackdrop !== "none" && (
                  <ColorRow
                    label="Object colour"
                    value={segment.text.textBackdropColor}
                    onChange={(v) =>
                      update((p) => {
                        const s = p.segments.find((x) => x.id === segment.id);
                        if (s?.text) s.text.textBackdropColor = v;
                      })
                    }
                  />
                )}
                <Field label="Object styling">
                  <select
                    value={segment.text.textBackdrop}
                    onChange={(e) =>
                      update((p) => {
                        const s = p.segments.find((x) => x.id === segment.id);
                        if (s?.text)
                          s.text.textBackdrop = e.target.value as TextBackdrop;
                      })
                    }
                  >
                    <option value="none">None</option>
                    <option value="silhouette">Silhouette</option>
                    <option value="wireframe">Wireframe</option>
                  </select>
                </Field>
                {segment.text.textBackdrop === "wireframe" && (
                  <Field label="Line weight">
                    <input
                      className="scalar-slider"
                      type="range"
                      min={1}
                      max={3}
                      step={0.1}
                      value={segment.text.textBackdropWireWidth ?? 1.5}
                      style={
                        {
                          ["--slider-pct" as string]: `${
                            (((segment.text.textBackdropWireWidth ?? 1.5) - 1) /
                              2) *
                            100
                          }%`,
                        } as CSSProperties
                      }
                      onChange={(e) =>
                        update((p) => {
                          const s = p.segments.find((x) => x.id === segment.id);
                          if (s?.text)
                            s.text.textBackdropWireWidth = parseFloat(
                              e.target.value || "1.5",
                            );
                        })
                      }
                    />
                  </Field>
                )}
                <Field label="Reveal">
                  <select
                    value={segment.text.reveal}
                    onChange={(e) =>
                      update((p) => {
                        const s = p.segments.find((x) => x.id === segment.id);
                        if (s?.text)
                          s.text.reveal = e.target.value as "fade" | "cut";
                      })
                    }
                  >
                    <option value="fade">Fade</option>
                    <option value="cut">Cut</option>
                  </select>
                </Field>
              </Section>
            </>
          ) : (
            <Section title="None" className="id-text">
              <DurationField
                value={segment.durationSec}
                onChange={(v) =>
                  update((p) => {
                    const s = p.segments.find((x) => x.id === segment.id);
                    if (s) s.durationSec = v;
                  })
                }
              />
            </Section>
          )}
        </>
      )}

      {!segment && !activeObject && (
        <div className="inspector-empty hint">No object selected.</div>
      )}

      {!segment && activeObject && (
        <>
          <div
            className={`inspector-object-header ${objectAccentClass(activeObjectIndex)}`}
          >
            <span className="inspector-object-title">
              Object {objectLetterLabel(activeObjectIndex)} —{" "}
              {objectLabel(activeObject)}
            </span>
            {activeObject.image?.dataUrl && (
              <img
                className="inspector-object-thumb"
                src={activeObject.image.dataUrl}
                alt={activeObject.image.name ?? ""}
              />
            )}
          </div>

          <Section title="Transform" className={objectAccentClass(activeObjectIndex)}>
            <ScalarControl
              label="Rotate X"
              scalar={activeObject.rotX}
              min={-TAU}
              max={TAU}
              onChange={(s) =>
                updateObject((o) => {
                  o.rotX = s;
                })
              }
            />
            <ScalarControl
              label="Rotate Y"
              scalar={activeObject.rotY}
              min={-TAU}
              max={TAU}
              onChange={(s) =>
                updateObject((o) => {
                  o.rotY = s;
                })
              }
            />
            <ScalarControl
              label="Rotate Z"
              scalar={activeObject.rotZ}
              min={-TAU}
              max={TAU}
              onChange={(s) =>
                updateObject((o) => {
                  o.rotZ = s;
                })
              }
            />
            <ScalarControl
              label="Scale"
              scalar={activeObject.scale}
              min={0.1}
              max={4}
              onChange={(s) =>
                updateObject((o) => {
                  o.scale = s;
                })
              }
            />
            <ScalarControl
              label="Position X"
              scalar={activeObject.posX ?? constant(0)}
              min={-3}
              max={3}
              onChange={(s) =>
                updateObject((o) => {
                  o.posX = s;
                })
              }
            />
            <ScalarControl
              label="Position Y"
              scalar={activeObject.posY ?? constant(0)}
              min={-3}
              max={3}
              onChange={(s) =>
                updateObject((o) => {
                  o.posY = s;
                })
              }
            />
            <ScalarControl
              label="Position Z"
              scalar={activeObject.posZ ?? constant(0)}
              min={-3}
              max={3}
              onChange={(s) =>
                updateObject((o) => {
                  o.posZ = s;
                })
              }
            />
          </Section>

          {activeObject.effects.map((inst, i) => {
            const def = findEffectDef(inst.defId, project.customEffects);
            return (
              <Section
                key={inst.instanceId}
                className={objectAccentClass(activeObjectIndex)}
                title={def?.name ?? inst.defId}
                right={
                  <div className="fx-row-controls">
                    {def && !def.builtin && (
                      <button
                        className="mini"
                        onClick={() => openShaderEditor(def.id)}
                      >
                        Edit GLSL
                      </button>
                    )}
                    <div className="fx-row-actions">
                      <input
                        type="checkbox"
                        checked={inst.enabled}
                        onChange={(e) =>
                          toggleEffect(inst.instanceId, e.target.checked)
                        }
                      />
                      <button
                        className="btn-icon"
                        onClick={() => moveEffect(i, -1)}
                      >
                        <img src={arrowUpIcon} alt="move up" />
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => moveEffect(i, 1)}
                      >
                        <img src={arrowDownIcon} alt="move down" />
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => deleteEffect(inst.instanceId)}
                      >
                        <img
                          src={deleteIcon}
                          alt="delete"
                          style={{ width: "75%", height: "75%" }}
                        />
                      </button>
                    </div>
                  </div>
                }
              >
                {def?.description && <p className="hint">{def.description}</p>}
                {def?.uniforms.map((u) => {
                  const scalar: Scalar =
                    inst.values[u.name] ?? constant(u.default);
                  return (
                    <ScalarControl
                      key={u.name}
                      label={u.label}
                      scalar={scalar}
                      min={u.min}
                      max={u.max}
                      onChange={(s) =>
                        updateObject((o) => {
                          const target = o.effects.find(
                            (e) => e.instanceId === inst.instanceId,
                          );
                          if (target) target.values[u.name] = s;
                        })
                      }
                    />
                  );
                })}
              </Section>
            );
          })}
        </>
      )}

      <div className="inspector-footer">
        <button className="secondary" onClick={resetToDefault}>
          Reset to default
        </button>
      </div>
    </div>
  );
}
