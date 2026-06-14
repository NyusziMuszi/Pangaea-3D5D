# Pangaea

Create **1080×1350 Instagram videos** by animating a single image through shaders, deformers
and 3D models, interleaved with full-screen colored text cards.

```
Animation (intro) → Text 1 → Animation (continues) → Text 2 → Animation (concludes) → Closing text
```

Built with **Electron + React + Three.js (TypeScript)**. The render engine is *time-pure*
(`engine.renderFrame(t)` is a deterministic function of time), so the live preview and the
offline frame-by-frame export run the exact same path and two exports are identical.

## Run

```bash
npm install
npm run dev        # launch the app (dev server + Electron)
npm run build      # type-check-free production build into out/
npm run dist       # build a macOS .dmg (electron-builder)
```

> If `require('electron')` errors with `Cannot read properties of undefined`, the shell has
> `ELECTRON_RUN_AS_NODE=1` set. Launch with `env -u ELECTRON_RUN_AS_NODE npm run dev`.

## How it works

- **Engine** (`src/renderer/src/engine/`) — framework-agnostic Three.js core.
  - `Engine.ts` — renderer (1080×1350 buffer), scene, camera, subject, text overlay, playback.
  - `effects/composer.ts` — stacks GLSL effect chunks into one `ShaderMaterial` (per-instance
    namespaced uniforms; authors write plain names like `uAmplitude`).
  - `effects/catalog.ts` — built-in deformers (ripple, wave, image-displace, twist, bulge,
    noise-warp) + stylize passes (desaturate, vignette).
  - `effects/particle.ts` — image → colored point cloud with dissolve/explode/swirl.
  - `subject modes` — `plane` (subdivided, for deformers), `model` (primitive or imported
    glb/gltf/obj, UV or triplanar mapping), `particles`.
  - `timeline.ts` — fixed 6-segment backbone; resolves active segment, scene clock
    (continue/hold during cards) and text-card opacity.
  - `animatable.ts` — keyframe evaluation with easing. Every uniform / camera / transform is a
    `Scalar` = constant **or** keyframes.
  - `export/exporter.ts` — deterministic render → **WebCodecs H.264 + mp4-muxer**, with a
    bundled-**ffmpeg** fallback (frames piped to the main process).

- **UI** (`src/renderer/src/ui/`) — Library (image / subject / effect catalog), Preview +
  transport, Timeline (segments + effect stack), Inspector (context-sensitive properties with
  keyframe diamonds), Shader Editor (live GLSL with compile-error reporting + uniform editor),
  Export dialog.

- **State** (`src/renderer/src/state/`) — a single zustand `Project` (the serializable
  `.pangaea` JSON; assets embedded as data URLs).

- **Electron** (`src/main`, `src/preload`) — file dialogs, read/write, ffmpeg fallback over IPC.

## Keyframing

In the Inspector, every slider has a **◆** diamond. Click it to start animating (adds a keyframe
at the playhead); move the playhead and change the value to add more. The diamond turns pink when
a keyframe exists at the current time. `×` bakes back to a constant.

## Authoring shaders

Library → **+ Shader** creates a custom effect and opens the editor. Write the body of
`deform(vec3 pos, vec3 normal, vec2 uv, float t)` (vertex) or `shade(vec4 color, vec2 uv, float t)`
(fragment), declare uniforms (they become Inspector sliders), and the material hot-recompiles.
Compile errors show inline.
