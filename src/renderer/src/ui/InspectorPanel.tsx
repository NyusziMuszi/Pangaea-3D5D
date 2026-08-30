import {
  activeObjectIndex as resolveActiveIndex,
  useStore,
} from "../state/store";
import arrowUpIcon from "../assets/arrow_drop_up_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg";
import arrowDownIcon from "../assets/arrow_drop_down_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg";
import closeIcon from "../assets/close_small_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg";
import deleteIcon from "../assets/cancel.svg";

import { findEffectDef } from "../engine/effects/catalog";
import { evalScalar } from "../engine/animatable";
import {
  constant,
  SURFACE_COLOR_LIGHT_DEFAULT,
  SURFACE_COLOR_LOW_DEFAULT,
  type Mapping,
  type ObjectState,
  type ObjectSurface,
  type PrimitiveModel,
  type Scalar,
  type TextBackdrop,
  type TextBlendMode,
} from "../types";
import {
  Section,
  Field,
  ScalarControl,
  tickGradient,
  ColorRow,
  DurationField,
} from "./controls";
import { PRIMITIVE_OPTIONS, SURFACE_OPTIONS } from "./objectOptions";
import { accentVars, objectAccentColor } from "./accent";
import { defaultProject } from "../state/defaults";
import { assetUrl, registerAsset } from "../state/assets";
import { bytesToDataUrl, mimeForName } from "./files";
import type { CSSProperties } from "react";

const TAU = Math.PI * 2;

