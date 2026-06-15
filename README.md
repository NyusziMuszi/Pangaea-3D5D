# Pangaea

A macOS desktop app for creating **1080×1350 Instagram videos** by animating a single image
through shaders, deformers and 3D models, interleaved with three full-screen colored text cards:

```
Animation (intro) → Text 1 → Animation (continues) → Text 2 → Animation (concludes) → Closing text
```

Built with **Electron + React + Three.js (TypeScript)**.

This README is written for engineers/agents picking up development. It explains how to run the
app, how the pieces fit together, the invariants you must preserve, and exactly where to add new
features. The original product spec lives at
`~/.claude/plans/i-want-to-create-gentle-yao.md`.

---

## Status

Working and verified end-to-end. A headless self-test renders an image through a deformer and
exports a valid file; `ffmpeg` confirms `h264 (High) yuv420p, 1080x1350, 30 fps`.

| Area | State |
|---|---|
| Electron shell + IPC file I/O | ✅ |
| Time-pure render engine (preview + export share one path) | ✅ |
| Effect stack (GLSL chunk injection) + built-in catalog | ✅ |
| Subject modes: plane / 3D model / particles | ✅ |
| 6-segment timeline + colored text cards | ✅ |
| Keyframes + easing on every scalar property | ✅ (diamond toggles; **no bezier curve editor yet**) |
| In-app GLSL editor (live recompile, uniform auto-UI) | ✅ (plain textarea, **not Monaco yet**) |
| Export: WebCodecs H.264 → mp4-muxer, ffmpeg fallback | ✅ |
| Project save/load (`.pangaea` JSON, embedded assets) | ✅ |
| Packaging to `.dmg` (electron-builder) | configured, not exercised |

