import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { activeObjectIndex, useStore } from "../state/store";
import { BUILTIN_EFFECTS } from "../engine/effects/catalog";
import { defaultSecondObject, instanceFromDef, uid } from "../state/defaults";
import type {
  EffectDef,
  ObjectState,
  PrimitiveModel,
  Mapping,
  CameraType,
} from "../types";
import { constant, objectAccentClass, objectLetterLabel } from "../types";
import { bytesToDataUrl, mimeForName } from "./files";
import { generateLuckyScene } from "../state/lucky";
import { Section, Field, ColorRow, HexInput } from "./controls";
import cancelIcon from "@assets/cancel.svg";

const MAX_COLORS = 12;
const MAX_IMAGES = 10;

// Primitive shapes offered for both the primary and the optional second object.
const PRIMITIVE_OPTIONS: { value: PrimitiveModel; label: string }[] = [
  { value: "plane", label: "Plane" },
  { value: "sphere", label: "Sphere" },
  { value: "portal", label: "Portal" },

  { value: "cylinder", label: "Cylinder" },
  { value: "capsule", label: "Capsule" },
  { value: "torus", label: "Torus" },
  { value: "box", label: "Box" },
  { value: "lathe", label: "Lathe" },
  { value: "knot", label: "Knot" },
  { value: "twist", label: "Twist" },

  { value: "polyhedron", label: "Polyhedron" },
  { value: "dodecahedron", label: "Dodecahedron" },
];

