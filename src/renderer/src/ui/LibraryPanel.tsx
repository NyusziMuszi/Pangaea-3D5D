import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { activeObjectIndex, useStore } from "../state/store";
import { BUILTIN_EFFECTS } from "../engine/effects/catalog";
import { instanceFromDef, uid } from "../state/defaults";
import { getPrefs, usePrefs } from "../state/prefs";
import { COLOR_SCHEMES, MAPPINGS, OBJECT_SURFACES, type EffectDef, type ObjectState, type CameraType } from "../types";
import { makeThumbnailUrl, mimeForName } from "./files";
import { registerAsset } from "../state/assets";
import { generateLuckyScene } from "../state/lucky";
import { engine } from "../engine/engineSingleton";
import { Section, Field, ColorSwatch, tickGradient } from "./controls";
import { LockPanel } from "./LockPanel";
import { EXPLORE_SURFACE_OPTIONS, PRIMITIVE_OPTIONS } from "./objectOptions";
import type { ExploreSectionId } from "./exploreSections";
import cancelIcon from "@assets/cancel.svg";
import addIcon from "@assets/add_24dp_E3E3E3_FILL1_wght400_GRAD0_opsz24.svg";

const MAX_COLORS = 12;
const MAX_IMAGES = 10;

// Toggle `value` in an "explore" set: remove it if present, add it otherwise.
// Emptying the set re-selects everything (`all`) so a generation always has a
// choice to make — deselecting all is the same as exploring all.
function toggleExplore<T>(set: T[], value: T, all: readonly T[]): T[] {
  const next = set.includes(value)
    ? set.filter((v) => v !== value)
    : [...set, value];
  return next.length ? next : [...all];
}

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
  const openShaderEditor = useStore((s) => s.openShaderEditor);
  const hasGenerated = useStore((s) => s.hasGenerated);
  const setHasGenerated = useStore((s) => s.setHasGenerated);
  const setLastLuckyColorScheme = useStore((s) => s.setLastLuckyColorScheme);

  const lucky = project.lucky;
  const [generating, setGenerating] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const exploreSections = usePrefs((s) => s.exploreSections);
  const shows = (id: ExploreSectionId): boolean =>
    exploreSections.includes(id);

  // The Animations slider has 7 discrete stops (step = 1/6). The browser snaps
  // the thumb to the nearest stop, so the CSS fill must snap the same way —
  // otherwise an off-grid default (e.g. 0.3) leaves the fill short of the thumb,
  // showing a sliver of track just before the handle until the first drag.
  const ANIM_STEP = 1 / 6;
  const animPct = Math.round(lucky.animation / ANIM_STEP) * ANIM_STEP * 100;

  // lucky.images stores absolute file paths. The palette grid only ever shows a
  // small thumbnail, so we decode + downscale each path off the main thread into
  // a blob: object URL (thumbUrlCache) — far cheaper than ×10 full-res decodes.
  // Full-res bytes are read and registered as assets lazily, only at generation
  // time (assetIdCache), so big originals never stay resident just to paint the
  // grid. Both caches are ephemeral (not serialized); thumbResolved mirrors
  // thumb arrivals into state so the grid re-renders once a decode completes.
  const assetIdCache = useRef<Map<string, string>>(new Map());
  const thumbUrlCache = useRef<Map<string, string>>(new Map());
  const [thumbResolved, setThumbResolved] = useState(0);

  // Resolve a path to a registered asset id, reading the file once via the
  // ungated image-read IPC. Returns null if the file can't be read.
  async function resolveAssetId(path: string): Promise<string | null> {
    const cached = assetIdCache.current.get(path);
    if (cached) return cached;
    const res = await window.api.readImagePath(path);
    if (!res.ok || !res.data || !res.mime) return null;
    const id = registerAsset(res.data, res.mime);
    assetIdCache.current.set(path, id);
    return id;
  }

  // Resolve a path to a small thumbnail object URL. Returns null if unreadable.
  async function resolveThumb(path: string): Promise<string | null> {
    const cached = thumbUrlCache.current.get(path);
    if (cached) return cached;
    const res = await window.api.readImagePath(path);
    if (!res.ok || !res.data || !res.mime) return null;
    const url = await makeThumbnailUrl(res.data, res.mime);
    thumbUrlCache.current.set(path, url);
    return url;
  }

  // Resolve any uncached preset paths (e.g. after reopening a project) so
  // thumbnails reappear without re-picking via dialog. Decodes run in parallel
  // so the grid never blocks on a sequential chain of large-image decodes.
  useEffect(() => {
    let cancelled = false;
    const pending = lucky.images.filter((p) => !thumbUrlCache.current.has(p));
    if (pending.length === 0) return;
    Promise.all(pending.map(resolveThumb)).then((results) => {
      if (!cancelled && results.some(Boolean)) setThumbResolved((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [lucky.images]);

  // Revoke every cached thumbnail object URL on unmount so blobs don't leak.
  useEffect(() => {
    const cache = thumbUrlCache.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
    };
  }, []);

  // Upload an image from disk and store its file path as a preset. The picked
  // bytes seed the thumbnail cache so it appears instantly with no re-read.
  async function addLuckyImage(): Promise<void> {
    const file = await window.api.openImageFile();
    if (!file) return;
    const mime = mimeForName(file.name);
    makeThumbnailUrl(file.data, mime).then((url) => {
      thumbUrlCache.current.set(file.path, url);
      setThumbResolved((n) => n + 1);
    });
    update((p) => {
      p.lucky.images.push(file.path);
    });
  }

  // Remove a preset image and revoke its thumbnail so the blob is freed.
  function removeLuckyImage(index: number, path: string): void {
    const url = thumbUrlCache.current.get(path);
    if (url) {
      URL.revokeObjectURL(url);
      thumbUrlCache.current.delete(path);
    }
    update((p) => {
      p.lucky.images.splice(index, 1);
    });
  }

  async function onGenerate(): Promise<void> {
    setGenerating(true);
    try {
      const assetIds: string[] = [];
      for (const path of lucky.images) {
        const id = await resolveAssetId(path);
        if (id) assetIds.push(id);
        else setToast(`Skipped ${path.split(/[\\/]/).pop()}`);
      }
      const { project: next, colorScheme } = generateLuckyScene(
        project,
        lucky.surfaceColors,
        lucky.typeColors,
        assetIds,
        {
          objectCounts: lucky.objectCounts,
          colorSchemes: lucky.colorSchemes,
          surfaces: lucky.surfaces,
          shapes: lucky.shapes,
          blendModes: lucky.blendModes,
          textBackdrops: lucky.textBackdrops,
          animation: lucky.animation,
          locks: lucky.locks,
          enabledEffectIds: lucky.enabledEffectIds,
          mappings: lucky.mappings,
          tasteProfile: getPrefs().tasteProfile,
        },
      );
      // New identity re-syncs the engine via App.tsx's useEffect([project]).
      setProject(next);
      setLastLuckyColorScheme(colorScheme);
      // Reset the engine's own clock, not just the store. setPlayhead alone
      // leaves the engine's internal playhead at the old timestamp, so playback
      // would resume there; seekTo(0) moves the real clock and fires
      // onTick -> setPlayhead so the new scene always starts from the beginning.
      engine.seekTo(0);
      setHasGenerated(true);
    } finally {
      setGenerating(false);
    }
  }

  // Mutate one object by index in place.
  function mutateObject(index: number, fn: (o: ObjectState) => void): void {
    update((p) => {
      const o = p.objects[index];
      if (o) fn(o);
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
            <Section
              title="Explore"
              className="lucky"
              right={
                <button
                  className={`explore-info-btn${showInfo ? " active" : ""}`}
                  title="About Explore"
                  onClick={() => setShowInfo((v) => !v)}
                >
                  ⓘ
                </button>
              }
            >
              {showInfo && (
                <div className="explore-info">
                  <p className="prefs-note">
                    Explore randomizes <strong>visuals only</strong> — object
                    shapes, surfaces and transforms, effects, keyframes, and
                    scene and text-card colours. Your timeline is preserved:
                    segment count, durations, and text content stay exactly as
                    they are. Every result is animated — scale, one rotation
                    axis, and one effect&rsquo;s intensity are always keyframed.
                  </p>
                  <p className="prefs-note">
                    Each generation draws one entry from your chosen options (an
                    empty set falls back to all options):
                  </p>
                  <ul className="prefs-note prefs-rules">
                    <li>
                      <strong>Objects</strong> — If there are 2 objects, and
                      images have been loaded into the palette, by default only
                      one object is generated with an image.
                    </li>
                    <li>
                      <strong>Object surface</strong> — how a non-image object
                      is drawn; with two flat objects the surfaces are picked
                      distinct where the set allows.
                    </li>
                    <li>
                      <strong>Shapes</strong> — which primitive shapes an
                      object may take.
                    </li>
                    <li>
                      <strong>Colour Rhythm</strong> <em>~ + ~ + ~ +</em>:
                      animation is treated as a continuous sequence with the
                      message cards interrupting it. <em>~ ~ + + x x</em>: each
                      animation belongs to a message. <em>Random</em>: every
                      segment is coloured independently.
                    </li>
                    <li>
                      <strong>Text background</strong> — whether text cards show
                      the object as a silhouette, none or wireframe backdrop.
                    </li>
                    <li>
                      <strong>Blend</strong> — how text glyphs composite over
                      the object silhouette on text cards.
                    </li>
                    <li>
                      <strong>Effects pool</strong> — which built-in effects
                      Explore is allowed to use.
                    </li>
                    <li>
                      <strong>Animations</strong> (0–1) — drives effect count,
                      keyframe count, extra animated transforms, and rotation
                      intensity.
                    </li>
                  </ul>
                  <li>
                    <strong>Colours</strong> — Every trio puts the background
                    and silhouette on one lightness side and the text on the
                    opposite side, so text always stays legible.
                  </li>
                </div>
              )}
              {shows("typeColors") && (
                <>
                  <div className="subhead">Palette: Typography</div>
                  <div className="swatch-list">
                    {lucky.typeColors.map((c, i) => (
                      <div className="swatch-row" key={i}>
                        <ColorSwatch
                          value={c}
                          onChange={(v) =>
                            update((p) => {
                              p.lucky.typeColors[i] = v;
                            })
                          }
                        />
                        <button
                          className="btn-icon"
                          title="Remove colour"
                          onClick={() =>
                            update((p) => {
                              p.lucky.typeColors.splice(i, 1);
                            })
                          }
                        >
                          <img src={cancelIcon} alt="remove" />
                        </button>
                      </div>
                    ))}
                    {lucky.typeColors.length < MAX_COLORS && (
                      <button
                        className="swatch-add-btn"
                        title="Add colour"
                        onClick={() =>
                          update((p) => {
                            p.lucky.typeColors.push("#a3d6dc");
                          })
                        }
                      >
                        <img src={addIcon} alt="add" />
                      </button>
                    )}
                  </div>
                </>
              )}
              {shows("surfaceColors") && (
                <>
                  <div className="subhead">Palette: Surface</div>
                  <div className="swatch-list">
                    {lucky.surfaceColors.map((c, i) => (
                      <div className="swatch-row" key={i}>
                        <ColorSwatch
                          value={c}
                          onChange={(v) =>
                            update((p) => {
                              p.lucky.surfaceColors[i] = v;
                            })
                          }
                        />
                        <button
                          className="btn-icon"
                          title="Remove colour"
                          onClick={() =>
                            update((p) => {
                              p.lucky.surfaceColors.splice(i, 1);
                            })
                          }
                        >
                          <img src={cancelIcon} alt="remove" />
                        </button>
                      </div>
                    ))}
                    {lucky.surfaceColors.length < MAX_COLORS && (
                      <button
                        className="swatch-add-btn"
                        title="Add colour"
                        onClick={() =>
                          update((p) => {
                            p.lucky.surfaceColors.push("#a3d6dc");
                          })
                        }
                      >
                        <img src={addIcon} alt="add" />
                      </button>
                    )}
                  </div>
                </>
              )}

              {shows("images") && (
                <>
                  <div className="subhead">Palette: Image</div>
                  {lucky.images.length > 0 && (
                    <div className="lucky-img-grid" data-resolved={thumbResolved}>
                      {lucky.images.map((path, i) => {
                        const thumbUrl = thumbUrlCache.current.get(path);
                        return (
                          <div className="lucky-img-cell" key={path + i}>
                            <div className="lucky-img-thumb">
                              {thumbUrl ? (
                                <img src={thumbUrl} alt="" />
                              ) : (
                                <span className="lucky-img-missing" title={path}>
                                  {path.split(/[\\/]/).pop()}
                                </span>
                              )}
                            </div>
                            <button
                              className="btn-icon"
                              title="Remove image"
                              onClick={() => removeLuckyImage(i, path)}
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
                      Add images
                    </button>
                  )}
                </>
              )}

              {shows("mappings") && lucky.images.length > 0 && (
                <>
                  <div className="subhead">Image mapping</div>
                  <div className="lucky-radio-group">
                    {MAPPINGS.map((v) => (
                      <label className="lucky-radio" key={v}>
                        <input
                          type="checkbox"
                          checked={
                            !lucky.mappings || lucky.mappings.includes(v)
                          }
                          onChange={() =>
                            update((p) => {
                              p.lucky.mappings = toggleExplore(
                                p.lucky.mappings ?? [...MAPPINGS],
                                v,
                                MAPPINGS,
                              );
                            })
                          }
                        />
                        <span>
                          {v === "uv"
                            ? "UV"
                            : v.charAt(0).toUpperCase() + v.slice(1)}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {shows("objectCounts") && (
                <>
                  <div className="subhead">Objects</div>
                  <div className="lucky-radio-group">
                    {(
                  [
                    [1, "Mono"],
                    [2, "Duo"],
                  ] as const
                ).map(([v, label]) => (
                  <label className="lucky-radio" key={v}>
                    <input
                      type="checkbox"
                      checked={lucky.objectCounts.includes(v)}
                      onChange={() =>
                        update((p) => {
                          p.lucky.objectCounts = toggleExplore(
                            p.lucky.objectCounts,
                            v,
                            [1, 2],
                          );
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
                  </div>
                </>
              )}

              {shows("surfaces") && (
                <>
                  <div className="subhead">Object surface</div>
                  <div className="lucky-radio-group">
                    {EXPLORE_SURFACE_OPTIONS.map((o) => (
                      <label
                        className="lucky-radio"
                        key={o.value}
                        title={
                          o.value === "image" && !lucky.images.length
                            ? "Add images to the palette to explore image surfaces"
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={lucky.surfaces.includes(o.value)}
                          disabled={o.value === "image" && !lucky.images.length}
                          onChange={() =>
                            update((p) => {
                              p.lucky.surfaces = toggleExplore(
                                p.lucky.surfaces,
                                o.value,
                                OBJECT_SURFACES,
                              );
                            })
                          }
                        />
                        <span>{o.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {shows("shapes") && (
                <>
                  <div className="subhead">Shapes</div>
                  <div className="lucky-radio-group">
                    {PRIMITIVE_OPTIONS.map((o) => (
                      <label className="lucky-radio" key={o.value}>
                        <input
                          type="checkbox"
                          checked={
                            !lucky.shapes || lucky.shapes.includes(o.value)
                          }
                          onChange={() =>
                            update((p) => {
                              const all = PRIMITIVE_OPTIONS.map((x) => x.value);
                              const current = p.lucky.shapes ?? all;
                              const next = toggleExplore(current, o.value, all);
                              p.lucky.shapes =
                                next.length === all.length ? undefined : next;
                            })
                          }
                        />
                        <span>{o.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {shows("colorSchemes") && (
                <>
                  <div className="subhead">Colour Rhythm</div>
                  <div className="lucky-radio-group">
                    {(
                      [
                        ["byType", "~ + ~ + ~ +"],
                        ["byPair", "~ ~ + + x x"],
                        ["random", "Random"],
                      ] as const
                    ).map(([v, label]) => (
                      <label className="lucky-radio" key={v}>
                        <input
                          type="checkbox"
                          checked={lucky.colorSchemes.includes(v)}
                          onChange={() =>
                            update((p) => {
                              p.lucky.colorSchemes = toggleExplore(
                                p.lucky.colorSchemes,
                                v,
                                COLOR_SCHEMES,
                              );
                            })
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {shows("textBackdrops") && (
                <>
                  <div className="subhead">Text background</div>
                  <div className="lucky-radio-group">
                    {(
                      [
                        ["silhouette", "Silhouette"],
                        ["wireframe", "Wireframe"],
                      ] as const
                    ).map(([v, label]) => (
                      <label className="lucky-radio" key={v}>
                        <input
                          type="checkbox"
                          checked={lucky.textBackdrops.includes(v)}
                          onChange={() =>
                            update((p) => {
                              p.lucky.textBackdrops = toggleExplore(
                                p.lucky.textBackdrops,
                                v,
                                ["silhouette", "wireframe"],
                              );
                            })
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {shows("blendModes") && (
                <>
                  <div className="subhead">Blend</div>
                  <div className="lucky-radio-group">
                    {(
                      [
                        ["normal", "Normal"],
                        ["invert", "Invert"],
                        ["exclusion", "Exclusion"],
                        ["multiply", "Multiply"],
                        ["screen", "Screen"],
                      ] as const
                    ).map(([v, label]) => (
                      <label className="lucky-radio" key={v}>
                        <input
                          type="checkbox"
                          checked={lucky.blendModes.includes(v)}
                          onChange={() =>
                            update((p) => {
                              p.lucky.blendModes = toggleExplore(
                                p.lucky.blendModes,
                                v,
                                [
                                  "normal",
                                  "invert",
                                  "exclusion",
                                  "multiply",
                                  "screen",
                                ],
                              );
                            })
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {shows("effects") && (
                <>
                  <div className="subhead">Effects pool</div>
                  <div className="lucky-radio-group">
                    {[...BUILTIN_EFFECTS]
                      .sort((a, b) => a.kind.localeCompare(b.kind))
                      .map((e) => (
                        <label className="lucky-radio" key={e.id}>
                          <input
                            type="checkbox"
                            checked={
                              !lucky.enabledEffectIds ||
                              lucky.enabledEffectIds.includes(e.id)
                            }
                            onChange={() =>
                              update((p) => {
                                const all = BUILTIN_EFFECTS.map((x) => x.id);
                                const current = p.lucky.enabledEffectIds ?? all;
                                const idx = current.indexOf(e.id);
                                if (idx >= 0) {
                                  p.lucky.enabledEffectIds = current.filter(
                                    (id) => id !== e.id,
                                  );
                                } else {
                                  const next = [...current, e.id];
                                  p.lucky.enabledEffectIds =
                                    next.length === all.length
                                      ? undefined
                                      : next;
                                }
                              })
                            }
                          />
                          <span>{e.name}</span>
                        </label>
                      ))}
                  </div>
                </>
              )}

              {shows("animation") && (
                <>
                  <div className="subhead">Animations</div>
                  <input
                    className="scalar-slider"
                    type="range"
                    min={0}
                    max={1}
                    step={ANIM_STEP}
                    value={lucky.animation}
                    style={
                      {
                        ["--slider-pct" as string]: `${animPct}%`,
                        ["--tick-gradient" as string]: tickGradient(
                          0,
                          1,
                          ANIM_STEP,
                        ),
                      } as CSSProperties
                    }
                    onChange={(e) =>
                      update((p) => {
                        p.lucky.animation = parseFloat(e.target.value);
                      })
                    }
                  />
                  <div className="heat-labels">
                    <span>Few</span>
                    <span>Many</span>
                  </div>
                </>
              )}

              <div className="lucky-actions">
                <button
                  className="full important"
                  disabled={generating}
                  onClick={onGenerate}
                >
                  Feeling lucky
                </button>
                <button
                  className="secondary lucky-vote"
                  title="More rolls like this"
                  onClick={() => {
                    getPrefs().recordLike(
                      project,
                      useStore.getState().lastLuckyColorScheme,
                    );
                    setToast("More like this");
                  }}
                >
                  👍
                </button>
                <button
                  className="secondary lucky-vote"
                  title="Fewer rolls like this"
                  onClick={() => {
                    getPrefs().recordDislike(
                      project,
                      useStore.getState().lastLuckyColorScheme,
                    );
                    setToast("Less like this");
                  }}
                >
                  👎
                </button>
              </div>
            </Section>
            <Section title="Scene" defaultOpen={false}>
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

            <Section title="Effects" defaultOpen={false}>
              <div className="catalog">
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
                <ZigzagRule patId="zigzag-bespoke" />
                <button
                  className="catalog-item"
                  onClick={newCustomShader}
                  title="Author a new GLSL effect"
                >
                  <span className="catalog-name">Bespoke</span>
                </button>
              </div>
            </Section>
          </>
        )}
      </div>
      {hasGenerated && !collapsed && <LockPanel />}
      <div className="collapse-tab right">
        <button
          className="btn-icon collapse-btn"
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