See [Known limitations & roadmap](#known-limitations--roadmap) for what's intentionally missing.

---

## Run / build / verify

```bash
npm install
npm run dev          # dev server + Electron with HMR
npm run build        # production bundle into out/  (also the type-check gate via build)
npm run typecheck    # tsc on node-side and web-side projects
npm run dist         # electron-builder → macOS .dmg
```

### ⚠️ Environment gotcha: `ELECTRON_RUN_AS_NODE`

This dev environment has `ELECTRON_RUN_AS_NODE=1` exported. That makes Electron start as plain
Node, so `require('electron')` returns a path string and the app crashes with
`Cannot read properties of undefined (reading 'whenReady')`. Always launch with it unset:

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

### Headless self-test (automated verification)

There is a self-test path for verifying the render→export pipeline without clicking the GUI.
Setting `PANGAEA_SELFTEST=1` makes the main process keep the window hidden and load the renderer
with `?selftest=1`; [src/renderer/src/ui/selftest.ts](src/renderer/src/ui/selftest.ts) then builds
a procedural image, applies a ripple deformer, and exports `/tmp/pangaea-selftest.mp4`, writing
`OK`/`FAIL` to `/tmp/pangaea-selftest.status`.

```bash
npm run build
env -u ELECTRON_RUN_AS_NODE PANGAEA_SELFTEST=1 npx electron . --enable-logging=stderr
# then: cat /tmp/pangaea-selftest.status
#       "$(node -p "require('ffmpeg-static')")" -i /tmp/pangaea-selftest.mp4   # inspect codec/size
```

The self-test launches a hidden, never-quitting process — kill it by PID when done
(`pkill` on `Electron` would also kill your VS Code; don't).

---

## Architecture at a glance

Three layers; the engine is deliberately decoupled from React.

```
Electron main/preload  ──IPC──►  Renderer (React UI) ──►  Engine (plain Three.js)
  file dialogs, read/write,         zustand Project store,    deterministic renderFrame(t),
  bundled ffmpeg fallback           panels, controls          effects, timeline, export
```

**Key decision:** the engine uses **plain Three.js**, not React-Three-Fiber. R3F's `useFrame`
render loop fights frame-accurate, deterministic, on-demand rendering, which the offline exporter
depends on. React only renders the editor chrome and pushes the `Project` into the engine.

### Directory map

```
src/
  main/index.ts            Electron main: window, IPC (open/read/save/write, ffmpeg:encodeFrames)
  preload/index.ts         contextBridge → window.api (typed in index.d.ts)
  renderer/
    index.html             CSP + root
    src/
      types.ts             Project data model + Scalar/Keyframe types  ← read this first
      state/
        defaults.ts        defaultProject(), instanceFromDef(), uid()
        store.ts           zustand store: project + selection + toast/shaderError; update(mutator)
      engine/
        Engine.ts          THE core: scene/camera/subject/overlay, reconcile, renderFrame(t), playback
        engineSingleton.ts single Engine instance (creates the WebGL context at import)
        animatable.ts      evalScalar(scalar, t) — keyframe interpolation + easing
        timeline.ts        computeTimeline(project, t) — active segment, scene clock, card opacity
        textOverlay.ts     renderTextCard() → canvas; TextOverlay fullscreen quad
        loaders.ts         loadImage(), loadModelGeometry() (glb/gltf/obj)
        effects/
          catalog.ts       BUILTIN_EFFECTS (EffectDef[]) + findEffectDef()
          composer.ts      composeSubjectShader() — stacks GLSL chunks into one ShaderMaterial
          particle.ts      particle ShaderMaterial + buildParticleGeometry()
        export/
          exporter.ts      exportVideo() — WebCodecs primary, ffmpeg fallback
      ui/                  React panels + controls (see UI section)
```

---

## Core concepts (invariants — don't break these)

### 1. The engine is a pure function of time

`Engine.renderFrame(t)` ([Engine.ts](src/renderer/src/engine/Engine.ts)) evaluates the entire
project at absolute timeline time `t` (seconds) and renders exactly one frame. It must stay
**deterministic**:

- All animated values come from `evalScalar(scalar, t)`. No `Date.now()`, no `performance.now()`,
  no per-frame `Math.random()` inside rendering.
- Shaders animate via the `uTime` uniform, which is set to `timeline.sceneTime` (not wall-clock).
- Particle randomness is **precomputed** as a seeded `aSeed` attribute, never sampled per frame.

Preview playback (`play()`) advances a playhead with real `dt` and calls `renderFrame`, but the
**exporter** ([exporter.ts](src/renderer/src/engine/export/exporter.ts)) steps `t = frame / fps`,
so the output is frame-exact regardless of machine speed. If you add a feature, route its
time-dependence through `t` or it will desync between preview and export.

> Note: render determinism (pixels) is guaranteed; *encoded MP4 bytes* may differ run-to-run when
> the platform uses a hardware H.264 encoder (VideoToolbox on macOS). Don't assert byte-identity.

### 2. Scalars and keyframes

Every animatable number is a `Scalar` ([types.ts](src/renderer/src/types.ts)):

```ts
type Scalar = { kind: 'const'; value: number } | { kind: 'keys'; keys: Keyframe[] }
```

`evalScalar` interpolates between keyframes with per-keyframe easing
(`linear|easeIn|easeOut|easeInOut|hold`). UI keyframing helpers live in
[ui/scalarUtils.ts](src/renderer/src/ui/scalarUtils.ts) (`toggleKeyAt`, `setValueAt`,
`startAnimating`, `stopAnimating`). The `<ScalarControl>` component renders the slider + the
◆ diamond that adds/removes a keyframe at the current playhead.

### 3. The effect module contract + composer

An effect is an `EffectDef`: a GLSL snippet plus declared uniforms.

- **deform** effects implement the body of `vec3 deform(vec3 pos, vec3 normal, vec2 uv, float t)`
  (vertex stage) and must `return pos;`.
- **shade** effects implement the body of `vec4 shade(vec4 color, vec2 uv, float t)` (fragment
  stage) and must `return color;`.

[composer.ts](src/renderer/src/engine/effects/composer.ts) `composeSubjectShader(effects, mapping)`
concatenates all enabled deform/shade chunks into one `ShaderMaterial`, chaining outputs in stack
order. Authors write **plain** uniform names (`uAmplitude`); the composer:

- declares each uniform namespaced as `u_<sanitizedInstanceId>_<name>`,
- injects local aliases at the top of each function so the body reads naturally,
- dedupes `glslCommon` blocks (e.g. shared noise),
- always provides `uTime`, `uTexture` (sampler2D), `uResolution` (vec2), and the varyings
  `vUv`, `vWorldPos`, `vWorldNormal`. Triplanar sampling is enabled by a `USE_TRIPLANAR` define.

**Material rebuild vs. uniform update** — performance-critical distinction in `Engine`:
- The material is rebuilt **only when `composed.signature` changes** (mapping, stack order/ids/kinds,
  or any GLSL body — so live shader edits and reordering recompile).
- Changing a uniform *value* does **not** rebuild; `renderFrame` updates `material.uniforms[key].value`
  each frame via `valueOf(instanceId, name, def, t)`.

GLSL compile errors are surfaced through `Engine.onShaderError` (wired to
`renderer.debug.onShaderError`) and shown in the shader editor.

### 4. Subject modes

`Engine.reconcileSubject()` rebuilds geometry when `subjectSig` changes
(`mode|primitive|model?|mapping|density|imageReady`):
- `plane` — subdivided `PlaneGeometry`, the canvas for deformers.
- `model` — a primitive (sphere/cylinder/torus/box/plane) **or** an imported glb/gltf/obj
  (dominant mesh, normalized; UV or **triplanar** mapping for un-UV'd meshes). Uses the composed
  ShaderMaterial, so deformers/shaders apply to it too.
- `particles` — image sampled into a colored point cloud; uses the separate particle material
  with its own controls on `subject.particle` (also `Scalar`s, also keyframeable).

### 5. Timeline & text cards

[timeline.ts](src/renderer/src/engine/timeline.ts) `computeTimeline` returns the active segment,
the **scene clock** (`continue` = global time, or `hold` = animation-only time, frozen during
cards), and the active text card's opacity (fade/cut). Text cards are opaque full-frame WebGL
quads ([textOverlay.ts](src/renderer/src/engine/textOverlay.ts)) drawn over the scene, so the
export captures them. Structure is fixed at **3 animation + 3 text** segments (per the spec).

### 6. State flow

A single `Project` lives in the zustand store ([state/store.ts](src/renderer/src/state/store.ts)).
Mutations go through `update(mutator)`, which `structuredClone`s the project, applies the mutator,
and sets new state (cheap, avoids deep-immutable boilerplate). [App.tsx](src/renderer/src/App.tsx)
subscribes and calls `engine.setProject(project)` on every change, re-rendering the current frame
when paused. The `Project` is the entire serializable `.pangaea` file; assets (image, model) are
embedded as **data URLs** so a project is one portable JSON.

---

## UI map

- [TopBar.tsx](src/renderer/src/ui/TopBar.tsx) — New / Open / Save / Export.
- [LibraryPanel.tsx](src/renderer/src/ui/LibraryPanel.tsx) — image, subject mode/primitive/mapping/
  model import, effect catalog (Add), `+ Shader` (author custom).
- [PreviewPanel.tsx](src/renderer/src/ui/PreviewPanel.tsx) — mounts the engine canvas (aspect-locked
  1080/1350), transport (play/scrub), segment ticks.
- [TimelinePanel.tsx](src/renderer/src/ui/TimelinePanel.tsx) — segment regions (select) + the
  ordered effect stack (enable/reorder/remove).
- [InspectorPanel.tsx](src/renderer/src/ui/InspectorPanel.tsx) — context-sensitive: selected
  effect's uniforms, selected segment/text props, plus Subject / Camera / Scene sections.
- [ShaderEditorModal.tsx](src/renderer/src/ui/ShaderEditorModal.tsx) — GLSL body editor + uniform
  list editor; recompiles live, shows compile errors.
- [ExportDialog.tsx](src/renderer/src/ui/ExportDialog.tsx) — fps/duration/quality, progress, cancel.
- [controls.tsx](src/renderer/src/ui/controls.tsx) — `Section`, `Field`, `ScalarControl`, `ColorRow`.

---

## How to extend (recipes)

**Add a built-in deformer** — append an `EffectDef` to `BUILTIN_EFFECTS` in
[catalog.ts](src/renderer/src/engine/effects/catalog.ts): set `kind: 'deform'`, list `uniforms`
(they auto-generate Inspector sliders), and write `glslDeform` (a body that returns a modified
`pos`). Shared helpers go in `glslCommon`. Nothing else to wire — it appears in the Library.

**Add a fragment/stylize effect** — same, with `kind: 'shade'` and `glslShade` returning a
modified `color`. (The post-FX catalog is intentionally thin; this is the place to grow it.)

**Add a uniform type** — currently uniforms are scalar `float` only. To support color/vec
uniforms you'd extend `UniformDef`, the composer's declaration/alias generation, `valueOf`, and a
new control in `controls.tsx`.

**Add a subject mode** — extend `SubjectMode` in types, add a branch in `Engine.rebuildSubject()`,
and include the discriminator in `subjectSig`.

**Add output sizes** — `output.width/height` already flow through the engine and exporter; the
renderer is resolution-agnostic. Add a picker in the Export dialog / project settings and the
preview's `aspect-ratio` CSS. (Spec scoped v1 to 1080×1350 only.)

**Swap the code editor to Monaco** — replace the textarea in `ShaderEditorModal`. Note Monaco
needs local worker bundling under Electron (CSP-friendly, offline); the textarea avoids that.

---

## Conventions

- TypeScript `strict`; keep `npm run typecheck` clean (it's the CI gate alongside `npm run build`).
- Mutate state only via `store.update(mutator)`. Never mutate `project` in place.
- Keep `Engine` free of React imports. UI talks to it via the `engineSingleton` and the store.
- Anything time-dependent must derive from the `t` passed to `renderFrame` (see invariant #1).
- IDs are random (`uid()`); they're structural, not time-based, so they don't affect determinism.

---

## Known limitations & roadmap

- **Keyframe curve editor** — only diamonds + easing presets exist; no draggable bezier graph.
- **Image aspect ratio (requested next)** — images are currently mapped onto the plane/geometry
  and can stretch. Desired behavior: respect the source aspect ratio, fit to **1350px height**,
  leave width intact and **crop horizontally** to the 1080 frame, and let the user **drag the
  image to reposition** the crop. Likely touches: the plane subject sizing + a UV/texture-offset
  transform driven by a new `image.offset`/`fit` field on the `Project`, plus a drag handler over
  the preview. (UV offset keeps it deterministic and keyframeable.)
- **3D model import** uses the single dominant mesh, not a full multi-mesh merge; complex models
  lose secondary meshes. Triplanar covers models without UVs.
- **Uniforms are float-only** (no color/vec2/vec3 uniform types yet).
- **Post-FX catalog is minimal** (desaturate) — geometry/3D/particles were the v1 focus.
- **No audio** (v1 scope). Exporter's ffmpeg fallback is the natural place to add audio muxing.
- **Encoded-byte determinism** is not guaranteed (hardware encoder); render determinism is.
- **Monaco** editor and **.dmg packaging** are configured/stubbed but not yet hardened.
