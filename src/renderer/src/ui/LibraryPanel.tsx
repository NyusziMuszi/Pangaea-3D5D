import { useStore } from "../state/store";
import { BUILTIN_EFFECTS } from "../engine/effects/catalog";
import { defaultSecondObject, instanceFromDef, uid } from "../state/defaults";
import type { EffectDef, PrimitiveModel, Mapping, CameraType } from "../types";
import { constant } from "../types";
import { bytesToDataUrl, mimeForName } from "./files";
import { Section, Field, ScalarControl, ColorRow } from "./controls";

// Primitive shapes offered for both the primary and the optional second object.
const PRIMITIVE_OPTIONS: { value: PrimitiveModel; label: string }[] = [
  { value: "plane", label: "Plane" },
  { value: "sphere", label: "Sphere" },
  { value: "cylinder", label: "Cylinder" },
  { value: "torus", label: "Torus" },
  { value: "box", label: "Box" },
  { value: "cone", label: "Cone" },
  { value: "lathe", label: "Lathe" },
  { value: "tube", label: "Tube" },
  { value: "polyhedron", label: "Polyhedron" },
  { value: "dodecahedron", label: "Dodecahedron" },
  { value: "icosahedron", label: "Icosahedron" },
  { value: "octahedron", label: "Octahedron" },
  { value: "tetrahedron", label: "Tetrahedron" },
];

export function LibraryPanel(): JSX.Element {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const selectEffect = useStore((s) => s.selectEffect);
  const selectSegment = useStore((s) => s.selectSegment);
  const selectObject = useStore((s) => s.selectObject);
  const openShaderEditor = useStore((s) => s.openShaderEditor);

  function addSecondObject(): void {
    update((p) => {
      p.object2 = defaultSecondObject();
    });
    // Focus the new object so the inspector edits its transform straight away.
    selectObject(1);
    selectSegment(null);
    selectEffect(null);
  }

  function removeSecondObject(): void {
    update((p) => {
      p.object2 = null;
    });
    selectObject(0);
  }

  async function loadImage(): Promise<void> {
    const file = await window.api.openImageFile();
    if (!file) return;
    const dataUrl = bytesToDataUrl(file.data, mimeForName(file.name));
    update((p) => {
      // New image: reset framing to centered.
      p.image = {
        name: file.name,
        dataUrl,
        offsetX: constant(0.5),
        offsetY: constant(0.5),
      };
    });
  }

  async function importModel(): Promise<void> {
    const file = await window.api.openModelFile();
    if (!file) return;
    const dataUrl = bytesToDataUrl(file.data, mimeForName(file.name));
    update((p) => {
      p.object.modelName = file.name;
      p.object.modelDataUrl = dataUrl;
    });
  }

  function addEffect(def: EffectDef): void {
    const inst = instanceFromDef(def);
    update((p) => {
      p.effects.push(inst);
    });
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

  const allDefs = [...BUILTIN_EFFECTS, ...project.customEffects];

  return (
    <div className="panel library">
      <Section title="Image">
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
        <button className="full" onClick={loadImage}>
          {project.image.name ? "Replace image" : "Load image"}
        </button>
        {project.image.dataUrl && (
          <img className="thumb" src={project.image.dataUrl} alt="source" />
        )}
        {project.image.dataUrl && (
          <>
            <ScalarControl
              label="Position X"
              scalar={project.image.offsetX ?? constant(0.5)}
              min={0}
              max={1}
              onChange={(s) =>
                update((p) => {
                  p.image.offsetX = s;
                })
              }
            />
            {/* <ScalarControl
              label="Position Y"
              scalar={project.image.offsetY ?? constant(0.5)}
              min={0}
              max={1}
              onChange={(s) =>
                update((p) => {
                  p.image.offsetY = s;
                })
              }
            /> */}
          </>
        )}
      </Section>

      <Section title="Object">
        <Field label="Primitive">
          <select
            value={project.object.primitive}
            disabled={!!project.object.modelDataUrl}
            onChange={(e) =>
              update((p) => {
                p.object.primitive = e.target.value as PrimitiveModel;
              })
            }
          >
            {PRIMITIVE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mapping">
          <select
            value={project.object.mapping}
            onChange={(e) =>
              update((p) => {
                p.object.mapping = e.target.value as Mapping;
              })
            }
          >
            <option value="uv">UV</option>
            <option value="triplanar">Triplanar</option>
          </select>
        </Field>
        <button className="full" onClick={importModel}>
          {project.object.modelName
            ? `Replace model: ${project.object.modelName}`
            : "Import model (glb/gltf/obj)…"}
        </button>
        {project.object.modelDataUrl && (
          <button
            className="full subtle"
            onClick={() =>
              update((p) => {
                p.object.modelDataUrl = null;
                p.object.modelName = null;
              })
            }
          >
            Use primitive instead
          </button>
        )}

        <hr className="catalog-rule" />
        {project.object2 ? (
          <>
            <Field label="2nd primitive">
              <select
                value={project.object2.primitive}
                onChange={(e) =>
                  update((p) => {
                    if (p.object2)
                      p.object2.primitive = e.target.value as PrimitiveModel;
                  })
                }
              >
                {PRIMITIVE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <button className="full subtle" onClick={removeSecondObject}>
              Remove second object
            </button>
          </>
        ) : (
          <button className="full" onClick={addSecondObject}>
            Add second object
          </button>
        )}
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
          <hr className="catalog-rule" />
          {allDefs.map((def) => (
            <button key={def.id} className="catalog-item" onClick={() => addEffect(def)}>
              <span className="catalog-name">{def.name}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
