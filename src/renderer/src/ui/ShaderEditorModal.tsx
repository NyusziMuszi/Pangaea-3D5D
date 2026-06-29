import { useStore } from '../state/store'
import type { EffectDef, EffectKind, UniformDef } from '../types'
import { Modal } from './Modal'

const DEFORM_HELP =
  'Body of: vec3 deform(vec3 pos, vec3 normal, vec2 uv, float t). Inputs: pos, normal, uv, t (uTime), uTexture, plus your uniforms. Must `return pos;`.'
const SHADE_HELP =
  'Body of: vec4 shade(vec4 color, vec2 uv, float t). Inputs: color, uv, t, uTexture, plus your uniforms. Must `return color;`.'

export function ShaderEditorModal(): JSX.Element | null {
  const defId = useStore((s) => s.shaderEditorEffectId)
  const project = useStore((s) => s.project)
  const update = useStore((s) => s.update)
  const openShaderEditor = useStore((s) => s.openShaderEditor)
  const shaderError = useStore((s) => s.shaderError)

  const def = project.customEffects.find((d) => d.id === defId)
  if (!def) return null

  function patch(mutator: (d: EffectDef) => void): void {
    update((p) => {
      const d = p.customEffects.find((x) => x.id === def!.id)
      if (d) mutator(d)
    })
  }

  const code = def.kind === 'deform' ? (def.glslDeform ?? '') : (def.glslShade ?? '')

  function setCode(value: string): void {
    patch((d) => {
      if (d.kind === 'deform') d.glslDeform = value
      else d.glslShade = value
    })
  }

  function setUniform(i: number, mut: (u: UniformDef) => void): void {
    patch((d) => mut(d.uniforms[i]))
  }

  return (
    <Modal
      onClose={() => openShaderEditor(null)}
      modalClassName="shader-editor"
      head={
        <>
          <input
            className="shader-name"
            value={def.name}
            onChange={(e) => patch((d) => (d.name = e.target.value))}
          />
          <select
            value={def.kind}
            onChange={(e) => patch((d) => (d.kind = e.target.value as EffectKind))}
          >
            <option value="deform">deform (vertex)</option>
            <option value="shade">shade (fragment)</option>
          </select>
          <span className="spacer" />
          <button onClick={() => openShaderEditor(null)}>Done</button>
        </>
      }
    >
      <div className="shader-body">
        <div className="shader-code">
          <p className="hint">{def.kind === 'deform' ? DEFORM_HELP : SHADE_HELP}</p>
          <textarea
            className="code"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault()
                const ta = e.currentTarget
                const s = ta.selectionStart
                const v = ta.value
                setCode(v.slice(0, s) + '  ' + v.slice(ta.selectionEnd))
              }
            }}
          />
          {shaderError ? (
            <pre className="shader-error">{shaderError}</pre>
          ) : (
            <pre className="shader-ok">✓ compiled</pre>
          )}
        </div>

        <div className="shader-uniforms">
          <div className="subhead">
            Uniforms
            <button
              className="mini"
              onClick={() =>
                patch((d) =>
                  d.uniforms.push({
                    name: `uParam${d.uniforms.length + 1}`,
                    label: `Param ${d.uniforms.length + 1}`,
                    min: 0,
                    max: 1,
                    default: 0.5
                  })
                )
              }
            >
              + Add
            </button>
          </div>
          {def.uniforms.map((u, i) => (
            <div key={i} className="uniform-edit">
              <input
                className="u-name"
                value={u.name}
                spellCheck={false}
                onChange={(e) => setUniform(i, (x) => (x.name = e.target.value))}
                title="GLSL name"
              />
              <input
                className="u-label"
                value={u.label}
                onChange={(e) => setUniform(i, (x) => (x.label = e.target.value))}
                title="Label"
              />
              <div className="u-nums">
                <input
                  type="number"
                  value={u.min}
                  step={0.1}
                  onChange={(e) => setUniform(i, (x) => (x.min = parseFloat(e.target.value)))}
                  title="min"
                />
                <input
                  type="number"
                  value={u.max}
                  step={0.1}
                  onChange={(e) => setUniform(i, (x) => (x.max = parseFloat(e.target.value)))}
                  title="max"
                />
                <input
                  type="number"
                  value={u.default}
                  step={0.1}
                  onChange={(e) =>
                    setUniform(i, (x) => (x.default = parseFloat(e.target.value)))
                  }
                  title="default"
                />
                <button
                  className="mini"
                  onClick={() => patch((d) => d.uniforms.splice(i, 1))}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
