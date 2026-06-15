import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { engine } from '../engine/engineSingleton'
import { totalDuration, constant } from '../types'
import { evalScalar, setValueAt } from './scalarUtils'

function fmt(t: number): string {
  const s = Math.floor(t)
  const cs = Math.floor((t - s) * 100)
  return `${s}.${String(cs).padStart(2, '0')}s`
}

export function PreviewPanel(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const project = useStore((s) => s.project)
  const update = useStore((s) => s.update)
  const playhead = useStore((s) => s.playhead)
  const [playing, setPlaying] = useState(false)
  const total = totalDuration(project)
  const hasImage = !!project.image.dataUrl

  // Drag over the preview to reposition the image's cover-fit window. Only the
  // overflowing axis responds (the fitted axis ignores its offset in-shader).
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (!useStore.getState().project.image.dataUrl) return
    dragRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const start = dragRef.current
    if (!start) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = (e.clientX - start.x) / rect.width
    const dy = (e.clientY - start.y) / rect.height
    dragRef.current = { x: e.clientX, y: e.clientY }
    const ph = useStore.getState().playhead
    const img = useStore.getState().project.image
    // Grab-and-drag: image content follows the cursor.
    const curX = evalScalar(img.offsetX ?? constant(0.5), ph)
    const curY = evalScalar(img.offsetY ?? constant(0.5), ph)
    const nextX = Math.min(1, Math.max(0, curX - dx))
    const nextY = Math.min(1, Math.max(0, curY + dy))
    update((p) => {
      p.image.offsetX = setValueAt(p.image.offsetX ?? constant(0.5), ph, nextX)
      p.image.offsetY = setValueAt(p.image.offsetY ?? constant(0.5), ph, nextY)
    })
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) return
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  useEffect(() => {
    if (containerRef.current && !containerRef.current.hasChildNodes()) {
      engine.mount(containerRef.current)
      engine.seekTo(useStore.getState().playhead)
    }
  }, [])

  const starts: number[] = []
  let acc = 0
  for (const seg of project.segments) {
    starts.push(acc)
    acc += seg.durationSec
  }

  function togglePlay(): void {
    if (engine.isPlaying) {
      engine.pause()
      setPlaying(false)
    } else {
      engine.play()
      setPlaying(true)
    }
  }

  return (
    <div className="preview">
      <div className="preview-stage">
        <div
          className={`canvas-frame${hasImage ? ' draggable' : ''}`}
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      <div className="transport">
        <button className="play" onClick={togglePlay}>
          {playing ? '⏸' : '▶'}
        </button>
        <span className="time">
          {fmt(playhead)} / {fmt(total)}
        </span>
        <div className="scrub-wrap">
          <div className="seg-track">
            {project.segments.map((seg, i) => (
              <div
                key={seg.id}
                className={`seg-mark ${seg.kind}`}
                style={{ left: `${(starts[i] / total) * 100}%`, width: `${(seg.durationSec / total) * 100}%` }}
                title={seg.label}
              />
            ))}
          </div>
          <input
            className="scrub"
            type="range"
            min={0}
            max={total}
            step={1 / 120}
            value={playhead}
            onChange={(e) => {
              if (engine.isPlaying) {
                engine.pause()
                setPlaying(false)
              }
              engine.seekTo(parseFloat(e.target.value))
            }}
          />
        </div>
      </div>
    </div>
  )
}
