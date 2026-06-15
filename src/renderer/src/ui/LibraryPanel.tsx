import { useStore } from '../state/store'
import { BUILTIN_EFFECTS } from '../engine/effects/catalog'
import { instanceFromDef, uid } from '../state/defaults'
import type { EffectDef, SubjectMode, PrimitiveModel, Mapping } from '../types'
import { constant } from '../types'
import { bytesToDataUrl, mimeForName } from './files'
import { Section, Field, ScalarControl } from './controls'

export function LibraryPanel(): JSX.Element {
  const project = useStore((s) => s.project)
  const update = useStore((s) => s.update)
  const selectEffect = useStore((s) => s.selectEffect)
  const openShaderEditor = useStore((s) => s.openShaderEditor)

  async function loadImage(): Promise<void> {
    const file = await window.api.openImageFile()
    if (!file) return
    const dataUrl = bytesToDataUrl(file.data, mimeForName(file.name))
    update((p) => {
      // New image: reset framing to centered.
      p.image = { name: file.name, dataUrl, offsetX: constant(0.5), offsetY: constant(0.5) }
    })
  }

  async function importModel(): Promise<void> {
    const file = await window.api.openModelFile()
    if (!file) return
    const dataUrl = bytesToDataUrl(file.data, mimeForName(file.name))
    update((p) => {
      p.subject.modelName = file.name
      p.subject.modelDataUrl = dataUrl
      p.subject.mode = 'model'
    })
  }

  function addEffect(def: EffectDef): void {
    const inst = instanceFromDef(def)
    update((p) => {
      p.effects.push(inst)
    })
    selectEffect(inst.instanceId)
  }

  function newCustomShader(): void {
    const def: EffectDef = {
      id: uid('def'),
      name: 'Custom Deformer',
      kind: 'deform',
      builtin: false,
      uniforms: [{ name: 'uAmount', label: 'Amount', min: 0, max: 1, default: 0.3 }],
      glslDeform: '  pos.z += sin(uv.x * 20.0 + t) * uAmount;\n  return pos;'
    }
    update((p) => {
      p.customEffects.push(def)
    })
    openShaderEditor(def.id)
  }

  const allDefs = [...BUILTIN_EFFECTS, ...project.customEffects]

  return (
    <div className="panel library">
      <Section title="Image">
        <button className="full" onClick={loadImage}>
          {project.image.name ? `Replace: ${project.image.name}` : 'Load image…'}
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
              onChange={(s) => update((p) => { p.image.offsetX = s })}
            />
            <ScalarControl
              label="Position Y"
              scalar={project.image.offsetY ?? constant(0.5)}
              min={0}
              max={1}
              onChange={(s) => update((p) => { p.image.offsetY = s })}
            />
          </>
        )}
      </Section>

      <Section title="Subject">
        <Field label="Mode">
          <select
            value={project.subject.mode}
            onChange={(e) =>
              update((p) => {
                p.subject.mode = e.target.value as SubjectMode
              })
            }
          >
            <option value="plane">Plane (deformable)</option>
            <option value="model">3D model</option>
            <option value="particles">Particles</option>
          </select>
        </Field>

        {project.subject.mode === 'model' && (
          <>
            <Field label="Primitive">
              <select
                value={project.subject.primitive}
                disabled={!!project.subject.modelDataUrl}
                onChange={(e) =>
                  update((p) => {
                    p.subject.primitive = e.target.value as PrimitiveModel
                  })
                }
              >
                <option value="plane">Plane</option>
                <option value="sphere">Sphere</option>
                <option value="cylinder">Cylinder</option>
                <option value="torus">Torus</option>
                <option value="box">Box</option>
              </select>
            </Field>
            <Field label="Mapping">
              <select
                value={project.subject.mapping}
                onChange={(e) =>
                  update((p) => {
                    p.subject.mapping = e.target.value as Mapping
                  })
                }
              >
                <option value="uv">UV</option>
                <option value="triplanar">Triplanar</option>
              </select>
            </Field>
            <button className="full" onClick={importModel}>
              {project.subject.modelName
                ? `Replace model: ${project.subject.modelName}`
                : 'Import model (glb/gltf/obj)…'}
            </button>
            {project.subject.modelDataUrl && (
              <button
                className="full subtle"
                onClick={() =>
                  update((p) => {
                    p.subject.modelDataUrl = null
                    p.subject.modelName = null
                  })
                }
              >
                Use primitive instead
              </button>
            )}
          </>
        )}

        {project.subject.mode === 'particles' && (
          <Field label="Density">
            <input
              type="number"
              min={16}
              max={400}
              step={4}
              value={project.subject.particle.density}
              onChange={(e) =>
                update((p) => {
                  p.subject.particle.density = parseInt(e.target.value || '160', 10)
                })
              }
            />
          </Field>
        )}
      </Section>

      <Section
        title="Effects"
        right={
          <button className="mini" onClick={newCustomShader} title="Author a new GLSL effect">
            + Shader
          </button>
        }
      >
        {project.subject.mode === 'particles' ? (
          <p className="hint">
            Particle controls live in the Inspector (Subject → Particles). Deformers apply in Plane
            / 3D model modes.
          </p>
        ) : (
          <div className="catalog">
            {allDefs.map((def) => (
              <div key={def.id} className="catalog-item">
                <div className="catalog-meta">
                  <span className="catalog-name">{def.name}</span>
                  <span className={`tag ${def.kind}`}>{def.kind}</span>
                </div>
                <button className="mini" onClick={() => addEffect(def)}>
                  Add
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
