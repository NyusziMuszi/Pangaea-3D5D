// Browser implementation of the `window.api` bridge that Electron's preload
// normally provides. Under Electron, preload sets `window.api` before any
// renderer code runs and this module is never installed (main.tsx guards on it).
// In a plain browser (the GitHub Pages build) `window.api` is undefined, so
// `installWebApi()` fills it in with equivalent behaviour built from browser
// primitives: <input type="file"> for opens, anchor-download for writes, and
// localStorage for preferences.
//
// The object is typed against `PangaeaApi` (the exact shape preload exports) so
// this shim can't silently drift from the real bridge — any signature change in
// preload breaks the typecheck here. The import is type-only, so preload's
// `electron` dependency is never pulled into the web bundle.
import type { PangaeaApi } from '../../../preload/index'

// Return shape of the open* helpers. Structurally identical to preload's
// (unexported) OpenedFile; the PangaeaApi annotation below verifies the match.
type OpenedFile = { path: string; name: string; data: Uint8Array }

// Bytes picked for image assets, keyed by the synthetic `webfile:` handle we
// hand back as their "path". This mirrors main's on-disk image reads: the lucky
// presets in LibraryPanel store this handle and later call readImagePath() to
// get the bytes back. In-memory only, so handles don't survive a reload (see the
// session-scoped-presets limitation noted for the web build).
const handleStore = new Map<string, { bytes: Uint8Array; mime: string }>()

// Last path segment, splitting on both separators so it works regardless of
// which the stored name happens to use.
function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

// Open a hidden <input type="file"> with the given accept filter and resolve
// with the chosen File, or null if the picker was dismissed. The `cancel` event
// (Chromium/Firefox/Safari) covers dismissal; without it a cancelled pick would
// leave the promise hanging forever.
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let settled = false
    const finish = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    document.body.appendChild(input)
    input.click()
  })
}

// Shared open helper. `kind:'image'` stashes the bytes under a synthetic
// `webfile:` handle (so readImagePath can resolve them later) and returns that
// handle as the path; every other kind returns the plain file name as the path.
async function openFile(accept: string, kind: 'image' | 'other'): Promise<OpenedFile | null> {
  const file = await pickFile(accept)
  if (!file) return null
  const data = new Uint8Array(await file.arrayBuffer())
  if (kind === 'image') {
    const path = 'webfile:' + crypto.randomUUID()
    handleStore.set(path, { bytes: data, mime: file.type })
    return { path, name: file.name, data }
  }
  return { path: file.name, name: file.name, data }
}

// accept filters mirror the native dialog extension lists in src/preload/index.ts.
const api: PangaeaApi = {
  openImageFile: () => openFile('.png,.jpg,.jpeg,.webp,.bmp', 'image'),
  openModelFile: () => openFile('.glb,.gltf,.obj', 'other'),
  openShaderFile: () => openFile('.glsl,.frag,.vert,.txt', 'other'),
  openProjectFile: () => openFile('.pangaea,.json', 'other'),
  openFontFile: () => openFile('.ttf,.otf,.woff,.woff2', 'other'),

  readImagePath: async (path) => {
    const entry = handleStore.get(path)
    if (!entry) return { ok: false, error: 'Unknown handle: ' + path }
    return { ok: true, data: entry.bytes, mime: entry.mime }
  },

  // No native save dialog on the web. Return a synthetic path (the suggested
  // name) so the existing saveDialog -> writeFile two-call flow is untouched; the
  // real "where does it go" choice happens in the browser's download UI.
  saveFileDialog: async (opts) => opts.defaultName ?? 'project.pangaea',

  // No folder-access API on the web build. The image-sequence export needs
  // batch disk writes, which only the desktop app can grant via a real
  // directory-scoped dialog; callers check this flag to hide the option, and
  // openDirectoryDialog fails fast with an actionable message if one doesn't.
  canPickDirectory: false,
  openDirectoryDialog: () =>
    Promise.reject(new Error('Image-sequence export needs the desktop app (folder access).')),

  // Trigger a browser download of the bytes. `path` is the synthetic name from
  // saveFileDialog; the file downloads under its basename.
  writeFile: async (path, data) => {
    // .slice() copies into a fresh ArrayBuffer-backed view — the codebase's
    // idiom for satisfying BlobPart (Uint8Array may be SharedArrayBuffer-backed).
    const url = URL.createObjectURL(new Blob([data.slice()]))
    const a = document.createElement('a')
    a.href = url
    a.download = basename(path)
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Defer revocation so the download has certainly started before the URL dies.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { ok: true, path }
  },

  // The ffmpeg fallback lives in Electron's main process; there's no browser
  // equivalent. exporter.ts fails fast before reaching here when WebCodecs is
  // absent, but reject too in case something calls this directly.
  encodeFrames: () =>
    Promise.reject(new Error('In-browser MP4 export needs a Chromium-based browser.')),

  readPreferences: async () => {
    try {
      const raw = localStorage.getItem('pangaea:prefs')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },

  writePreferences: async (data) => {
    try {
      localStorage.setItem('pangaea:prefs', JSON.stringify(data))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

// Install the browser bridge. Call only when `window.api` is absent (i.e. not
// under Electron); main.tsx guards on that.
export function installWebApi(): void {
  window.api = api
}
