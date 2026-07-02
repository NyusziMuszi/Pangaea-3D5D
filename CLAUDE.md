# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Pangaea is a macOS Electron app for creating 1080×1350 Instagram videos: a single image animated
through shaders/3D/deformers, interleaved with 3 full-screen colored text cards (fixed structure:
3 animation segments + 3 text segments). Electron + React + Three.js (TypeScript), zustand for state.

**[README.md](README.md) is written for engineers/agents and is the primary architecture doc —
read it before making non-trivial changes.** This file summarizes the parts most load-bearing for
day-to-day edits; README has the full picture (UI map, extension recipes, roadmap).

## Commands

```bash
npm install
npm run dev          # dev server + Electron with HMR
npm run build        # production bundle into out/
npm run typecheck    # tsc on node-side + web-side projects — the CI gate, must stay clean
npm run dist         # electron-builder → macOS .dmg (see PACKAGING.md for signing/asar gotchas)
```

There is no automated test suite (no `*.test.*` files, no test runner configured). Verification is
manual (`npm run dev`) or via the headless self-test below.

**Environment gotcha:** this dev environment has `ELECTRON_RUN_AS_NODE=1` exported, which makes
`require('electron')` return a path string instead of the API and crashes the app. Always unset it:

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

**Headless self-test** (verifies the render→export pipeline without the GUI): set
`PANGAEA_SELFTEST=1` so main keeps the window hidden and loads `?selftest=1`; see
[src/renderer/src/ui/selftest.ts](src/renderer/src/ui/selftest.ts).

```bash
npm run build
env -u ELECTRON_RUN_AS_NODE PANGAEA_SELFTEST=1 npx electron . --enable-logging=stderr
cat /tmp/pangaea-selftest.status   # OK or FAIL
```
This launches a hidden, never-quitting process — kill it by PID when done (don't `pkill Electron`,
it also kills VS Code).

## Verifying changes cheaply (token budget)

Prefer the cheapest verification that gives confidence, and **offload verification to the user
whenever they can confirm it faster than I can.** Builds, headless self-tests, and screenshot loops
burn a lot of tokens — don't reach for them by default.

- After a change, if the user can confirm it with a quick glance in the already-running `npm run dev`
  window (a visual check, a value in the DevTools console, a `console.log` I add), **say so and let
  them verify** instead of spinning up a build or self-test myself. Tell them exactly what to look
  for ("you should see X in the console / the panel should now show Y").
- When a one-line `console.log` (or temporary debug line) would let the user confirm the behaviour in
  seconds, propose adding it rather than reasoning at length or running the pipeline. Remember to
  remove temporary debug lines afterward.
- Lean on `npm run typecheck` (fast, deterministic) as the primary automated gate; reserve
  `npm run build` and the headless self-test for changes that actually touch the render→export
  pipeline or that the user can't easily eyeball.
- When more than one path forward exists, briefly state the cheap-to-verify option first and
  recommend it, so the user can pick before I spend tokens.

## Architecture

Three layers, deliberately decoupled:

```
Electron main/preload  ──IPC──►  Renderer (React UI) ──►  Engine (plain Three.js)
  file dialogs, read/write,         zustand Project store,    deterministic renderFrame(t),
  bundled ffmpeg fallback           panels, controls          effects, timeline, export
```

The engine uses **plain Three.js, not React-Three-Fiber** — R3F's `useFrame` loop fights the
frame-accurate, on-demand rendering the offline exporter needs. React only renders editor chrome
and pushes `Project` into the engine; keep `Engine` free of React imports.

Start with [types.ts](src/renderer/src/types.ts) (the `Project` data model), then
[Engine.ts](src/renderer/src/engine/Engine.ts) (the core render loop).

### Invariants (don't break these)

1. **The engine is a pure function of time.** `Engine.renderFrame(t)` must be deterministic: all
   animated values come from `evalScalar(scalar, t)` — no `Date.now()`, `performance.now()`, or
   per-frame `Math.random()` in rendering. Shaders animate via `uTime` = `timeline.sceneTime`, not
   wall-clock. The exporter steps `t = frame / fps` for frame-exact output regardless of machine
   speed; any new time-dependent feature must route through `t`. (Render *pixels* are
   deterministic; encoded MP4 *bytes* aren't when a hardware encoder is used — don't assert
   byte-identity.)

