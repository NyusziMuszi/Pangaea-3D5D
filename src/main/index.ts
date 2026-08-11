import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename, dirname, resolve } from 'path'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import ffmpegPath from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'

// Paths the user has explicitly chosen via a native open/save dialog this
// session. file:read / file:write / ffmpeg:encodeFrames are gated to this set
// so a compromised renderer can't read/write arbitrary disk locations.
const approvedPaths = new Set<string>()

// Directories the user has explicitly chosen via the folder-picker dialog this
// session (e.g. for a PNG-sequence export). file:write also accepts any path
// whose immediate parent is one of these — widened just enough to let a batch
// export write many files after a single directory pick, still dialog-gated.
const approvedDirs = new Set<string>()

// Image extension -> mime allowlist for image:readPath. The renderer's
// mimeForName isn't importable from main, so we mirror the picker's filters.
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

// Resolve a renderer-supplied path and reject anything not dialog-approved or
// still containing '..' after resolution.
function assertApproved(p: string): string {
  const resolved = resolve(p)
  if (resolved.includes('..')) throw new Error('Rejected path (traversal): ' + p)
  if (approvedPaths.has(resolved)) return resolved
  if (approvedDirs.has(dirname(resolved))) return resolved
  throw new Error('Rejected unapproved path: ' + p)
}

// ffmpeg-static resolves inside app.asar in production, but the binary is
// unpacked (see asarUnpack in package.json) and must be run from there.
function resolveFfmpeg(): string {
  const p = (ffmpegPath as unknown as string) ?? 'ffmpeg'
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p
}

let mainWindow: BrowserWindow | null = null

const SELFTEST = !!process.env.PANGAEA_SELFTEST

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Pangaea',
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // WebCodecs / OffscreenCanvas are available by default in Electron's Chromium.
      webgl: true,
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!SELFTEST) mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only hand http(s) URLs to the OS; ignore file:// and other schemes.
    try {
      const { protocol } = new URL(details.url)
      if (protocol === 'http:' || protocol === 'https:') shell.openExternal(details.url)
    } catch {
      // malformed URL — ignore
    }
    return { action: 'deny' }
  })

  // Block in-window navigation to anything that isn't the app's own origin.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    let allowed = false
    try {
      const target = new URL(url)
      allowed = devUrl ? target.origin === new URL(devUrl).origin : target.protocol === 'file:'
    } catch {
      allowed = false
    }
    if (!allowed) event.preventDefault()
  })

  const search = SELFTEST ? 'selftest=1' : undefined
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + (search ? `?${search}` : ''))
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}

interface OpenFileOpts {
  filters?: { name: string; extensions: string[] }[]
}

// The app's own settings file in the OS user-data dir. This path is fixed and
// app-owned (never renderer-supplied), so it is deliberately NOT subject to the
// approvedPaths dialog gating that protects arbitrary file reads/writes.
const PREFS_PATH = join(app.getPath('userData'), 'preferences.json')

function registerIpc(): void {
  // The self-test harness writes to fixed /tmp paths without a dialog; approve
  // them up front so the gating doesn't break PANGAEA_SELFTEST runs.
  if (SELFTEST) {
    approvedPaths.add(resolve('/tmp/pangaea-selftest.mp4'))
    approvedPaths.add(resolve('/tmp/pangaea-selftest.status'))
  }

  // Read the persisted preferences blob. Missing or corrupt file → null, so the
  // renderer falls back to the hard-coded base defaults (no migration layer).
  ipcMain.handle('prefs:read', async () => {
    try {
      return JSON.parse(await readFile(PREFS_PATH, 'utf8'))
    } catch {
      return null
    }
  })

  // Flush the preferences blob to disk (pretty-printed for hand-editing / backup).
  ipcMain.handle('prefs:write', async (_e, data: unknown) => {
    await writeFile(PREFS_PATH, JSON.stringify(data, null, 2))
    return { ok: true }
  })

  // Open a file via native dialog; return its path + bytes.
  ipcMain.handle('dialog:openFile', async (_e, opts: OpenFileOpts) => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: opts?.filters
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const path = res.filePaths[0]
    approvedPaths.add(resolve(path))
    const data = await readFile(path)
    return { path, name: basename(path), data: new Uint8Array(data) }
  })

  // Read a file by path — only if it was dialog-approved this session.
  ipcMain.handle('file:read', async (_e, path: string) => {
    const resolved = assertApproved(path)
    const data = await readFile(resolved)
    return { path: resolved, name: basename(resolved), data: new Uint8Array(data) }
  })

  // Read an image by path WITHOUT dialog-approval gating. This is the one
  // deliberate, user-approved relaxation of the read sandbox: it lets
  // "Feeling lucky" presets (which store absolute file paths) resolve to bytes
  // after reopening a saved project, without forcing the user to re-pick each
  // file via dialog. To bound that relaxation, reads are restricted to known
  // image extensions (defense-in-depth) and traversal paths are rejected.
  ipcMain.handle('image:readPath', async (_e, path: string) => {
    try {
      const resolved = resolve(path)
      if (resolved.includes('..')) return { ok: false, error: 'Rejected path (traversal)' }
      const ext = resolved.slice(resolved.lastIndexOf('.')).toLowerCase()
      const mime = IMAGE_MIME[ext]
      if (!mime) return { ok: false, error: 'Not an image path: ' + path }
      const data = await readFile(resolved)
      return { ok: true, data: new Uint8Array(data), mime }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Save dialog -> chosen path (or null).
  ipcMain.handle(
    'dialog:saveFile',
    async (_e, opts: { defaultName?: string; filters?: OpenFileOpts['filters'] }) => {
      const res = await dialog.showSaveDialog({
        defaultPath: opts?.defaultName,
        filters: opts?.filters
      })
      if (res.canceled || !res.filePath) return null
      approvedPaths.add(resolve(res.filePath))
      return res.filePath
    }
  )

  // Folder-picker for batch exports (e.g. PNG sequence). Approves the chosen
  // directory so file:write can accept any filename written directly inside it.
  ipcMain.handle('dialog:openDirectory', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const path = res.filePaths[0]
    approvedDirs.add(resolve(path))
    return path
  })

  // Write bytes to a path — only if it was dialog-approved this session.
  ipcMain.handle('file:write', async (_e, args: { path: string; data: Uint8Array }) => {
    const resolved = assertApproved(args.path)
    await writeFile(resolved, Buffer.from(args.data))
    return { ok: true, path: resolved }
  })

  // Fallback encoder: write a batch of PNG frames to a temp dir, encode with bundled ffmpeg.
  // Frames are provided as an array of Uint8Array (PNG), indexed by their array order.
  ipcMain.handle(
    'ffmpeg:encodeFrames',
    async (
      _e,
      args: { frames: Uint8Array[]; fps: number; outputPath: string }
    ): Promise<{ ok: boolean; outputPath: string }> => {
      const outputPath = assertApproved(args.outputPath)
      const dir = join(tmpdir(), `pangaea-${Date.now()}`)
      await mkdir(dir, { recursive: true })
      try {
        await Promise.all(
          args.frames.map((f, i) =>
            writeFile(join(dir, `frame_${String(i).padStart(6, '0')}.png`), Buffer.from(f))
          )
        )
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .setFfmpegPath(resolveFfmpeg())
            .input(join(dir, 'frame_%06d.png'))
            .inputFPS(args.fps)
            .videoCodec('libx264')
            .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-r', String(args.fps)])
            .save(outputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
        })
        return { ok: true, outputPath }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
  )
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
