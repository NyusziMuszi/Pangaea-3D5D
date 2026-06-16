import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { engine } from '../engine/engineSingleton'
import { constant } from '../types'
import { evalScalar, setValueAt } from './scalarUtils'

export function PreviewPanel(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const project = useStore((s) => s.project)
  const update = useStore((s) => s.update)
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
    </div>
  )
}
