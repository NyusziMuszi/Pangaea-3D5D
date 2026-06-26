import { Engine } from './Engine'

// One renderer/WebGL context for the whole app.
export const engine = new Engine()

// Dev-only: expose the singleton on window so the DevTools console can inspect
// it, e.g. `engine.renderer.info.memory` to watch texture/geometry counts.
if (import.meta.env.DEV) {
  ;(window as unknown as { engine: Engine }).engine = engine
}
