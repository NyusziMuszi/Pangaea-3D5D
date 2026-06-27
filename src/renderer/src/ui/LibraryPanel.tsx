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
import type { EffectDef, ObjectState, CameraType } from "../types";
import { makeThumbnailUrl, mimeForName } from "./files";
import { registerAsset } from "../state/assets";
import { generateLuckyScene } from "../state/lucky";
import { engine } from "../engine/engineSingleton";
import { Section, Field, ColorSwatch } from "./controls";
import cancelIcon from "@assets/cancel.svg";

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

  const lucky = project.lucky;
  const [generating, setGenerating] = useState(false);

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
      const next = generateLuckyScene(
        project,
        lucky.surfaceColors,
        lucky.typeColors,
        assetIds,
        {
          objectCounts: lucky.objectCounts,
          colorSchemes: lucky.colorSchemes,
          animation: lucky.animation,
        },
      );
      // New identity re-syncs the engine via App.tsx's useEffect([project]).
      setProject(next);
      // Reset the engine's own clock, not just the store. setPlayhead alone
      // leaves the engine's internal playhead at the old timestamp, so playback
      // would resume there; seekTo(0) moves the real clock and fires
      // onTick -> setPlayhead so the new scene always starts from the beginning.
      engine.seekTo(0);
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
            <Section title="Explore" className="lucky">
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
              </div>
              {lucky.typeColors.length < MAX_COLORS && (
                <button
                  className="full"
                  onClick={() =>
                    update((p) => {
                      p.lucky.typeColors.push("#a3d6dc");
                    })
                  }
                >
                  Add colours
                </button>
              )}
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
              </div>
              {lucky.surfaceColors.length < MAX_COLORS && (
                <button
                  className="full"
                  onClick={() =>
                    update((p) => {
                      p.lucky.surfaceColors.push("#a3d6dc");
                    })
                  }
                >
                  Add colours
                </button>
              )}

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

              <div className="subhead">Colour scheme</div>
              <div className="lucky-radio-group">
                {(
                  [
                    ["byType", "Background"],
                    ["byPair", "Pair"],
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
                            ["byType", "byPair", "random"],
                          );
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <div className="subhead">Animations</div>
              <input
                className="scalar-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={lucky.animation}
                style={
                  {
                    ["--slider-pct" as string]: `${lucky.animation * 100}%`,
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

              <button
                className="full important"
                disabled={generating}
                onClick={onGenerate}
              >
                Feeling lucky
              </button>
            </Section>
            <Section title="Scene">
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

            <Section title="Effects">
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
