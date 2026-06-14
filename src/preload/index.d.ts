import type { PangaeaApi } from './index'

declare global {
  interface Window {
    api: PangaeaApi
  }
}

export {}
