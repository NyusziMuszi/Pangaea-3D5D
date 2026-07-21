import { useState } from "react";
import { useStore } from "../state/store";
import { usePrefs } from "../state/prefs";
import { engine } from "../engine/engineSingleton";
import { uid } from "../state/defaults";
import {
  constant,
  CAMERA_TYPES,
  MAPPINGS,
  OBJECT_SURFACES,
  PRIMITIVE_MODELS,
  type CameraType,
  type Mapping,
  type ObjectState,
  type ObjectSurface,
  type PrimitiveModel,
  type Project,
  type Scalar,
  type SegmentKind,
  type TextBackdrop,
  type TextBlendMode,
  type TextStyle,
} from "../types";
import { Section, Field, ColorSwatch } from "./controls";
import { Modal } from "./Modal";
import {
  setCustomTextCardFont,
  revertTextCardFont,
  TEXT_CARD_FONT_FAMILY,
} from "../engine/fonts";
import { bytesToDataUrl } from "./files";
import { BUILTIN_EFFECTS } from "../engine/effects/catalog";

const SCHEMES = ["byType", "byPair", "random"] as const;
type ColorScheme = (typeof SCHEMES)[number];

const SCHEME_LABELS: Record<ColorScheme, string> = {
  byType: "~ + ~ + ~ +",
  byPair: "~ ~ + + x x",
  random: "Random",
};

// Extension -> font mime, embedded in the stored data URL. The browser parses
// the face by content, so an approximate mime is fine.
const FONT_MIME: Record<string, string> = {
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
};

// Read a blueprint scalar's plain number (blueprints are const-only; fall back
// to the first key just in case a saved blueprint carried animation).
const cval = (s: Scalar): number =>
  s.kind === "const" ? s.value : (s.keys[0]?.value ?? 0);

function NumField({
  label,
  value,
  onChange,
  step = 0.01,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}): JSX.Element {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value || "0"))}
      />
    </Field>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.charAt(0).toUpperCase() + o.slice(1)}
          </option>
        ))}
      </select>
    </Field>
  );
}

// Shared transform/surface fields for an object blueprint (A and B).
function ObjectFields({
  obj,
  onChange,
}: {
  obj: ObjectState;
  onChange: (fn: (o: ObjectState) => void) => void;
}): JSX.Element {
  return (
    <>
      <SelectField
        label="Shape"
        value={obj.primitive}
        options={PRIMITIVE_MODELS}
        onChange={(v) =>
          onChange((o) => {
            o.primitive = v;
          })
        }
      />
      <SelectField
        label="Mapping"
        value={obj.mapping}
        options={MAPPINGS}
        onChange={(v) =>
          onChange((o) => {
            o.mapping = v;
          })
        }
      />
      <SelectField
        label="Surface"
        value={obj.surface}
        options={OBJECT_SURFACES}
        onChange={(v) =>
          onChange((o) => {
            o.surface = v;
          })
        }
      />
      <Field label="Surface colour" stacked>
        <ColorSwatch
          value={obj.surfaceColor}
          onChange={(v) =>
            onChange((o) => {
              o.surfaceColor = v;
            })
          }
        />
      </Field>
      <NumField
        label="Scale"
        value={cval(obj.scale)}
        onChange={(v) =>
          onChange((o) => {
            o.scale = constant(v);
          })
        }
      />
      <NumField
        label="Rotate X"
        value={cval(obj.rotX)}
        onChange={(v) =>
          onChange((o) => {
            o.rotX = constant(v);
          })
        }
      />
      <NumField
        label="Rotate Y"
        value={cval(obj.rotY)}
        onChange={(v) =>
          onChange((o) => {
            o.rotY = constant(v);
          })
        }
      />
      <NumField
        label="Rotate Z"
        value={cval(obj.rotZ)}
        onChange={(v) =>
          onChange((o) => {
            o.rotZ = constant(v);
          })
        }
      />
      <NumField
        label="Position X"
        value={cval(obj.posX)}
        onChange={(v) =>
          onChange((o) => {
            o.posX = constant(v);
          })
        }
      />
      <NumField
        label="Position Y"
        value={cval(obj.posY)}
        onChange={(v) =>
          onChange((o) => {
            o.posY = constant(v);
          })
        }
      />
      <NumField
        label="Position Z"
        value={cval(obj.posZ)}
        onChange={(v) =>
          onChange((o) => {
            o.posZ = constant(v);
          })
        }
      />
    </>
  );
}

