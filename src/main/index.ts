import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename } from 'path'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import ffmpegPath from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'

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
      sandbox: false,
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
    shell.openExternal(details.url)
    return { action: 'deny' }
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

function registerIpc(): void {
  // Open a file via native dialog; return its path + bytes.
  ipcMain.handle('dialog:openFile', async (_e, opts: OpenFileOpts) => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: opts?.filters
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const path = res.filePaths[0]
    const data = await readFile(path)
    return { path, name: basename(path), data: new Uint8Array(data) }
  })

  // Read an arbitrary file by path.
  ipcMain.handle('file:read', async (_e, path: string) => {
    const data = await readFile(path)
    return { path, name: basename(path), data: new Uint8Array(data) }
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
      return res.filePath
    }
  )

  // Write bytes to a path.
  ipcMain.handle('file:write', async (_e, args: { path: string; data: Uint8Array }) => {
    await writeFile(args.path, Buffer.from(args.data))
    return { ok: true, path: args.path }
  })

  // Fallback encoder: write a batch of PNG frames to a temp dir, encode with bundled ffmpeg.
  // Frames are provided as an array of Uint8Array (PNG), indexed by their array order.
  ipcMain.handle(
    'ffmpeg:encodeFrames',
    async (
      _e,
      args: { frames: Uint8Array[]; fps: number; outputPath: string }
    ): Promise<{ ok: boolean; outputPath: string }> => {
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
            .setFfmpegPath((ffmpegPath as unknown as string) ?? 'ffmpeg')
            .input(join(dir, 'frame_%06d.png'))
            .inputFPS(args.fps)
            .videoCodec('libx264')
            .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-r', String(args.fps)])
            .save(args.outputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
        })
        return { ok: true, outputPath: args.outputPath }
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
