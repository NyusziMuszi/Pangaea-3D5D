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

// File System Access API surface this shim uses. Not in the project's TS lib
// (WICG spec, Chromium-only), so declared minimally here rather than pulling
// in a @types package for three members.
interface FileSystemWritableFileStream {
  write(data: BufferSource | Blob): Promise<void>
  close(): Promise<void>
}
interface FileSystemFileHandle {
  name: string
  createWritable(): Promise<FileSystemWritableFileStream>
}
declare global {
  interface Window {
    showSaveFilePicker?: (opts: {
      suggestedName?: string
      types?: { description: string; accept: Record<string, string[]> }[]
    }) => Promise<FileSystemFileHandle>
  }
}

// Real save-location picker, where the browser has one. Firefox/Safari lack
// it, so saveFileDialog falls back to the synthetic-name + anchor-download
// path below.
const hasSavePicker = typeof window !== 'undefined' && 'showSaveFilePicker' in window

// Handles from a successful showSaveFilePicker, keyed by suggested name (the
// same string saveFileDialog returns as the synthetic "path"). writeFile pops
// the entry it matches — one-shot, so a stale handle can't hijack a later
// same-named write.
const saveHandles = new Map<string, FileSystemFileHandle>()

// Chrome requires a MIME key on `accept`; only the extensions this app's save
// dialogs actually offer need an entry.
function mimeFor(ext: string): string {
  switch (ext) {
    case 'mp4':
      return 'video/mp4'
    case 'png':
      return 'image/png'
    default:
      return 'application/octet-stream'
  }
}

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

  // Where the File System Access API exists, ask for a real save location and
  // stash the resulting handle under its suggested name; writeFile looks it up
  // by that same name. Elsewhere, fall back to a synthetic path (the suggested
  // name) so the existing saveDialog -> writeFile two-call flow is untouched —
  // the real "where does it go" choice happens in the browser's download UI.
  saveFileDialog: async (opts) => {
    const defaultName = opts.defaultName ?? 'project.pangaea'
    if (!hasSavePicker) return defaultName
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: defaultName,
        types: opts.filters?.map((f) => ({
          description: f.name,
          accept: { [mimeFor(f.extensions[0])]: f.extensions.map((e) => '.' + e) }
        }))
      })
      saveHandles.set(handle.name, handle)
      return handle.name
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null
      throw err
    }
  },

  canPickSaveLocation: hasSavePicker,

  // No folder-access API on the web build. The image-sequence export needs
  // batch disk writes, which only the desktop app can grant via a real
  // directory-scoped dialog; callers check this flag to hide the option, and
  // openDirectoryDialog fails fast with an actionable message if one doesn't.
  canPickDirectory: false,
  openDirectoryDialog: () =>
    Promise.reject(new Error('Image-sequence export needs the desktop app (folder access).')),

  // Write through the handle saveFileDialog obtained via showSaveFilePicker,
  // if there is one for this path; otherwise fall back to a browser download.
  // `path` is the (synthetic, in the fallback case) name from saveFileDialog;
  // the download uses its basename.
  writeFile: async (path, data) => {
    const handle = saveHandles.get(basename(path))
    if (handle) {
      saveHandles.delete(handle.name)
      const w = await handle.createWritable()
      await w.write(data.slice())
      await w.close()
      return { ok: true, path }
    }
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
