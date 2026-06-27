import { useEffect, useRef } from 'react'
import { getActiveObject, useActiveObject, useStore } from '../state/store'
import { engine } from '../engine/engineSingleton'
import { constant, type ObjectState, type Project } from '../types'
import { evalScalar, setValueAt } from './scalarUtils'

export function PreviewPanel(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  // Pointer-down position for tap detection — tracked regardless of image state
  // so a click can select an object even when panning isn't available.
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const update = useStore((s) => s.update)
  const selectObject = useStore((s) => s.selectObject)
  const selectSegment = useStore((s) => s.selectSegment)
  // The image being panned belongs to whichever object is selected.
  const activeObject = useActiveObject()
  const hasImage = !!activeObject?.image.assetId

  // Resolve the active object from the live store (drag handlers run outside the
  // render closure, so read the current selection each time). Undefined when the
  // scene has no objects.
  function liveActiveObject(p: Project): ObjectState | undefined {
    return getActiveObject(p, useStore.getState().selectedObjectIndex)
  }

  // Drag over the preview to reposition the image's cover-fit window. Only the
  // overflowing axis responds (the fitted axis ignores its offset in-shader).
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    downRef.current = { x: e.clientX, y: e.clientY }
    if (!liveActiveObject(useStore.getState().project)?.image.assetId) return
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
    const active = liveActiveObject(useStore.getState().project)
    if (!active) return
    const img = active.image
    // Grab-and-drag: image content follows the cursor.
    const curX = evalScalar(img.offsetX ?? constant(0.5), ph)
    const curY = evalScalar(img.offsetY ?? constant(0.5), ph)
    const nextX = Math.min(1, Math.max(0, curX - dx))
    const nextY = Math.min(1, Math.max(0, curY + dy))
    update((p) => {
      const o = liveActiveObject(p)
      if (!o) return
      o.image.offsetX = setValueAt(o.image.offsetX ?? constant(0.5), ph, nextX)
      o.image.offsetY = setValueAt(o.image.offsetY ?? constant(0.5), ph, nextY)
    })
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    // Tap (negligible movement since down) = pick an object on the canvas.
    const down = downRef.current
    downRef.current = null
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) {
      const rect = e.currentTarget.getBoundingClientRect()
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1
      // The text card is drawn on top, so check it first: a hit selects its
      // segment (showing the text inspector). Misses fall through to the object
      // beneath, mirroring how the scene is layered.
      const textSeg = engine.pickTextAt(ndcX, ndcY)
      if (textSeg != null) {
        selectSegment(textSeg)
      } else {
        const idx = engine.pickObjectAt(ndcX, ndcY)
        if (idx != null) {
          selectObject(idx)
          selectSegment(null)
        }
      }
    }
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