export function LibraryPanel({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}): JSX.Element {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const selectEffect = useStore((s) => s.selectEffect);
  const selectSegment = useStore((s) => s.selectSegment);
  const selectObject = useStore((s) => s.selectObject);
  const setToast = useStore((s) => s.setToast);
  const setProject = useStore((s) => s.setProject);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const openShaderEditor = useStore((s) => s.openShaderEditor);

  const lucky = project.lucky;
  const [generating, setGenerating] = useState(false);

  // lucky.images stores absolute file paths. Each path is resolved to a data
  // URL on demand (renderer is sandboxed and the engine taints on raw URLs, so
  // only data URLs are safe). This ephemeral cache (not serialized) maps
  // path -> data URL so each file is read at most once per session; thumbResolved
  // mirrors it into state so thumbnails re-render once a read completes.
  const dataUrlCache = useRef<Map<string, string>>(new Map());
  const [thumbResolved, setThumbResolved] = useState(0);

  // Resolve a path to a data URL, using the cache or the ungated image-read IPC.
  // Returns null if the file can't be read (moved/deleted/unreadable).
  async function resolvePath(path: string): Promise<string | null> {
    const cached = dataUrlCache.current.get(path);
    if (cached) return cached;
    const res = await window.api.readImagePath(path);
    if (!res.ok || !res.data || !res.mime) return null;
    const dataUrl = bytesToDataUrl(res.data, res.mime);
    dataUrlCache.current.set(path, dataUrl);
    return dataUrl;
  }

  // Resolve any uncached preset paths (e.g. after reopening a project) so
  // thumbnails reappear without re-picking via dialog.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let changed = false;
      for (const path of lucky.images) {
        if (dataUrlCache.current.has(path)) continue;
        const dataUrl = await resolvePath(path);
        if (dataUrl) changed = true;
      }
      if (changed && !cancelled) setThumbResolved((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [lucky.images]);

  // Upload an image from disk and store its file path as a preset. The picked
  // bytes seed the cache so the thumbnail is instant and no re-read is needed.
  async function addLuckyImage(): Promise<void> {
    const file = await window.api.openImageFile();
    if (!file) return;
    dataUrlCache.current.set(
      file.path,
      bytesToDataUrl(file.data, mimeForName(file.name)),
    );
    update((p) => {
      p.lucky.images.push(file.path);
    });
  }

  async function onGenerate(): Promise<void> {
    setGenerating(true);
    try {
      const dataUrls: string[] = [];
      for (const path of lucky.images) {
        const dataUrl = await resolvePath(path);
        if (dataUrl) dataUrls.push(dataUrl);
        else setToast(`Skipped ${path.split(/[\\/]/).pop()}`);
      }
      const next = generateLuckyScene(
        project,
        lucky.colors,
        dataUrls,
        lucky.heat,
      );
      // New identity re-syncs the engine via App.tsx's useEffect([project]).
      setProject(next);
      setPlayhead(0);
    } finally {
      setGenerating(false);
    }
  }

  // Apply a Type-dropdown choice for an object. "none" removes an optional
  // object (it ceases to exist; later objects shift up to keep the list packed);
  // choosing a real type for a non-existent object creates it. "bespoke" opens
  // the model importer.
  function setObjectType(index: number, value: string): void {
    const exists = !!project.objects[index];
    if (value === "none") {
      if (exists) removeObject(index);
      return;
    }
    if (!exists) {
      // The objects array stays packed, so a new object lands at the first free
      // slot (never leaving a hole if an earlier slot is None).
      const at = Math.min(index, project.objects.length);
      update((p) => {
        const o = defaultSecondObject();
        if (value !== "bespoke") o.primitive = value as PrimitiveModel;
        p.objects.splice(at, 0, o);
      });
      // Focus the new object so the inspector edits its transform straight away.
      selectObject(at);
      selectSegment(null);
      selectEffect(null);
      if (value === "bespoke") importModelFor(at);
      return;
    }
    if (value === "bespoke") {
      importModelFor(index);
    } else {
      mutateObject(index, (o) => {
        o.primitive = value as PrimitiveModel;
        o.modelDataUrl = null;
        o.modelName = null;
      });
    }
  }

  function removeObject(index: number): void {
    update((p) => {
      p.objects.splice(index, 1);
    });
    selectObject(0);
  }

  // Mutate one object by index in place.
  function mutateObject(index: number, fn: (o: ObjectState) => void): void {
    update((p) => {
      const o = p.objects[index];
      if (o) fn(o);
    });
  }

  async function loadImageFor(index: number): Promise<void> {
    const file = await window.api.openImageFile();
    if (!file) return;
    const dataUrl = bytesToDataUrl(file.data, mimeForName(file.name));
    mutateObject(index, (o) => {
      // New image: reset framing to centered.
      o.image = {
        name: file.name,
        dataUrl,
        offsetX: constant(0.5),
        offsetY: constant(0.5),
      };
    });
  }

  // Drop an object's image, restoring the centered default so the "Load image"
  // button returns.
  function clearImageFor(index: number): void {
    mutateObject(index, (o) => {
      o.image = {
        name: null,
        dataUrl: null,
        offsetX: constant(0.5),
        offsetY: constant(0.5),
      };
    });
  }

  async function importModelFor(index: number): Promise<void> {
    const file = await window.api.openModelFile();
    if (!file) return;
    const dataUrl = bytesToDataUrl(file.data, mimeForName(file.name));
    mutateObject(index, (o) => {
      o.modelName = file.name;
      o.modelDataUrl = dataUrl;
    });
  }

  // Add an effect to the currently active object. With no second object it
  // always targets object 1. With two objects it targets whichever object is
  // the active context; if a segment is selected instead, there is no object
  // to attach to, so prompt the user to pick one.
  function addEffect(def: EffectDef): void {
    const { selectedSegmentId, selectedObjectIndex } = useStore.getState();
    let target = 0;
    if (project.objects.length > 1) {
      if (selectedSegmentId) {
        setToast("Select an object first");
        return;
      }
      target = activeObjectIndex(project, selectedObjectIndex);
    }
    const inst = instanceFromDef(def);
    mutateObject(target, (o) => {
      o.effects.push(inst);
    });
    selectObject(target);
    selectSegment(null);
    selectEffect(inst.instanceId);
  }

  function newCustomShader(): void {
    const def: EffectDef = {
      id: uid("def"),
      name: "Custom Deformer",
      kind: "deform",
      builtin: false,
      uniforms: [
        { name: "uAmount", label: "Amount", min: 0, max: 1, default: 0.3 },
      ],
      glslDeform: "  pos.z += sin(uv.x * 20.0 + t) * uAmount;\n  return pos;",
    };
    update((p) => {
      p.customEffects.push(def);
    });
    openShaderEditor(def.id);
  }

  // Identical shape/material + image controls for any object. Optional objects
  // gain a "None" type: selecting it makes the object cease to exist, and the
  // remaining controls disappear until a real type is chosen again.
  function ObjectMenu({
    index,
    optional = false,
  }: {
    index: number;
    optional?: boolean;
  }): JSX.Element {
    const obj = project.objects[index];
    const typeValue = obj ? (obj.modelDataUrl ? "bespoke" : obj.primitive) : "none";
    return (
      <>
        <Field label="Type">
          <select
            value={typeValue}
            onChange={(e) => setObjectType(index, e.target.value)}
          >
            {optional && <option value="none">None</option>}
            {PRIMITIVE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="bespoke">Bespoke</option>
          </select>
        </Field>
        {obj && (
          <>
            <Field label="Mapping">
              <select
                value={obj.mapping}
                onChange={(e) =>
                  mutateObject(index, (o) => {
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
            {obj.image.dataUrl ? (
              <div className="lucky-img-cell">
                <button
                  className="lucky-img-thumb"
                  title="Replace image"
                  onClick={() => loadImageFor(index)}
                >
                  <img src={obj.image.dataUrl} alt={obj.image.name ?? ""} />
                </button>
                <button
                  className="btn-icon"
                  title="Remove image"
                  onClick={() => clearImageFor(index)}
                >
                  <img src={cancelIcon} alt="remove" />
                </button>
              </div>
            ) : (
              <button
                className="full important"
                onClick={() => loadImageFor(index)}
              >
                Load image
              </button>
            )}
          </>
        )}
      </>
    );
  }

  function ZigzagRule({ patId }: { patId: string }): JSX.Element {
    return (
      <svg
        className="catalog-rule"
        width="100%"
        height="8"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id={patId}
            x="0"
            y="0"
            width="12"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <polyline
              points="0,8 6,0 12,8"
              fill="none"
              stroke="var(--border)"
              strokeWidth="1.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="8" fill={`url(#${patId})`} />
      </svg>
    );
  }

  const allDefs = [...BUILTIN_EFFECTS, ...project.customEffects];

  return (
    <div className={`library-wrap ${collapsed ? "collapsed" : ""}`}>
      <div
        className="panel library"
        // When collapsed the panel is just a thin rail; double-clicking
        // anywhere on it re-expands the library.
        onDoubleClick={collapsed ? onToggleCollapse : undefined}
      >
        {!collapsed && (
          <>
            <Section title="Scene">
              <ColorRow
                label="Background"
                value={project.scene.backgroundColor}
                onChange={(v) =>
                  update((p) => {
                    p.scene.backgroundColor = v;
                  })
                }
              />
              <Field label="Camera">
                <select
                  value={project.scene.cameraType}
                  onChange={(e) =>
                    update((p) => {
                      p.scene.cameraType = e.target.value as CameraType;
                    })
                  }
                >
                  <option value="perspective">Perspective</option>
                  <option value="isometric">Isometric</option>
                </select>
              </Field>
            </Section>

            <Section title="Object A" className="object-a">
              <ObjectMenu index={0} optional />
            </Section>

            <Section
              title={`Object ${objectLetterLabel(1)}`}
              className={objectAccentClass(1)}
            >
              <ObjectMenu index={1} optional />
            </Section>

            <Section title="Explore" className="lucky">
              <div className="subhead">Colour Palette</div>
              <div className="swatch-list">
                {lucky.colors.map((c, i) => (
                  <div className="swatch-row" key={i}>
                    <input
                      type="color"
                      value={c}
                      onChange={(e) =>
                        update((p) => {
                          p.lucky.colors[i] = e.target.value;
                        })
                      }
                    />
                    <HexInput
                      value={c}
                      onChange={(v) =>
                        update((p) => {
                          p.lucky.colors[i] = v;
                        })
                      }
                    />
                    <button
                      className="btn-icon"
                      title="Remove colour"
                      onClick={() =>
                        update((p) => {
                          p.lucky.colors.splice(i, 1);
                        })
                      }
                    >
                      <img src={cancelIcon} alt="remove" />
                    </button>
                  </div>
                ))}
              </div>
              {lucky.colors.length < MAX_COLORS && (
                <button
                  className="full"
                  onClick={() =>
                    update((p) => {
                      p.lucky.colors.push("#a3d6dc");
                    })
                  }
                >
                  Add a colour
                </button>
              )}

              <div className="subhead">Image Palette</div>
              {lucky.images.length > 0 && (
                <div className="lucky-img-grid" data-resolved={thumbResolved}>
                  {lucky.images.map((path, i) => {
                    const dataUrl = dataUrlCache.current.get(path);
                    return (
                      <div className="lucky-img-cell" key={path + i}>
                        <div className="lucky-img-thumb">
                          {dataUrl ? (
                            <img src={dataUrl} alt="" />
                          ) : (
                            <span className="lucky-img-missing" title={path}>
                              {path.split(/[\\/]/).pop()}
                            </span>
                          )}
                        </div>
                        <button
                          className="btn-icon"
                          title="Remove image"
                          onClick={() =>
                            update((p) => {
                              p.lucky.images.splice(i, 1);
                            })
                          }
                        >
                          <img src={cancelIcon} alt="remove" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {lucky.images.length < MAX_IMAGES && (
                <button className="full default" onClick={addLuckyImage}>
                  Add an image
                </button>
              )}

              <div className="subhead">Heat</div>
              <input
                className="scalar-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={lucky.heat}
                style={
                  {
                    ["--slider-pct" as string]: `${lucky.heat * 100}%`,
                  } as CSSProperties
                }
                onChange={(e) =>
                  update((p) => {
                    p.lucky.heat = parseFloat(e.target.value);
                  })
                }
              />
              <div className="heat-labels">
                <span>Simple </span>
                <span>Intense</span>
              </div>

              <button
                className="full important"
                disabled={generating}
                onClick={onGenerate}
              >
                Feeling lucky
              </button>
            </Section>

            <Section title="Effects">
              <div className="catalog">
                <button
                  className="catalog-item"
                  onClick={newCustomShader}
                  title="Author a new GLSL effect"
                >
                  <span className="catalog-name">Bespoke</span>
                </button>
                <ZigzagRule patId="zigzag-bespoke" />
                {allDefs.map((def) => (
                  <Fragment key={def.id}>
                    <button
                      className="catalog-item"
                      onClick={() => addEffect(def)}
                    >
                      <span className="catalog-name">{def.name}</span>
                    </button>
                    {(def.id === "relief" || def.id === "jitter") && (
                      <ZigzagRule patId={`zigzag-${def.id}`} />
                    )}
                  </Fragment>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
      <div className="library-collapse-tab">
        <button
          className="btn-icon library-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand library" : "Collapse library"}
          aria-label={collapsed ? "Expand library" : "Collapse library"}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M15 18L9 12L15 6"
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
