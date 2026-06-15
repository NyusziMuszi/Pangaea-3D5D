import { useStore } from '../state/store'
import { findEffectDef } from '../engine/effects/catalog'
import { constant, type Scalar, type TextBackdrop } from '../types'
import { Section, Field, ScalarControl, ColorRow } from './controls'

const TAU = Math.PI * 2

export function InspectorPanel(): JSX.Element {
  const project = useStore((s) => s.project)
  const update = useStore((s) => s.update)
  const selectedEffectId = useStore((s) => s.selectedEffectId)
  const selectedSegmentId = useStore((s) => s.selectedSegmentId)
  const openShaderEditor = useStore((s) => s.openShaderEditor)

  const effect = project.effects.find((e) => e.instanceId === selectedEffectId)
  const effectDef = effect ? findEffectDef(effect.defId, project.customEffects) : undefined
  const segment = project.segments.find((s) => s.id === selectedSegmentId)

  return (
    <div className="panel inspector">
      {effect && effectDef && (
        <Section
          title={`Effect — ${effectDef.name}`}
          right={
            !effectDef.builtin ? (
              <button className="mini" onClick={() => openShaderEditor(effectDef.id)}>
                Edit GLSL
              </button>
            ) : undefined
          }
        >
          {effectDef.description && <p className="hint">{effectDef.description}</p>}
          {effectDef.uniforms.map((u) => {
            const scalar: Scalar = effect.values[u.name] ?? constant(u.default)
            return (
              <ScalarControl
                key={u.name}
                label={u.label}
                scalar={scalar}
                min={u.min}
                max={u.max}
                onChange={(s) =>
                  update((p) => {
                    const inst = p.effects.find((e) => e.instanceId === effect.instanceId)
                    if (inst) inst.values[u.name] = s
                  })
                }
              />
            )
          })}
        </Section>
      )}

      {segment && (
        <Section title={`Segment — ${segment.label}`}>
          <Field label="Duration (s)">
            <input
              type="number"
              min={0.2}
              max={20}
              step={0.1}
              value={segment.durationSec}
              onChange={(e) =>
                update((p) => {
                  const s = p.segments.find((x) => x.id === segment.id)
                  if (s) s.durationSec = Math.max(0.2, parseFloat(e.target.value || '1'))
                })
              }
            />
          </Field>

          {segment.kind === 'text' && segment.text && (
            <>
              <Field label="Text">
                <textarea
                  rows={3}
                  value={segment.text.content}
                  onChange={(e) =>
                    update((p) => {
                      const s = p.segments.find((x) => x.id === segment.id)
                      if (s?.text) s.text.content = e.target.value
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
                      const s = p.segments.find((x) => x.id === segment.id)
                      if (s?.text) s.text.fontSize = parseInt(e.target.value || '96', 10)
                    })
                  }
                />
              </Field>
              <Field label="Align">
                <select
                  value={segment.text.align}
                  onChange={(e) =>
                    update((p) => {
                      const s = p.segments.find((x) => x.id === segment.id)
                      if (s?.text) s.text.align = e.target.value as 'left' | 'center' | 'right'
                    })
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </Field>
              <ColorRow
                label="Text color"
                value={segment.text.textColor}
                onChange={(v) =>
                  update((p) => {
                    const s = p.segments.find((x) => x.id === segment.id)
                    if (s?.text) s.text.textColor = v
                  })
                }
              />
              <ColorRow
                label="Background"
                value={segment.text.backgroundColor}
                onChange={(v) =>
                  update((p) => {
                    const s = p.segments.find((x) => x.id === segment.id)
                    if (s?.text) s.text.backgroundColor = v
                  })
                }
              />
              <Field label="Reveal">
                <select
                  value={segment.text.reveal}
                  onChange={(e) =>
                    update((p) => {
                      const s = p.segments.find((x) => x.id === segment.id)
                      if (s?.text) s.text.reveal = e.target.value as 'fade' | 'cut'
                    })
                  }
                >
                  <option value="fade">Fade</option>
                  <option value="cut">Cut</option>
                </select>
              </Field>
            </>
          )}
        </Section>
      )}

      <Section title="Subject transform" defaultOpen={!effect && !segment}>
        <ScalarControl label="Rotate X" scalar={project.subject.rotX} min={-TAU} max={TAU} onChange={(s) => update((p) => { p.subject.rotX = s })} />
        <ScalarControl label="Rotate Y" scalar={project.subject.rotY} min={-TAU} max={TAU} onChange={(s) => update((p) => { p.subject.rotY = s })} />
        <ScalarControl label="Rotate Z" scalar={project.subject.rotZ} min={-TAU} max={TAU} onChange={(s) => update((p) => { p.subject.rotZ = s })} />
        <ScalarControl label="Scale" scalar={project.subject.scale} min={0.1} max={3} onChange={(s) => update((p) => { p.subject.scale = s })} />

        {project.subject.mode === 'particles' && (
          <>
            <div className="subhead">Particles</div>
            <ScalarControl label="Point size" scalar={project.subject.particle.pointSize} min={0.5} max={14} onChange={(s) => update((p) => { p.subject.particle.pointSize = s })} />
            <ScalarControl label="Dissolve" scalar={project.subject.particle.dissolve} min={0} max={1.5} onChange={(s) => update((p) => { p.subject.particle.dissolve = s })} />
            <ScalarControl label="Explode" scalar={project.subject.particle.explode} min={0} max={3} onChange={(s) => update((p) => { p.subject.particle.explode = s })} />
            <ScalarControl label="Swirl" scalar={project.subject.particle.swirl} min={0} max={6} onChange={(s) => update((p) => { p.subject.particle.swirl = s })} />
          </>
        )}
      </Section>

      <Section title="Camera" defaultOpen={false}>
        <ScalarControl label="FOV" scalar={project.camera.fov} min={10} max={120} step={0.5} onChange={(s) => update((p) => { p.camera.fov = s })} />
        <ScalarControl label="Pos X" scalar={project.camera.posX} min={-8} max={8} onChange={(s) => update((p) => { p.camera.posX = s })} />
        <ScalarControl label="Pos Y" scalar={project.camera.posY} min={-8} max={8} onChange={(s) => update((p) => { p.camera.posY = s })} />
        <ScalarControl label="Pos Z" scalar={project.camera.posZ} min={0.2} max={10} onChange={(s) => update((p) => { p.camera.posZ = s })} />
        <ScalarControl label="Target X" scalar={project.camera.targetX} min={-4} max={4} onChange={(s) => update((p) => { p.camera.targetX = s })} />
        <ScalarControl label="Target Y" scalar={project.camera.targetY} min={-4} max={4} onChange={(s) => update((p) => { p.camera.targetY = s })} />
        <ScalarControl label="Target Z" scalar={project.camera.targetZ} min={-4} max={4} onChange={(s) => update((p) => { p.camera.targetZ = s })} />
      </Section>

      <Section title="Scene" defaultOpen={false}>
        <ColorRow label="Background" value={project.scene.backgroundColor} onChange={(v) => update((p) => { p.scene.backgroundColor = v })} />
        <Field label="Time during cards">
          <select
            value={project.scene.sceneTimeDuringCards}
            onChange={(e) =>
              update((p) => {
                p.scene.sceneTimeDuringCards = e.target.value as 'continue' | 'hold'
              })
            }
          >
            <option value="continue">Continue</option>
            <option value="hold">Hold / freeze</option>
          </select>
        </Field>
        <Field label="Text backdrop">
          <select
            value={project.scene.textBackdrop}
            onChange={(e) =>
              update((p) => {
                p.scene.textBackdrop = e.target.value as TextBackdrop
              })
            }
          >
            <option value="none">None</option>
            <option value="silhouette">Silhouette</option>
            <option value="wireframe">Wireframe</option>
          </select>
        </Field>
        {project.scene.textBackdrop !== 'none' && (
          <ColorRow
            label="Backdrop color"
            value={project.scene.textBackdropColor}
            onChange={(v) => update((p) => { p.scene.textBackdropColor = v })}
          />
        )}
        <Field label="Output">
          <span className="readonly">
            {project.output.width}×{project.output.height} · {project.output.fps}fps
          </span>
        </Field>
      </Section>
    </div>
  )
}
