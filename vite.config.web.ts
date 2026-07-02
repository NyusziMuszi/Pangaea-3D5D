import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone (non-electron-vite) build that produces a fully static bundle for
// GitHub Pages. The renderer has no electron/node imports, so it builds and runs
// as a plain SPA; `window.api` is provided at runtime by src/platform/webApi.ts.
//
// `base` defaults to '/pangaea/' — a project Pages site is served under
// /<repo>/. Override with PANGAEA_BASE (e.g. '/') for a user/org page at the
// domain root. outDir is pinned to an absolute repo-root path so the Pages
// workflow can upload `dist-web` regardless of the renderer `root` above.
export default defineConfig({
  root: 'src/renderer',
  base: process.env.PANGAEA_BASE ?? '/pangaea/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@assets': resolve(__dirname, 'assets')
    }
  },
  // The shared assets/ dir lives above the renderer root; allow dev-server access.
  server: {
    fs: { allow: [resolve(__dirname)] }
  },
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true
  }
})
