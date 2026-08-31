import { useState, type ReactNode } from "react";
import { branding } from "@branding";
import { useStore } from "../state/store";
import { usePrefs } from "../state/prefs";
import { engine } from "../engine/engineSingleton";
import { uid } from "../state/defaults";
import { defaultObjectImage } from "../state/defaultsBase";
import {
  constant,
  CAMERA_TYPES,
  COLOR_SCHEMES,
  EXPLORE_TEXT_BACKDROPS,
  MAPPINGS,
  OBJECT_COUNTS,
  OBJECT_SURFACES,
  PRIMITIVE_MODELS,
  RAMP_COLOR_MODES,
  TEXT_BLEND_MODES,
  type EffectKind,
  type ObjectState,
  type Project,
  type Scalar,
  type SegmentKind,
  type TextBackdrop,
  type TextBlendMode,
  type TextStyle,
} from "../types";
import { Section, Field, ColorSwatch } from "./controls";
import { PaletteColorList } from "./PaletteColorList";
import { SURFACE_OPTIONS, PRIMITIVE_OPTIONS } from "./objectOptions";
import { exploreLabel, type ExploreSectionId } from "../state/exploreSections";
import { ExploreCheckboxGroup } from "./ExploreCheckboxGroup";
import {
  BLEND_MODE_OPTIONS,
  COLOR_SCHEME_OPTIONS,
  MAPPING_OPTIONS,
  OBJECT_COUNT_OPTIONS,
  RAMP_COLOR_OPTIONS,
  TEXT_BACKDROP_OPTIONS,
} from "./exploreOptions";
import { Modal } from "./Modal";
import {
  setCustomTextCardFont,
  revertTextCardFont,
  TEXT_CARD_FONT_FAMILY,
} from "../engine/fonts";
import { bytesToDataUrl } from "./files";
import { LUCKY_EFFECTS } from "../engine/effects/catalog";

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

// Live objects carry session-scoped image assets and keyframed transforms;
// prefs blueprints are const-only (see cval) and have no asset registry, so
// flatten transforms to their t=0 value and drop the image reference.
function blueprintFromLive(o: ObjectState): ObjectState {
  return {
    ...o,
    image: defaultObjectImage(),
    rotX: constant(cval(o.rotX)),
    rotY: constant(cval(o.rotY)),
    rotZ: constant(cval(o.rotZ)),
    scale: constant(cval(o.scale)),
    posX: constant(cval(o.posX)),
    posY: constant(cval(o.posY)),
    posZ: constant(cval(o.posZ)),
  };
}

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

// Wraps an already-labeled group (a <Field>, <ColorList>, or <NumField> — each
// renders its own Field internally) with a visibility checkbox. The checkbox is
// a sibling, not nested inside the group's <label>, since Field wraps its
// children in a <label> and nesting an input there would make any click inside
// the group also toggle visibility.
//
// Module scope, not a closure in the render body: a component declared inside a
// component is a fresh component *type* every render, so React would remount
// each wrapped group (PaletteColorList included) on every keystroke.
function ExploreField({
  id,
  draft,
  onToggle,
  children,
}: {
  id: ExploreSectionId;
  draft: Draft;
  onToggle: (id: ExploreSectionId) => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="prefs-explore-field">
      <input
        type="checkbox"
        title="Show in the Explore panel"
        checked={draft.exploreSections.includes(id)}
        onChange={() => onToggle(id)}
      />
      {children}
    </div>
  );
}

// One kind's worth of the Explore effects pool. Deform and Shade rendered the
// same block verbatim before this.
function EffectKindField({
  kind,
  label,
  draft,
  onChange,
}: {
  kind: EffectKind;
  label: string;
  draft: Draft;
  onChange: (next: string[] | undefined) => void;
}): JSX.Element {
  return (
    <Field label={label} stacked>
      <ExploreCheckboxGroup
        variant="inline"
        options={LUCKY_EFFECTS.filter((e) => e.kind === kind).map((e) => ({
          value: e.id,
          label: e.name,
        }))}
        selected={draft.project.lucky.enabledEffectIds}
        all={LUCKY_EFFECTS.map((e) => e.id)}
        optional
        onChange={onChange}
      />
    </Field>
  );
}

