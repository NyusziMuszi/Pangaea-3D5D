import { contextBridge, ipcRenderer } from 'electron'

interface OpenedFile {
  path: string
  name: string
  data: Uint8Array
}

const api = {
  openImageFile: (): Promise<OpenedFile | null> =>
    ipcRenderer.invoke('dialog:openFile', {
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    }),
  openModelFile: (): Promise<OpenedFile | null> =>
    ipcRenderer.invoke('dialog:openFile', {
      filters: [{ name: '3D Models', extensions: ['glb', 'gltf', 'obj'] }]
    }),
  openShaderFile: (): Promise<OpenedFile | null> =>
    ipcRenderer.invoke('dialog:openFile', {
      filters: [{ name: 'GLSL', extensions: ['glsl', 'frag', 'vert', 'txt'] }]
    }),
  openProjectFile: (): Promise<OpenedFile | null> =>
    ipcRenderer.invoke('dialog:openFile', {
      filters: [{ name: 'Pangaea Project', extensions: ['pangaea', 'json'] }]
    }),
  openFontFile: (): Promise<OpenedFile | null> =>
    ipcRenderer.invoke('dialog:openFile', {
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    }),
  readImagePath: (
    path: string
  ): Promise<{ ok: boolean; data?: Uint8Array; mime?: string; error?: string }> =>
    ipcRenderer.invoke('image:readPath', path),
  saveFileDialog: (opts: {
    defaultName?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null> => ipcRenderer.invoke('dialog:saveFile', opts),
  openDirectoryDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  writeFile: (path: string, data: Uint8Array): Promise<{ ok: boolean; path: string }> =>
    ipcRenderer.invoke('file:write', { path, data }),
  encodeFrames: (opts: {
    frames: Uint8Array[]
    fps: number
    outputPath: string
  }): Promise<{ ok: boolean; outputPath: string }> =>
    ipcRenderer.invoke('ffmpeg:encodeFrames', opts),
  // Read/write the app's persisted preferences blob (userData/preferences.json).
  // Read returns null when the file is missing or corrupt.
  readPreferences: (): Promise<unknown> => ipcRenderer.invoke('prefs:read'),
  writePreferences: (data: unknown): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('prefs:write', data)
}

contextBridge.exposeInMainWorld('api', api)

export type PangaeaApi = typeof api
