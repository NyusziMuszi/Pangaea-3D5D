import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { usePrefs, type Preferences } from './state/prefs'
import { defaultProject } from './state/defaults'
import { useStore } from './state/store'
import { installWebApi } from './platform/webApi'

// Under Electron, preload has already set window.api before this script runs. In
// a plain browser (the GitHub Pages build) it's undefined, so install the
// browser bridge now — before boot() awaits window.api.readPreferences().
if (!window.api) installWebApi()

// Hydrate persisted preferences from disk BEFORE the React app mounts, so the
// synchronous defaultProject() factory (and the very first project) already
// reflect the user's stored defaults. A missing/corrupt file reads as null and
// keeps the hard-coded base.
async function boot(): Promise<void> {
  try {
    const stored = (await window.api.readPreferences()) as Preferences | null
    usePrefs.getState().hydrate(stored)
  } catch {
    // Unreadable prefs — fall back to the base blueprint already seeded in store.
  }
  // Re-seed the initial project now that prefs are hydrated (store init ran at
  // module-eval, before the disk read, so it holds a base-derived project).
  useStore.getState().setProject(defaultProject())

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
