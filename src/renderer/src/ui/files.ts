export function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'glb':
      return 'model/gltf-binary'
    case 'gltf':
      return 'model/gltf+json'
    case 'obj':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}

// Raw base64 (no data: prefix) — for embedding asset bytes in a saved project.
export function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function bytesToDataUrl(data: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

// Decode image bytes off the main thread and downscale to a small thumbnail,
// returning a blob: object URL. createImageBitmap decodes + resizes on a worker
// thread, so a grid of large (4K+) images never blocks the UI on full-res
// decodes. The caller owns the returned URL and must URL.revokeObjectURL it.
export async function makeThumbnailUrl(
  bytes: Uint8Array,
  mime: string,
  maxEdge = 320
): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so the Blob owns contiguous bytes
  // (a subarray view from IPC may sit inside a larger buffer).
  const blob = new Blob([bytes.slice()], { type: mime })
  // First decode at natural size to learn the dimensions, then compute a scaled
  // target so the longest edge is <= maxEdge (never upscale).
  const probe = await createImageBitmap(blob)
  const natW = probe.width
  const natH = probe.height
  const scale = Math.min(1, maxEdge / Math.max(natW, natH))
  const w = Math.max(1, Math.round(natW * scale))
  const h = Math.max(1, Math.round(natH * scale))
  probe.close()

  const bitmap = await createImageBitmap(blob, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: 'medium'
  })
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const out: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  )
  return URL.createObjectURL(out ?? blob)
}
