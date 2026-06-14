/// <reference types="vite/client" />
import type { PangaeaApi } from '../../preload/index'

declare global {
  interface Window {
    api: PangaeaApi
  }
}

export {}