function makeTextStyle(): TextStyle {
  return {
    content: "New text",
    fontSize: 150,
    align: "center",
    textColor: branding.textCards[0].textColor,
    backgroundColor: branding.textCards[0].backgroundColor,
    reveal: "fade",
    textBackdrop: "none",
    textBackdropColor: branding.textCards[0].textBackdropColor,
    textBackdropWireWidth: 1.5,
  };
}

interface Draft {
  project: Project;
  secondObject: ObjectState;
  exploreSections: ExploreSectionId[];
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
    exploreSections: [...usePrefs.getState().exploreSections],
  }));

  const mutate = (fn: (d: Draft) => void): void =>
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const mutateLucky = (fn: (l: Project["lucky"]) => void): void =>
    mutate((d) => fn(d.project.lucky));
  const mutateText = (i: number, fn: (t: TextStyle) => void): void =>
    mutate((d) => {
      const t = d.project.segments[i]?.text;
      if (t) fn(t);
    });

  const toggleSection = (id: ExploreSectionId): void =>
    mutate((d) => {
      d.exploreSections = d.exploreSections.includes(id)
        ? d.exploreSections.filter((s) => s !== id)
        : [...d.exploreSections, id];
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

  // Pull explore settings, camera, segment structure, and both object
  // blueprints from the live project into the draft.
  function captureWorkspace(): void {
    const live = structuredClone(useStore.getState().project) as Project;
    const objA = live.objects[0]
      ? blueprintFromLive(live.objects[0])
      : undefined;
    setDraft((d) => ({
      ...d,
      project: {
        ...d.project,
        lucky: {
          ...live.lucky,
          images: [],
          locks: { colours: false, motion: false, effects: false, objects: false },
        },
        scene: live.scene,
        segments: live.segments,
        customEffects: live.customEffects,
        objects: objA ? [objA] : d.project.objects,
      },
      secondObject: live.objects[1]
        ? blueprintFromLive(live.objects[1])
        : d.secondObject,
    }));
    setToast("Loaded current workspace — review and Save");
  }

  function save(): void {
    const p = usePrefs.getState();
    p.setProject(draft.project);
    p.setSecondObject(draft.secondObject);
    p.setExploreSections(draft.exploreSections);
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
      exploreSections: [...usePrefs.getState().exploreSections],
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
              title="Copies your open project's Explore settings, camera, segment structure (text content, colours, durations), and both objects (shape, surface, effects, transforms) into the fields below. Review, then Save."
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
          <div className="prefs-explore-field">
            <input
              type="checkbox"
              title="Show in the Explore panel"
              checked={draft.exploreSections.includes("effects")}
              onChange={() => toggleSection("effects")}
            />
            <p className="prefs-note">
              Choose which built-in effects Explore is allowed to use. All are
              enabled by default — uncheck any you never want generated.
            </p>
          </div>
          <EffectKindField
            kind="deform"
            label="Deform"
            draft={draft}
            onChange={(next) =>
              mutateLucky((l) => {
                l.enabledEffectIds = next;
              })
            }
          />
          <hr className="prefs-hr" />
          <EffectKindField
            kind="shade"
            label="Shade"
            draft={draft}
            onChange={(next) =>
              mutateLucky((l) => {
                l.enabledEffectIds = next;
              })
            }
          />
        </Section>

        <Section title="Explore" defaultOpen={false}>
          <ExploreField id="colors" draft={draft} onToggle={toggleSection}>
            <PaletteColorList
              colors={draft.project.lucky.colors}
              onMutate={(fn) =>
                mutateLucky((l) => {
                  fn(l.colors);
                })
              }
            />
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="images" draft={draft} onToggle={toggleSection}>
            <Field label={exploreLabel("images")} stacked>
              <span className="field-control">
                {draft.project.lucky.images.length} image
                {draft.project.lucky.images.length === 1 ? "" : "s"}
                <button
                  className="mini"
                  disabled={!draft.project.lucky.images.length}
                  onClick={() =>
                    mutateLucky((l) => {
                      l.images = [];
                    })
                  }
                >
                  Clear
                </button>
              </span>
            </Field>
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="mappings" draft={draft} onToggle={toggleSection}>
            <Field label={exploreLabel("mappings")} stacked>
              <ExploreCheckboxGroup
                variant="inline"
                options={MAPPING_OPTIONS}
                selected={draft.project.lucky.mappings}
                all={MAPPINGS}
                optional
                onChange={(next) =>
                  mutateLucky((l) => {
                    l.mappings = next;
                  })
                }
              />
            </Field>
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="objectCounts" draft={draft} onToggle={toggleSection}>
            <Field label={exploreLabel("objectCounts")} stacked>
              <ExploreCheckboxGroup
                variant="inline"
                options={OBJECT_COUNT_OPTIONS}
                selected={draft.project.lucky.objectCounts}
                all={OBJECT_COUNTS}
                onChange={(next) =>
                  mutateLucky((l) => {
                    if (next) l.objectCounts = next;
                  })
                }
              />
            </Field>
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="surfaces" draft={draft} onToggle={toggleSection}>
            <Field label={exploreLabel("surfaces")} stacked>
              <ExploreCheckboxGroup
                variant="inline"
                options={SURFACE_OPTIONS}
                selected={draft.project.lucky.surfaces}
                all={OBJECT_SURFACES}
                disabledFor={(v) =>
                  v === "image" && !draft.project.lucky.images.length
                }
                titleFor={(v) =>
                  v === "image" && !draft.project.lucky.images.length
                    ? "Add images to the palette to explore image surfaces"
                    : undefined
                }
                onChange={(next) =>
                  mutateLucky((l) => {
                    if (next) l.surfaces = next;
                  })
                }
              />
            </Field>
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="rampColors" draft={draft} onToggle={toggleSection}>
            <Field label={exploreLabel("rampColors")} stacked>
              <ExploreCheckboxGroup
                variant="inline"
                options={RAMP_COLOR_OPTIONS}
                selected={draft.project.lucky.rampColors}
                all={RAMP_COLOR_MODES}
                optional
                onChange={(next) =>
                  mutateLucky((l) => {
                    l.rampColors = next;
                  })
                }
              />
            </Field>
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="shapes" draft={draft} onToggle={toggleSection}>
            <Field label={exploreLabel("shapes")} stacked>
              <ExploreCheckboxGroup
                variant="inline"
                options={PRIMITIVE_OPTIONS}
                selected={draft.project.lucky.shapes}
                all={PRIMITIVE_MODELS}
                optional
                onChange={(next) =>
                  mutateLucky((l) => {
                    l.shapes = next;
                  })
                }
              />
            </Field>
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="colorSchemes" draft={draft} onToggle={toggleSection}>
            <Field label={exploreLabel("colorSchemes")} stacked>
              <ExploreCheckboxGroup
                variant="inline"
                options={COLOR_SCHEME_OPTIONS}
                selected={draft.project.lucky.colorSchemes}
                all={COLOR_SCHEMES}
                onChange={(next) =>
                  mutateLucky((l) => {
                    if (next) l.colorSchemes = next;
                  })
                }
              />
            </Field>
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="textBackdrops" draft={draft} onToggle={toggleSection}>
            <Field label={exploreLabel("textBackdrops")} stacked>
              <ExploreCheckboxGroup
                variant="inline"
                options={TEXT_BACKDROP_OPTIONS}
                selected={draft.project.lucky.textBackdrops}
                all={EXPLORE_TEXT_BACKDROPS}
                onChange={(next) =>
                  mutateLucky((l) => {
                    if (next) l.textBackdrops = next;
                  })
                }
              />
            </Field>
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="blendModes" draft={draft} onToggle={toggleSection}>
            <Field label={exploreLabel("blendModes")} stacked>
              <ExploreCheckboxGroup
                variant="inline"
                options={BLEND_MODE_OPTIONS}
                selected={draft.project.lucky.blendModes}
                all={TEXT_BLEND_MODES}
                onChange={(next) =>
                  mutateLucky((l) => {
                    if (next) l.blendModes = next;
                  })
                }
              />
            </Field>
          </ExploreField>
          <hr className="prefs-hr" />
          <ExploreField id="animation" draft={draft} onToggle={toggleSection}>
            <NumField
              label={exploreLabel("animation")}
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
          </ExploreField>
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
