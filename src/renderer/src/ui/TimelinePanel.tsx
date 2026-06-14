import { useStore } from '../state/store'
import { findEffectDef } from '../engine/effects/catalog'
import { totalDuration } from '../types'

export function TimelinePanel(): JSX.Element {
  const project = useStore((s) => s.project)
  const update = useStore((s) => s.update)
  const selectedSegmentId = useStore((s) => s.selectedSegmentId)
  const selectedEffectId = useStore((s) => s.selectedEffectId)
  const selectSegment = useStore((s) => s.selectSegment)
  const selectEffect = useStore((s) => s.selectEffect)
  const total = totalDuration(project)

  function moveEffect(index: number, dir: -1 | 1): void {
    const j = index + dir
    if (j < 0 || j >= project.effects.length) return
    update((p) => {
      const arr = p.effects
      ;[arr[index], arr[j]] = [arr[j], arr[index]]
    })
  }

  return (
    <div className="timeline">
      <div className="timeline-section">
        <div className="timeline-title">Sequence (3 animation + 3 text)</div>
        <div className="segments">
          {project.segments.map((seg) => (
            <div
              key={seg.id}
              className={`segment ${seg.kind} ${selectedSegmentId === seg.id ? 'sel' : ''}`}
              style={{ flexGrow: seg.durationSec }}
              onClick={() => {
                selectSegment(seg.id)
                selectEffect(null)
              }}
            >
              <span className="segment-label">{seg.label}</span>
              <span className="segment-dur">{seg.durationSec.toFixed(1)}s</span>
              {seg.kind === 'text' && seg.text && (
                <span className="segment-chip" style={{ background: seg.text.backgroundColor }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="timeline-section">
        <div className="timeline-title">Effect stack (applies bottom → top)</div>
        {project.effects.length === 0 && (
          <p className="hint">No effects. Add deformers/shaders from the Library.</p>
        )}
        <div className="fx-stack">
          {project.effects.map((inst, i) => {
            const def = findEffectDef(inst.defId, project.customEffects)
            return (
              <div
                key={inst.instanceId}
                className={`fx-row ${selectedEffectId === inst.instanceId ? 'sel' : ''}`}
                onClick={() => {
                  selectEffect(inst.instanceId)
                  selectSegment(null)
                }}
              >
                <input
                  type="checkbox"
                  checked={inst.enabled}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    update((p) => {
                      const t = p.effects.find((x) => x.instanceId === inst.instanceId)
                      if (t) t.enabled = e.target.checked
                    })
                  }
                />
                <span className="fx-name">{def?.name ?? inst.defId}</span>
                <span className={`tag ${def?.kind ?? ''}`}>{def?.kind}</span>
                <span className="spacer" />
                <button className="mini" onClick={(e) => { e.stopPropagation(); moveEffect(i, -1) }}>
                  ↑
                </button>
                <button className="mini" onClick={(e) => { e.stopPropagation(); moveEffect(i, 1) }}>
                  ↓
                </button>
                <button
                  className="mini"
                  onClick={(e) => {
                    e.stopPropagation()
                    update((p) => {
                      p.effects = p.effects.filter((x) => x.instanceId !== inst.instanceId)
                    })
                    if (selectedEffectId === inst.instanceId) selectEffect(null)
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
