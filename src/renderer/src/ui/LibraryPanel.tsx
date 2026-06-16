import { useStore } from "../state/store";
import { BUILTIN_EFFECTS } from "../engine/effects/catalog";
import { defaultSecondObject, instanceFromDef, uid } from "../state/defaults";
import type {
  EffectDef,
  ObjectState,
  PrimitiveModel,
  Mapping,
  CameraType,
} from "../types";
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
  { value: "lathe", label: "Lathe" },
  { value: "knot", label: "Knot" },
  { value: "twist", label: "Twist" },

  { value: "polyhedron", label: "Polyhedron" },
  { value: "dodecahedron", label: "Dodecahedron" },
];

export function LibraryPanel(): JSX.Element {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const selectEffect = useStore((s) => s.selectEffect);
  const selectSegment = useStore((s) => s.selectSegment);
  const selectObject = useStore((s) => s.selectObject);
  const setToast = useStore((s) => s.setToast);
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

  // Mutate one object (0 = primary, 1 = optional second) in place.
  function mutateObject(index: 0 | 1, fn: (o: ObjectState) => void): void {
    update((p) => {
      const o = index === 0 ? p.object : p.object2;
      if (o) fn(o);
    });
  }

  async function loadImageFor(index: 0 | 1): Promise<void> {
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

  async function importModelFor(index: 0 | 1): Promise<void> {
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
    let target: 0 | 1 = 0;
    if (project.object2) {
      if (selectedSegmentId) {
        setToast("Select an object first");
        return;
      }
      target = selectedObjectIndex === 1 ? 1 : 0;
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

  // Identical shape/material + image controls for either object.
  function ObjectMenu({ index }: { index: 0 | 1 }): JSX.Element {
    const obj = index === 0 ? project.object : project.object2;
    if (!obj) return <></>;
    return (
      <>
        <Field label="Primitive">
          <select
            value={obj.primitive}
            disabled={!!obj.modelDataUrl}
            onChange={(e) =>
              mutateObject(index, (o) => {
                o.primitive = e.target.value as PrimitiveModel;
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
            value={obj.mapping}
            onChange={(e) =>
              mutateObject(index, (o) => {
                o.mapping = e.target.value as Mapping;
              })
            }
          >
            <option value="uv">UV</option>
            <option value="triplanar">Triplanar</option>
          </select>
        </Field>
        <button className="full secondary" onClick={() => importModelFor(index)}>
          {obj.modelName
            ? `Replace model: ${obj.modelName}`
            : "Import 3D model"}
        </button>
        {obj.modelDataUrl && (
          <button
            className="full secondary"
            onClick={() =>
              mutateObject(index, (o) => {
                o.modelDataUrl = null;
                o.modelName = null;
              })
            }
          >
            Use primitive instead
          </button>
        )}
        <button
          className={obj.image.name ? "full secondary" : "full important"}
          onClick={() => loadImageFor(index)}
        >
          {obj.image.name ? "Replace image" : "Load image"}
        </button>
        {obj.image.dataUrl && (
          <ScalarControl
            label="Position X"
            scalar={obj.image.offsetX ?? constant(0.5)}
            min={0}
            max={1}
            onChange={(s) =>
              mutateObject(index, (o) => {
                o.image.offsetX = s;
              })
            }
          />
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
    <div className="panel library">
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
        <ObjectMenu index={0} />
      </Section>

      <Section title="Object B" className="object-b">
        {project.object2 ? (
          <>
            <ObjectMenu index={1} />
            <button className="full secondary" onClick={removeSecondObject}>
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
          <ZigzagRule patId="zigzag-bespoke" />
          {allDefs.map((def) => (
            <div key={def.id}>
              <button
                className="catalog-item"
                onClick={() => addEffect(def)}
              >
                <span className="catalog-name">{def.name}</span>
              </button>
              {(def.id === "relief" || def.id === "jitter") && (
                <ZigzagRule patId={`zigzag-${def.id}`} />
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