export function InspectorPanel({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}): JSX.Element {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const setProject = useStore((s) => s.setProject);
  const selectEffect = useStore((s) => s.selectEffect);
  const selectedEffectId = useStore((s) => s.selectedEffectId);
  const selectObject = useStore((s) => s.selectObject);
  const selectSegment = useStore((s) => s.selectSegment);
  const setToast = useStore((s) => s.setToast);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const selectedObjectIndex = useStore((s) => s.selectedObjectIndex);
  const openShaderEditor = useStore((s) => s.openShaderEditor);

  function resetToDefault(): void {
    const fresh = defaultProject();
    const src0 = project.objects[0];
    const dst0 = fresh.objects[0];
    // Carry the primary object's shape/image across the reset, but only if it
    // still exists (the primary object can be set to None).
    if (src0) {
      dst0.image.name = src0.image.name;
      dst0.image.assetId = src0.image.assetId;
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
    // Carry each break's background colour across the reset.
    const bgs = project.segments
      .filter((s) => s.kind === "animation")
      .map((s) => s.backgroundColor);
    let b = 0;
    for (const seg of fresh.segments) {
      if (seg.kind === "animation" && b < bgs.length) {
        if (bgs[b]) seg.backgroundColor = bgs[b];
        b++;
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

  // Identity marker for the currently-edited object, applied to the whole
  // panel so it carries that object's --obj-highlight tint — matching the
  // highlight the selected timeline segment fills with. Segments (text or
  // break) stay neutral like the rest of the chrome — only an object's own
  // colour is legitimate content to derive an accent from. Empty when
  // nothing is selected, so the panel stays untinted.
  const panelAccentClass = activeObject ? "accented" : "";

  // The accent colour scheme for the active object: its surface/identity
  // colour. Set as inline CSS variables on the panel and each section.
  const accentStyle: CSSProperties | undefined = activeObject
    ? accentVars(objectAccentColor(project, activeObject, activeObjectIndex))
    : undefined;

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

  // Apply a Type-dropdown choice for the active object. "none" removes it (the
  // objects array stays packed, and selection falls back to the first object);
  // "bespoke" opens the model importer; a real type swaps the primitive and
  // drops any imported model.
  function setObjectType(value: string): void {
    if (value === "none") {
      update((p) => {
        p.objects.splice(activeObjectIndex, 1);
      });
      selectObject(0);
      return;
    }
    if (value === "bespoke") {
      importModelFor();
      return;
    }
    updateObject((o) => {
      o.primitive = value as PrimitiveModel;
      o.modelDataUrl = null;
      o.modelName = null;
    });
  }

  async function loadImageFor(): Promise<void> {
    const file = await window.api.openImageFile();
    if (!file) return;
    const assetId = registerAsset(file.data, mimeForName(file.name));
    updateObject((o) => {
      // New image: reset framing to centered.
      o.image = {
        name: file.name,
        assetId,
        offsetX: constant(0.5),
        offsetY: constant(0.5),
      };
    });
  }

  // Drop the object's image, restoring the centered default so the "Load image"
  // button returns.
  function clearImageFor(): void {
    updateObject((o) => {
      o.image = {
        name: null,
        assetId: null,
        offsetX: constant(0.5),
        offsetY: constant(0.5),
      };
    });
  }

  async function importModelFor(): Promise<void> {
    const file = await window.api.openModelFile();
    if (!file) return;
    const dataUrl = bytesToDataUrl(file.data, mimeForName(file.name));
    updateObject((o) => {
      o.modelName = file.name;
      o.modelDataUrl = dataUrl;
    });
  }

  return (
    <div className={`inspector-wrap ${collapsed ? "collapsed" : ""}`}>
      <div
        className={`panel inspector ${panelAccentClass}`}
        style={accentStyle}
        // When collapsed the panel is just a thin rail; double-clicking
        // anywhere on it re-expands the inspector.
        onDoubleClick={collapsed ? onToggleCollapse : undefined}
      >
        {!collapsed && (
          <>
            {segment && (
              <>
                {segment.kind === "text" && segment.text ? (
                  <>
                    <Section title="Text">
                      <DurationField
                        value={segment.durationSec}
                        onChange={(v) =>
                          update((p) => {
                            const s = p.segments.find(
                              (x) => x.id === segment.id,
                            );
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
                              const s = p.segments.find(
                                (x) => x.id === segment.id,
                              );
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
                              const s = p.segments.find(
                                (x) => x.id === segment.id,
                              );
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
                              const s = p.segments.find(
                                (x) => x.id === segment.id,
                              );
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
                            const s = p.segments.find(
                              (x) => x.id === segment.id,
                            );
                            if (s?.text) s.text.textColor = v;
                          })
                        }
                      />
                    </Section>

                    <Section title="Background">
                      <ColorRow
                        label="Background colour"
                        value={segment.text.backgroundColor}
                        onChange={(v) =>
                          update((p) => {
                            const s = p.segments.find(
                              (x) => x.id === segment.id,
                            );
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
                              const s = p.segments.find(
                                (x) => x.id === segment.id,
                              );
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
                              const s = p.segments.find(
                                (x) => x.id === segment.id,
                              );
                              if (s?.text)
                                s.text.textBackdrop = e.target
                                  .value as TextBackdrop;
                            })
                          }
                        >
                          <option value="none">None</option>
                          <option value="silhouette">Silhouette</option>
                          <option value="wireframe">Wireframe</option>
                        </select>
                      </Field>
                      {segment.text.textBackdrop === "silhouette" && (
                        <Field label="Blend">
                          <select
                            value={segment.text.textBlend ?? "normal"}
                            onChange={(e) =>
                              update((p) => {
                                const s = p.segments.find(
                                  (x) => x.id === segment.id,
                                );
                                if (s?.text)
                                  s.text.textBlend = e.target
                                    .value as TextBlendMode;
                              })
                            }
                          >
                            <option value="normal">Normal</option>
                            <option value="invert">Invert</option>
                            <option value="exclusion">Exclusion</option>
                            <option value="multiply">Multiply</option>
                            <option value="screen">Screen</option>
                          </select>
                        </Field>
                      )}
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
                                  (((segment.text.textBackdropWireWidth ??
                                    1.5) -
                                    1) /
                                    2) *
                                  100
                                }%`,
                                ["--tick-gradient" as string]: tickGradient(
                                  1,
                                  3,
                                  0.1,
                                ),
                              } as CSSProperties
                            }
                            onChange={(e) =>
                              update((p) => {
                                const s = p.segments.find(
                                  (x) => x.id === segment.id,
                                );
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
                              const s = p.segments.find(
                                (x) => x.id === segment.id,
                              );
                              if (s?.text)
                                s.text.reveal = e.target.value as
                                  | "fade"
                                  | "cut";
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
                  <Section title="None">
                    <DurationField
                      value={segment.durationSec}
                      onChange={(v) =>
                        update((p) => {
                          const s = p.segments.find((x) => x.id === segment.id);
                          if (s) s.durationSec = v;
                        })
                      }
                    />
                    <ColorRow
                      label="Background colour"
                      value={segment.backgroundColor ?? "#281b6c"}
                      onChange={(v) =>
                        update((p) => {
                          const s = p.segments.find((x) => x.id === segment.id);
                          if (s) s.backgroundColor = v;
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
                <Section title="Shape" className="accented" style={accentStyle}>
                  <Field label="Type">
                    <select
                      value={
                        activeObject.modelDataUrl
                          ? "bespoke"
                          : activeObject.primitive
                      }
                      onChange={(e) => setObjectType(e.target.value)}
                    >
                      <option value="none">None</option>
                      {PRIMITIVE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                      <option value="bespoke">Bespoke</option>
                    </select>
                  </Field>
                  <Field label="Surface">
                    <select
                      value={activeObject.surface ?? "image"}
                      onChange={(e) =>
                        updateObject((o) => {
                          o.surface = e.target.value as ObjectSurface;
                        })
                      }
                    >
                      {SURFACE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {activeObject.surface !== "image" && (
                    <ColorRow
                      label={
                        activeObject.surface === "faceted"
                          ? "Body colour"
                          : "Surface colour"
                      }
                      value={activeObject.surfaceColor ?? "#878787"}
                      onChange={(v) =>
                        updateObject((o) => {
                          o.surfaceColor = v;
                        })
                      }
                    />
                  )}
                  {activeObject.surface === "faceted" && (
                    <ColorRow
                      label="Light colour"
                      value={
                        activeObject.surfaceColorLight ??
                        SURFACE_COLOR_LIGHT_DEFAULT
                      }
                      onChange={(v) =>
                        updateObject((o) => {
                          o.surfaceColorLight = v;
                        })
                      }
                    />
                  )}
                  {activeObject.surface === "wireframe" && (
                    <Field label="Line weight">
                      <input
                        className="scalar-slider"
                        type="range"
                        min={1}
                        max={3}
                        step={0.1}
                        value={activeObject.surfaceWireWidth ?? 1.5}
                        style={
                          {
                            "--slider-pct": `${(((activeObject.surfaceWireWidth ?? 1.5) - 1) / 2) * 100}%`,
                            "--tick-gradient": tickGradient(1, 3, 0.1),
                          } as CSSProperties
                        }
                        onChange={(e) =>
                          updateObject((o) => {
                            o.surfaceWireWidth = Number(e.target.value);
                          })
                        }
                      />
                    </Field>
                  )}
                  {activeObject.surface === "depth" && (
                    <>
                      <ColorRow
                        label="Low colour"
                        value={
                          activeObject.surfaceColorLow ??
                          SURFACE_COLOR_LOW_DEFAULT
                        }
                        onChange={(v) =>
                          updateObject((o) => {
                            o.surfaceColorLow = v;
                          })
                        }
                      />
                      <Field label="Depth range">
                        <input
                          className="scalar-slider"
                          type="range"
                          min={0.05}
                          max={2}
                          step={0.05}
                          value={activeObject.depthRange ?? 0.5}
                          style={
                            {
                              "--slider-pct": `${(((activeObject.depthRange ?? 0.5) - 0.05) / (2 - 0.05)) * 100}%`,
                              "--tick-gradient": tickGradient(0.05, 2, 0.05),
                            } as CSSProperties
                          }
                          onChange={(e) =>
                            updateObject((o) => {
                              o.depthRange = Number(e.target.value);
                            })
                          }
                        />
                      </Field>
                    </>
                  )}
                  {activeObject.surface === "image" && (
                    <Field label="Mapping">
                      <select
                        value={activeObject.mapping}
                        onChange={(e) =>
                          updateObject((o) => {
                            o.mapping = e.target.value as Mapping;
                          })
                        }
                      >
                        <option value="uv">UV</option>
                        <option value="triplanar">Triplanar</option>
                        <option value="spherical">Spherical</option>
                        <option value="cylindrical">Cylindrical</option>
                        <option value="reflection">Reflection</option>
                      </select>
                    </Field>
                  )}
                  {activeObject.surface === "image" &&
                    (activeObject.image.assetId ? (
                      <div className="lucky-img-cell">
                        <button
                          className="lucky-img-thumb"
                          title="Replace image"
                          onClick={loadImageFor}
                        >
                          <img
                            src={
                              assetUrl(activeObject.image.assetId) ?? undefined
                            }
                            alt={activeObject.image.name ?? ""}
                          />
                        </button>
                        <button
                          className="btn-icon"
                          title="Remove image"
                          onClick={clearImageFor}
                        >
                          <img src={deleteIcon} alt="remove" />
                        </button>
                      </div>
                    ) : (
                      <button className="full important" onClick={loadImageFor}>
                        Load image
                      </button>
                    ))}
                </Section>

                <Section
                  title="Transform"
                  className="accented"
                  style={accentStyle}
                >
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
                      className="accented"
                      style={accentStyle}
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
                                className="icon-75"
                              />
                            </button>
                          </div>
                        </div>
                      }
                    >
                      {def?.description && (
                        <p className="hint">{def.description}</p>
                      )}
                      {def?.uniforms.map((u) => {
                        const scalar: Scalar =
                          inst.values[u.name] ?? constant(u.default);
                        if (u.options) {
                          const index = Math.round(evalScalar(scalar, 0));
                          return (
                            <Field key={u.name} label={u.label}>
                              <select
                                value={index}
                                onChange={(e) =>
                                  updateObject((o) => {
                                    const target = o.effects.find(
                                      (ef) => ef.instanceId === inst.instanceId,
                                    );
                                    if (target)
                                      target.values[u.name] = constant(
                                        Number(e.target.value),
                                      );
                                  })
                                }
                              >
                                {u.options.map((label, i) => (
                                  <option key={label} value={i}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          );
                        }
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
          </>
        )}
      </div>
      <div className="collapse-tab left">
        <button
          className="btn-icon collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand inspector" : "Collapse inspector"}
          aria-label={collapsed ? "Expand inspector" : "Collapse inspector"}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9 18L15 12L9 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