function makeTextStyle(): TextStyle {
  return {
    content: "New text",
    fontSize: 150,
    align: "center",
    textColor: "#000000",
    backgroundColor: "#A3D6DC",
    reveal: "fade",
    textBackdrop: "none",
    textBackdropColor: "#64e36e",
    textBackdropWireWidth: 1.5,
  };
}

interface Draft {
  project: Project;
  secondObject: ObjectState;
}

export function PreferencesPanel({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  const setToast = useStore((s) => s.setToast);
  const customFont = usePrefs((s) => s.customFont);

  // A working copy edited freely and committed only on Save (so Cancel reverts).
  // The font is applied immediately (it's a runtime/global effect), separate
  // from this draft.
  const [draft, setDraft] = useState<Draft>(() => ({
    project: structuredClone(usePrefs.getState().project),
    secondObject: structuredClone(usePrefs.getState().secondObject),
  }));

  const mutate = (fn: (d: Draft) => void): void =>
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const mutateObjectA = (fn: (o: ObjectState) => void): void =>
    mutate((d) => {
      const o = d.project.objects[0];
      if (o) fn(o);
    });
  const mutateLucky = (fn: (l: Project["lucky"]) => void): void =>
    mutate((d) => fn(d.project.lucky));
  const mutateText = (i: number, fn: (t: TextStyle) => void): void =>
    mutate((d) => {
      const t = d.project.segments[i]?.text;
      if (t) fn(t);
    });

  function rerenderCards(): void {
    const proj = useStore.getState().project;
    engine.setProject(proj);
    engine.renderFrame(engine.getPlayhead());
  }

  async function uploadFont(): Promise<void> {
    const file = await window.api.openFontFile();
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
    const dataUrl = bytesToDataUrl(file.data, FONT_MIME[ext] ?? "font/otf");
    try {
      await setCustomTextCardFont(dataUrl);
    } catch {
      setToast("Could not load that font");
      return;
    }
    usePrefs.getState().setCustomFont({ name: file.name, dataUrl });
    rerenderCards();
    setToast("Custom font applied");
  }

  function revertFont(): void {
    revertTextCardFont();
    usePrefs.getState().setCustomFont(null);
    rerenderCards();
    setToast(`Reverted to ${TEXT_CARD_FONT_FAMILY}`);
  }

  // Pull explore settings, camera, and segment structure from the live project
  // into the draft. Object shapes, effects, and transforms are left as-is.
  function captureWorkspace(): void {
    const live = structuredClone(useStore.getState().project) as Project;
    setDraft((d) => ({
      ...d,
      project: {
        ...d.project,
        lucky: live.lucky,
        scene: live.scene,
        segments: live.segments,
      },
    }));
    setToast("Loaded current workspace — review and Save");
  }

  function save(): void {
    const p = usePrefs.getState();
    p.setProject(draft.project);
    p.setSecondObject(draft.secondObject);
    setToast("Preferences saved");
    onClose();
  }

  function resetTaste(): void {
    usePrefs.getState().resetTaste();
    setToast("Taste profile reset");
  }

  function resetFactory(): void {
    usePrefs.getState().resetAll();
    revertTextCardFont();
    rerenderCards();
    setDraft({
      project: structuredClone(usePrefs.getState().project),
      secondObject: structuredClone(usePrefs.getState().secondObject),
    });
    setToast("Reset to factory defaults");
  }

  function addSegment(kind: SegmentKind): void {
    mutate((d) => {
      d.project.segments.push(
        kind === "text"
          ? {
              id: uid("seg"),
              kind: "text",
              label: "New text",
              durationSec: 2.5,
              text: makeTextStyle(),
            }
          : {
              id: uid("seg"),
              kind: "animation",
              label: "New break",
              durationSec: 2.5,
              backgroundColor: "#281b6c",
            },
      );
    });
  }
  function removeSegment(i: number): void {
    mutate((d) => {
      d.project.segments.splice(i, 1);
    });
  }
  function moveSegment(i: number, dir: -1 | 1): void {
    mutate((d) => {
      const arr = d.project.segments;
      const j = i + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    });
  }
  function setSegKind(i: number, kind: SegmentKind): void {
    mutate((d) => {
      const s = d.project.segments[i];
      if (!s) return;
      s.kind = kind;
      if (kind === "text") {
        if (!s.text) s.text = makeTextStyle();
        s.backgroundColor = undefined;
      } else {
        s.text = undefined;
        if (!s.backgroundColor) s.backgroundColor = "#281b6c";
      }
    });
  }

  const objA = draft.project.objects[0];

  function ColorList({
    label,
    colors,
    onAdd,
    onRemove,
    onSet,
  }: {
    label: string;
    colors: string[];
    onAdd: () => void;
    onRemove: (i: number) => void;
    onSet: (i: number, v: string) => void;
  }): JSX.Element {
    return (
      <Field label={label} stacked>
        <div className="swatch-list">
          {colors.map((c, i) => (
            <div className="swatch-row" key={`${label}-${i}`}>
              <ColorSwatch value={c} onChange={(v) => onSet(i, v)} />
              <button
                className="btn-icon"
                title="Remove"
                onClick={() => onRemove(i)}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="mini" onClick={onAdd}>
            + Add
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Modal
      onClose={onClose}
      modalClassName="prefs-dialog"
      footClassName="prefs-foot-spread"
      head={
        <>
          <h3>Preferences</h3>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </>
      }
      foot={
        <>
          <div className="prefs-row-add">
            <button className="secondary" onClick={resetFactory}>
              Reset to factory
            </button>
            <button
              className="secondary"
              onClick={captureWorkspace}
              title="Copies your open project's Explore settings, camera, and segment structure (text content, colours, durations) into the fields below. Object shapes, effects, and transforms are not included. Review, then Save."
            >
              Make current the default
            </button>
          </div>
          <div className="prefs-row-add">
            <button onClick={onClose}>Cancel</button>
            <button className="important" onClick={save}>
              Save
            </button>
          </div>
        </>
      }
    >
      <div className="prefs-body">
        <p className="prefs-note">
          These set the defaults for <strong>new</strong> projects. Your current
          project is untouched.
        </p>

        <Section title="General">
          <NumField
            label="Width"
            value={draft.project.output.width}
            step={1}
            min={16}
            onChange={(v) =>
              mutate((d) => {
                d.project.output.width = Math.round(v);
              })
            }
          />
          <NumField
            label="Height"
            value={draft.project.output.height}
            step={1}
            min={16}
            onChange={(v) =>
              mutate((d) => {
                d.project.output.height = Math.round(v);
              })
            }
          />
          <NumField
            label="FPS"
            value={draft.project.output.fps}
            step={1}
            min={1}
            onChange={(v) =>
              mutate((d) => {
                d.project.output.fps = Math.round(v);
              })
            }
          />
          <SelectField
            label="Camera"
            value={draft.project.scene.cameraType}
            options={CAMERA_TYPES}
            onChange={(v) =>
              mutate((d) => {
                d.project.scene.cameraType = v;
              })
            }
          />

          <Field label="Current font">
            <span className="prefs-font-current">
              {customFont ? customFont.name : `${TEXT_CARD_FONT_FAMILY} (bundled)`}
            </span>
          </Field>
          <div className="prefs-row-add">
            <button className="mini" onClick={uploadFont}>
              Upload font…
            </button>
            <button
              className="mini"
              onClick={revertFont}
              disabled={!customFont}
            >
              Revert to {TEXT_CARD_FONT_FAMILY}
            </button>
          </div>
        </Section>

        <Section title="Structure" defaultOpen={false}>
          {draft.project.segments.map((seg, i) => (
            <div className="prefs-seg" key={seg.id}>
              <div className="prefs-seg-head">
                <input
                  className="grow"
                  type="text"
                  value={seg.label}
                  onChange={(e) =>
                    mutate((d) => {
                      const s = d.project.segments[i];
                      if (s) s.label = e.target.value;
                    })
                  }
                />
                <select
                  value={seg.kind}
                  onChange={(e) => setSegKind(i, e.target.value as SegmentKind)}
                >
                  <option value="animation">Animation</option>
                  <option value="text">Text</option>
                </select>
                <button
                  className="btn-icon"
                  title="Move up"
                  onClick={() => moveSegment(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn-icon"
                  title="Move down"
                  onClick={() => moveSegment(i, 1)}
                >
                  ↓
                </button>
                <button
                  className="btn-icon"
                  title="Remove"
                  onClick={() => removeSegment(i)}
                >
                  ✕
                </button>
              </div>
              <NumField
                label="Duration (s)"
                value={seg.durationSec}
                step={0.1}
                min={0.2}
                onChange={(v) =>
                  mutate((d) => {
                    const s = d.project.segments[i];
                    if (s) s.durationSec = Math.max(0.2, v);
                  })
                }
              />

              {seg.kind === "animation" && (
                <Field label="Background colour" stacked>
                  <ColorSwatch
                    value={seg.backgroundColor ?? "#281b6c"}
                    onChange={(v) =>
                      mutate((d) => {
                        const s = d.project.segments[i];
                        if (s) s.backgroundColor = v;
                      })
                    }
                  />
                </Field>
              )}

              {seg.kind === "text" && seg.text && (
                <>
                  <Field label="Message">
                    <textarea
                      rows={3}
                      value={seg.text.content}
                      onChange={(e) =>
                        mutateText(i, (t) => {
                          t.content = e.target.value;
                        })
                      }
                    />
                  </Field>
                  <NumField
                    label="Font size"
                    value={seg.text.fontSize}
                    step={1}
                    min={10}
                    onChange={(v) =>
                      mutateText(i, (t) => {
                        t.fontSize = Math.round(v);
                      })
                    }
                  />
                  <SelectField
                    label="Alignment"
                    value={seg.text.align}
                    options={["left", "center", "right"] as const}
                    onChange={(v) =>
                      mutateText(i, (t) => {
                        t.align = v;
                      })
                    }
                  />
                  <Field label="Text colour" stacked>
                    <ColorSwatch
                      value={seg.text.textColor}
                      onChange={(v) =>
                        mutateText(i, (t) => {
                          t.textColor = v;
                        })
                      }
                    />
                  </Field>
                  <Field label="Background colour" stacked>
                    <ColorSwatch
                      value={seg.text.backgroundColor}
                      onChange={(v) =>
                        mutateText(i, (t) => {
                          t.backgroundColor = v;
                        })
                      }
                    />
                  </Field>
                  <SelectField
                    label="Reveal"
                    value={seg.text.reveal}
                    options={["fade", "cut"] as const}
                    onChange={(v) =>
                      mutateText(i, (t) => {
                        t.reveal = v;
                      })
                    }
                  />
                  <SelectField
                    label="Object styling"
                    value={seg.text.textBackdrop}
                    options={
                      [
                        "none",
                        "silhouette",
                        "wireframe",
                      ] as const satisfies readonly TextBackdrop[]
                    }
                    onChange={(v) =>
                      mutateText(i, (t) => {
                        t.textBackdrop = v;
                      })
                    }
                  />
                  {seg.text.textBackdrop !== "none" && (
                    <Field label="Object colour" stacked>
                      <ColorSwatch
                        value={seg.text.textBackdropColor}
                        onChange={(v) =>
                          mutateText(i, (t) => {
                            t.textBackdropColor = v;
                          })
                        }
                      />
                    </Field>
                  )}
                  {seg.text.textBackdrop === "silhouette" && (
                    <SelectField
                      label="Blend over shape"
                      value={seg.text.textBlend ?? "normal"}
                      options={
                        [
                          "normal",
                          "invert",
                          "exclusion",
                          "multiply",
                          "screen",
                        ] as const satisfies readonly TextBlendMode[]
                      }
                      onChange={(v) =>
                        mutateText(i, (t) => {
                          t.textBlend = v;
                        })
                      }
                    />
                  )}
                  {seg.text.textBackdrop === "wireframe" && (
                    <NumField
                      label="Line weight"
                      value={seg.text.textBackdropWireWidth}
                      step={0.1}
                      min={1}
                      max={3}
                      onChange={(v) =>
                        mutateText(i, (t) => {
                          t.textBackdropWireWidth = v;
                        })
                      }
                    />
                  )}
                </>
              )}
            </div>
          ))}
          <div className="prefs-row-add">
            <button className="mini" onClick={() => addSegment("animation")}>
              + Animation
            </button>
            <button className="mini" onClick={() => addSegment("text")}>
              + Text
            </button>
          </div>
        </Section>

        <Section title="Effects" defaultOpen={false}>
          <p className="prefs-note">
            Choose which built-in effects Explore is allowed to use. All are
            enabled by default — uncheck any you never want generated.
          </p>
          <Field label="Deform" stacked>
            <span className="field-control">
              {BUILTIN_EFFECTS.filter((e) => e.kind === "deform").map((e) => (
                <label key={e.id} className="checkbox-inline-label">
                  <input
                    type="checkbox"
                    checked={
                      !draft.project.lucky.enabledEffectIds ||
                      draft.project.lucky.enabledEffectIds.includes(e.id)
                    }
                    onChange={() =>
                      mutateLucky((l) => {
                        const all = BUILTIN_EFFECTS.map((x) => x.id);
                        const current = l.enabledEffectIds ?? all;
                        const idx = current.indexOf(e.id);
                        if (idx >= 0) {
                          l.enabledEffectIds = current.filter(
                            (id) => id !== e.id,
                          );
                        } else {
                          const next = [...current, e.id];
                          l.enabledEffectIds =
                            next.length === all.length ? undefined : next;
                        }
                      })
                    }
                  />{" "}
                  {e.name}
                </label>
              ))}
            </span>
          </Field>
          <hr className="prefs-hr" />

          <Field label="Shade" stacked>
            <span className="field-control">
              {BUILTIN_EFFECTS.filter((e) => e.kind === "shade").map((e) => (
                <label key={e.id} className="checkbox-inline-label">
                  <input
                    type="checkbox"
                    checked={
                      !draft.project.lucky.enabledEffectIds ||
                      draft.project.lucky.enabledEffectIds.includes(e.id)
                    }
                    onChange={() =>
                      mutateLucky((l) => {
                        const all = BUILTIN_EFFECTS.map((x) => x.id);
                        const current = l.enabledEffectIds ?? all;
                        const idx = current.indexOf(e.id);
                        if (idx >= 0) {
                          l.enabledEffectIds = current.filter(
                            (id) => id !== e.id,
                          );
                        } else {
                          const next = [...current, e.id];
                          l.enabledEffectIds =
                            next.length === all.length ? undefined : next;
                        }
                      })
                    }
                  />{" "}
                  {e.name}
                </label>
              ))}
            </span>
          </Field>
        </Section>

        <Section title="Explore" defaultOpen={false}>
          <ColorList
            label="Text colours"
            colors={draft.project.lucky.typeColors}
            onAdd={() =>
              mutateLucky((l) => {
                l.typeColors.push("#ffffff");
              })
            }
            onRemove={(i) =>
              mutateLucky((l) => {
                l.typeColors.splice(i, 1);
              })
            }
            onSet={(i, v) =>
              mutateLucky((l) => {
                l.typeColors[i] = v;
              })
            }
          />
          <hr className="prefs-hr" />
          <ColorList
            label="Surface colours"
            colors={draft.project.lucky.surfaceColors}
            onAdd={() =>
              mutateLucky((l) => {
                l.surfaceColors.push("#ffffff");
              })
            }
            onRemove={(i) =>
              mutateLucky((l) => {
                l.surfaceColors.splice(i, 1);
              })
            }
            onSet={(i, v) =>
              mutateLucky((l) => {
                l.surfaceColors[i] = v;
              })
            }
          />
          <hr className="prefs-hr" />
          <Field label="Objects" stacked>
            <span className="field-control">
              {([1, 2] as const).map((n, i) => (
                <label key={n} className="checkbox-inline-label">
                  <input
                    type="checkbox"
                    checked={draft.project.lucky.objectCounts.includes(n)}
                    onChange={() =>
                      mutateLucky((l) => {
                        const idx = l.objectCounts.indexOf(n);
                        if (idx >= 0) l.objectCounts.splice(idx, 1);
                        else l.objectCounts.push(n);
                      })
                    }
                  />{" "}
                  {i === 0 ? "Mono" : "Duo"}
                </label>
              ))}
            </span>
          </Field>
          <hr className="prefs-hr" />
          <Field label="Colour Rhythm" stacked>
            <span className="field-control">
              {SCHEMES.map((s) => (
                <label key={s} className="checkbox-inline-label">
                  <input
                    type="checkbox"
                    checked={draft.project.lucky.colorSchemes.includes(s)}
                    onChange={() =>
                      mutateLucky((l) => {
                        const idx = l.colorSchemes.indexOf(s as ColorScheme);
                        if (idx >= 0) l.colorSchemes.splice(idx, 1);
                        else l.colorSchemes.push(s as ColorScheme);
                      })
                    }
                  />{" "}
                  {SCHEME_LABELS[s]}
                </label>
              ))}
            </span>
          </Field>
          <hr className="prefs-hr" />
          <Field label="Blend" stacked>
            <span className="field-control">
              {(
                [
                  "normal",
                  "invert",
                  "exclusion",
                  "multiply",
                  "screen",
                ] as const satisfies readonly TextBlendMode[]
              ).map((v) => (
                <label key={v} className="checkbox-inline-label">
                  <input
                    type="checkbox"
                    checked={draft.project.lucky.blendModes.includes(v)}
                    onChange={() =>
                      mutateLucky((l) => {
                        const idx = l.blendModes.indexOf(v);
                        if (idx >= 0) l.blendModes.splice(idx, 1);
                        else l.blendModes.push(v);
                      })
                    }
                  />{" "}
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </label>
              ))}
            </span>
          </Field>
          <hr className="prefs-hr" />
          <Field label="Text background" stacked>
            <span className="field-control">
              {(["silhouette", "wireframe"] as const).map((v) => (
                <label key={v} className="checkbox-inline-label">
                  <input
                    type="checkbox"
                    checked={draft.project.lucky.textBackdrops.includes(v)}
                    onChange={() =>
                      mutateLucky((l) => {
                        const idx = l.textBackdrops.indexOf(v);
                        if (idx >= 0) l.textBackdrops.splice(idx, 1);
                        else l.textBackdrops.push(v);
                      })
                    }
                  />{" "}
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </label>
              ))}
            </span>
          </Field>
          <hr className="prefs-hr" />
          <Field label="Image mapping" stacked>
            <span className="field-control">
              {MAPPINGS.map((v) => (
                <label key={v} className="checkbox-inline-label">
                  <input
                    type="checkbox"
                    checked={
                      !draft.project.lucky.mappings ||
                      draft.project.lucky.mappings.includes(v)
                    }
                    onChange={() =>
                      mutateLucky((l) => {
                        const all = [...MAPPINGS];
                        const current = l.mappings ?? all;
                        const idx = current.indexOf(v);
                        if (idx >= 0) {
                          const next = current.filter((m) => m !== v);
                          l.mappings = next.length ? next : all;
                        } else {
                          const next = [...current, v];
                          l.mappings =
                            next.length === all.length ? undefined : next;
                        }
                      })
                    }
                  />{" "}
                  {v === "uv" ? "UV" : v.charAt(0).toUpperCase() + v.slice(1)}
                </label>
              ))}
            </span>
          </Field>
          <hr className="prefs-hr" />
          <NumField
            label="Animations"
            value={draft.project.lucky.animation}
            step={0.05}
            min={0}
            max={1}
            onChange={(v) =>
              mutateLucky((l) => {
                l.animation = Math.max(0, Math.min(1, v));
              })
            }
          />
          <hr className="prefs-hr" />
          <div className="prefs-row-add">
            <button className="important" onClick={resetTaste}>
              Reset taste profile
            </button>
          </div>
          <p className="prefs-note">
            Clears the bias learned from likes, saves, exports, and hand-edits
            of generated scenes — future rolls go back to even odds.
          </p>
        </Section>
      </div>
    </Modal>
  );
}
