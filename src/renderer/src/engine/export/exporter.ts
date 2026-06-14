import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { Engine } from '../Engine'
import type { Project } from '../../types'

export interface ExportOptions {
  fps: number
  durationSec: number
  bitrate: number // bits per second
}

export interface ExportProgress {
  frame: number
  totalFrames: number
  encoder: 'webcodecs' | 'ffmpeg'
}

type ProgressFn = (p: ExportProgress) => void

// Pick an H.264 codec string the platform's VideoEncoder supports.
async function pickAvcCodec(width: number, height: number, fps: number): Promise<string | null> {
  const candidates = ['avc1.640028', 'avc1.4D4028', 'avc1.42E01E']
  const VE = (globalThis as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder
  if (!VE || !VE.isConfigSupported) return candidates[0]
  for (const codec of candidates) {
    try {
      const res = await VE.isConfigSupported({ codec, width, height, framerate: fps })
      if (res.supported) return codec
    } catch {
      /* try next */
    }
  }
  return null
}

async function encodeWithWebCodecs(
  engine: Engine,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  opts: ExportOptions,
  totalFrames: number,
  codec: string,
  onProgress: ProgressFn,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: opts.fps },
    fastStart: 'in-memory'
  })

  let encoderError: unknown = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e
    }
  })
  encoder.configure({
    codec,
    width,
    height,
    bitrate: opts.bitrate,
    framerate: opts.fps
  })

  const frameDurUs = 1_000_000 / opts.fps
  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) {
      encoder.close()
      throw new DOMException('Export cancelled', 'AbortError')
    }
    if (encoderError) throw encoderError
    engine.renderFrame(i / opts.fps)
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDurUs),
      duration: Math.round(frameDurUs)
    })
    encoder.encode(frame, { keyFrame: i % (opts.fps * 2) === 0 })
    frame.close()
    onProgress({ frame: i + 1, totalFrames, encoder: 'webcodecs' })
    // keep encoder queue from exploding & let the UI breathe
    if (encoder.encodeQueueSize > 8) {
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  }

  await encoder.flush()
  encoder.close()
  muxer.finalize()
  if (encoderError) throw encoderError
  return new Uint8Array(muxer.target.buffer)
}

async function captureFrames(
  engine: Engine,
  canvas: HTMLCanvasElement,
  opts: ExportOptions,
  totalFrames: number,
  onProgress: ProgressFn,
  signal?: AbortSignal
): Promise<Uint8Array[]> {
  const frames: Uint8Array[] = []
  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
    engine.renderFrame(i / opts.fps)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('Frame capture failed')
    frames.push(new Uint8Array(await blob.arrayBuffer()))
    onProgress({ frame: i + 1, totalFrames, encoder: 'ffmpeg' })
  }
  return frames
}

// Render the project deterministically and write an MP4 to outputPath.
export async function exportVideo(
  engine: Engine,
  project: Project,
  opts: ExportOptions,
  outputPath: string,
  onProgress: ProgressFn,
  signal?: AbortSignal
): Promise<{ encoder: 'webcodecs' | 'ffmpeg' }> {
  const { width, height } = project.output
  const totalFrames = Math.max(1, Math.round(opts.durationSec * opts.fps))
  const canvas = engine.getCanvas()
  engine.setOutputSize(width, height)

  const hasWebCodecs =
    typeof (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder !== 'undefined'
  const codec = hasWebCodecs ? await pickAvcCodec(width, height, opts.fps) : null

  if (codec) {
    try {
      const bytes = await encodeWithWebCodecs(
        engine,
        canvas,
        width,
        height,
        opts,
        totalFrames,
        codec,
        onProgress,
        signal
      )
      await window.api.writeFile(outputPath, bytes)
      return { encoder: 'webcodecs' }
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') throw e
      console.warn('WebCodecs export failed; falling back to ffmpeg.', e)
    }
  }

  // Fallback: capture PNG frames, encode with bundled ffmpeg in the main process.
  const frames = await captureFrames(engine, canvas, opts, totalFrames, onProgress, signal)
  await window.api.encodeFrames({ frames, fps: opts.fps, outputPath })
  return { encoder: 'ffmpeg' }
}
