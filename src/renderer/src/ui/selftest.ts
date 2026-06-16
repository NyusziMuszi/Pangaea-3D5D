import { useStore } from '../state/store'
import { engine } from '../engine/engineSingleton'
import { BUILTIN_EFFECTS } from '../engine/effects/catalog'
import { instanceFromDef } from '../state/defaults'
import { constant } from '../types'
import { exportVideo } from '../engine/export/exporter'

// Headless end-to-end check: build a procedural image, apply a deformer,
// export a short MP4, and report the result to a status file the harness reads.
export async function runSelfTest(): Promise<void> {
  const log = (m: string): void => console.log(`[SELFTEST] ${m}`)
  try {
    log('starting')
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 640
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 512, 640)
    g.addColorStop(0, '#ff5d8f')
    g.addColorStop(1, '#6c7bff')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 640)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 90px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('TEST', 256, 340)
    const dataUrl = c.toDataURL('image/png')

    const ripple = BUILTIN_EFFECTS.find((e) => e.id === 'ripple')!
    useStore.getState().update((p) => {
      p.object.image = { name: 'selftest.png', dataUrl, offsetX: constant(0.5), offsetY: constant(0.5) }
      p.object.effects = [instanceFromDef(ripple)]
      // shorten for a fast test: 6 segments x 1s
      p.segments.forEach((s) => (s.durationSec = 1))
    })

    // let the engine load the texture + (re)build the object
    await new Promise((r) => setTimeout(r, 1000))

    const project = useStore.getState().project
    const out = '/tmp/pangaea-selftest.mp4'
    const { encoder } = await exportVideo(
      engine,
      project,
      { fps: 30, durationSec: 2, bitrate: 8_000_000 },
      out,
      (pr) => {
        if (pr.frame % 15 === 0) log(`frame ${pr.frame}/${pr.totalFrames} (${pr.encoder})`)
      }
    )
    log(`OK encoder=${encoder} path=${out}`)
    await window.api.writeFile(
      '/tmp/pangaea-selftest.status',
      new TextEncoder().encode(`OK encoder=${encoder}`)
    )
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    log(`FAIL ${msg}`)
    await window.api
      .writeFile('/tmp/pangaea-selftest.status', new TextEncoder().encode(`FAIL ${msg}`))
      .catch(() => undefined)
  }
}
