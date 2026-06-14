import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { engine } from '../engine/engineSingleton'
import { totalDuration } from '../types'

function fmt(t: number): string {
  const s = Math.floor(t)
  const cs = Math.floor((t - s) * 100)
  return `${s}.${String(cs).padStart(2, '0')}s`
}

export function PreviewPanel(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const [playing, setPlaying] = useState(false)
  const total = totalDuration(project)

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
        <div className="canvas-frame" ref={containerRef} />
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