2. **Scalars/keyframes.** Every animatable number is a `Scalar` (`{kind:"const"}` or
   `{kind:"keys", keys: Keyframe[]}` with per-key easing). `evalScalar` interpolates; UI helpers are
   in [ui/scalarUtils.ts](src/renderer/src/ui/scalarUtils.ts); `<ScalarControl>` renders the
   slider + keyframe diamond.

3. **Effect module contract.** An `EffectDef` is a GLSL snippet + declared uniforms — `deform`
   effects write the body of `vec3 deform(pos, normal, uv, t)`, `shade` effects write
   `vec4 shade(color, uv, t)`. [composer.ts](src/renderer/src/engine/effects/composer.ts)
   concatenates enabled chunks into one `ShaderMaterial`, namespacing uniforms per instance.
   **Performance-critical:** the material rebuilds only when `composed.signature` changes (stack
   order/ids/kinds/GLSL body); changing a uniform *value* just updates
   `material.uniforms[key].value` per frame — don't conflate the two paths.

4. **Subject modes** (`plane` / `model` / `particles`) are rebuilt in
   `Engine.reconcileSubject()` when `subjectSig` changes. `model` accepts a primitive or an
   imported glb/gltf/obj (single dominant mesh, triplanar mapping if un-UV'd). `particles` uses a
   separate particle `ShaderMaterial` driven by its own keyframeable `Scalar`s.

5. **State flow.** A single `Project` lives in the zustand store
   ([state/store.ts](src/renderer/src/state/store.ts)). Mutate only via `store.update(mutator)`
   (structuredClone + mutate + set) — never mutate `project` in place.
   [App.tsx](src/renderer/src/App.tsx) calls `engine.setProject(project)` on every change. The
   `Project` is the entire serializable `.pangaea` file; image assets live in the asset registry
   (`state/assets.ts`), referenced by id, and are re-embedded as data URLs on save. A model is
   still embedded inline as a data URL.

6. **Preferences/taste layer.** Persisted preferences (editable base defaults, custom card font,
   learned "Feeling lucky" taste profile) live in `state/prefs.ts`, `state/taste.ts`,
   `state/lucky.ts`, `state/defaultsBase.ts`, `state/assets.ts` — see README for detail.

7. **Platform seam — the same renderer ships as Electron *and* a static web app.** Nothing under
   `src/renderer/` (renderer or engine) may import `electron` or Node built-ins; every OS call goes
   through the single `window.api` bridge (the `PangaeaApi` interface in `src/preload/index.ts`).
   Electron's preload injects it; the browser build installs a shim in
   [platform/webApi.ts](src/renderer/src/platform/webApi.ts) when `window.api` is absent. To add a
   platform capability: extend `PangaeaApi`, then implement it in **both** preload and webApi.ts
   (the shim's type-only `PangaeaApi` import makes the typecheck fail if they drift). Prefer runtime
   feature-detection (`if (!window.api)`, WebCodecs capability checks) over an `IS_WEB` global;
   where a capability can't exist on web, fail fast with an actionable message. Both targets are
   gated on every PR by `.github/workflows/ci.yml` (`typecheck` + `build:web`) — keep it green. See
   README's [Web build](README.md#web-build-github-pages) section.

### Known unresolved issue

Deformed closed primitives (most visibly `cone`) render with an alternating-triangle dropout
("perforated lattice" look). Leading theory: `DoubleSide + transparent: true` two-pass rendering in
three.js r169 re-enables backface culling per pass, and the deform shader's `gl_Position` rewrite
flips per-triangle winding between passes, causing misclassification. `forceSinglePass: true` is
already set on the material and did **not** fix it — see README's
[Known limitations](README.md#known-limitations--roadmap) before re-investigating, it documents
what's been ruled out.

## Conventions

- TypeScript `strict`; `npm run typecheck` must stay clean.
- IDs are random (`uid()`) — structural, not time-based, so they don't affect render determinism.
- Uniforms are currently `float`-only; extending to color/vec types touches `UniformDef`, the
  composer's alias generation, `valueOf`, and a new control in
  [ui/controls.tsx](src/renderer/src/ui/controls.tsx).
