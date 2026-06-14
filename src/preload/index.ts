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
  readFile: (path: string): Promise<OpenedFile> => ipcRenderer.invoke('file:read', path),
  saveFileDialog: (opts: {
    defaultName?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null> => ipcRenderer.invoke('dialog:saveFile', opts),
  writeFile: (path: string, data: Uint8Array): Promise<{ ok: boolean; path: string }> =>
    ipcRenderer.invoke('file:write', { path, data }),
  encodeFrames: (opts: {
    frames: Uint8Array[]
    fps: number
    outputPath: string
  }): Promise<{ ok: boolean; outputPath: string }> =>
    ipcRenderer.invoke('ffmpeg:encodeFrames', opts)
}

contextBridge.exposeInMainWorld('api', api)

export type PangaeaApi = typeof api
