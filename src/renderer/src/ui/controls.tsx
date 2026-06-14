import { useState, type ReactNode } from 'react'
import type { Scalar } from '../types'
import { useStore } from '../state/store'
import { evalScalar, hasKeyAt, isAnimated, setValueAt, stopAnimating, toggleKeyAt } from './scalarUtils'

export function Section({
  title,
  children,
  defaultOpen = true,
  right
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  right?: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="section">
      <div className="section-head">
        <button className="section-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} {title}
        </button>
        {right}
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
    </label>
  )
}

export function ScalarControl({
  label,
  scalar,
  min,
  max,
  step = 0.01,
  onChange
}: {
  label: string
  scalar: Scalar
  min: number
  max: number
  step?: number
  onChange: (s: Scalar) => void
}): JSX.Element {
  const playhead = useStore((s) => s.playhead)
  const value = evalScalar(scalar, playhead)
  const animated = isAnimated(scalar)
  const keyed = hasKeyAt(scalar, playhead)

  return (
    <div className="scalar-row">
      <span className="scalar-label" title={label}>
        {label}
      </span>
      <input
        className="scalar-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(setValueAt(scalar, playhead, parseFloat(e.target.value)))}
      />
      <input
        className="scalar-num"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(3))}
        onChange={(e) => onChange(setValueAt(scalar, playhead, parseFloat(e.target.value)))}
      />
      <button
        className={`diamond ${animated ? 'anim' : ''} ${keyed ? 'keyed' : ''}`}
        title={animated ? 'Toggle keyframe at playhead' : 'Animate (add keyframe)'}
        onClick={() => onChange(toggleKeyAt(scalar, playhead))}
      >
        ◆
      </button>
      {animated && (
        <button
          className="mini"
          title="Stop animating (bake to constant)"
          onClick={() => onChange(stopAnimating(scalar, playhead))}
        >
          ×
        </button>
      )}
    </div>
  )
}

export function ColorRow({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <Field label={label}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <input
        className="hex"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </Field>
  )
}
