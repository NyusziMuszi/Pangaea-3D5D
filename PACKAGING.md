# Packaging Pangaea for macOS (Apple Silicon)

Goal: produce an **unsigned, ad-hoc-signed** `.dmg` for Apple Silicon (arm64) that
someone without an Apple Developer ID can install and run after a one-time
Gatekeeper bypass.

Status as of 2026-06-16: build config is done and a `.dmg` was produced once, but
**source has since changed (security hardening) so a rebuild is required**, and the
critical ffmpeg-fallback export check inside the packaged app is **not yet verified**.

---

## Done

### 1. Packaged ffmpeg path fix — `src/main/index.ts`
`ffmpeg-static` resolves a path inside `app.asar`, which can't be executed in a
packaged app. Added `resolveFfmpeg()` which rewrites `app.asar` →
`app.asar.unpacked` when `app.isPackaged` (no-op in dev), and the
`ffmpeg:encodeFrames` handler now calls `.setFfmpegPath(resolveFfmpeg())`.
This pairs with the `asarUnpack` rule that unpacks the ffmpeg binary.

### 2. `package.json` build config — `build.mac`
```jsonc
"mac": {
  "category": "public.app-category.video",
  "icon": "assets/electron-icons/macos/icon.icns",
  "target": [{ "target": "dmg", "arch": ["arm64"] }]
}
```
Icon file confirmed present at `assets/electron-icons/macos/icon.icns`.
`appId`, `productName`, `directories`, `files` (`["out/**/*"]`), and `asarUnpack`
(`["**/node_modules/ffmpeg-static/**"]`) unchanged.

### 3. Deterministic unsigned `dist` script — `package.json`
```json
"dist": "electron-vite build && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --arm64"
```
`CSC_IDENTITY_AUTO_DISCOVERY=false` stops electron-builder from hunting for a
Developer ID cert, yielding an ad-hoc-signed arm64 app.

### One successful build (now stale)
`npm install && npm run dist` produced:
- `dist/Pangaea-0.1.0-arm64.dmg`
- `dist/mac-arm64/Pangaea.app`

Verified on that build:
- ffmpeg binary unpacked to
  `Pangaea.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg`
  and is a `Mach-O 64-bit executable arm64`.
- App is ad-hoc signed (`codesign -dv` → `flags=0x20002(adhoc,linker-signed)`).

> ⚠️ These artifacts were built at ~19:54 on 2026-06-16, **before** the security
> edits to `src/main/index.ts` and `index.html` (~20:04). They are stale — rerun
> `npm run dist` before sending anything out.

---

## Outstanding

### A. Rebuild after pending app changes
The user is making further app changes before exporting. After those land, just run:
```bash
npm install      # ensures ffmpeg-static's arm64 binary is present
npm run dist
```
Note: `src/main/index.ts` now has dialog-path gating (`approvedPaths` /
`assertApproved`) and `sandbox: true`. The self-test harness pre-approves its
`/tmp/pangaea-selftest.{mp4,status}` paths (see `registerIpc`), so SELFTEST still
works through the gating.

### B. CRITICAL — verify ffmpeg fallback export inside the *packaged* app
This is the one check that proves the `app.asar.unpacked` fix works at runtime.
**Not yet done.** WebCodecs is available in Electron, so a normal export uses the
WebCodecs path, not ffmpeg. The fallback (`captureFrames` →
`window.api.encodeFrames` → bundled ffmpeg) only runs when WebCodecs is absent or
fails (`src/renderer/src/engine/export/exporter.ts`).

The headless self-test (`src/renderer/src/ui/selftest.ts`, triggered by
`PANGAEA_SELFTEST=1`) exports a 2s clip and writes the encoder used to
`/tmp/pangaea-selftest.status`. To force the **ffmpeg** path we need WebCodecs
disabled.

Attempt that FAILED: launching the packaged binary with `--disable-features=WebCodecs`
→ `bad option: --disable-features=WebCodecs` (the packaged build rejected the raw
Chromium switch).

Approaches to try next (pick one):
- Register the Chromium switch in main before `app.whenReady()`, e.g.
  `app.commandLine.appendSwitch('disable-features', 'WebCodecs')`, gated behind an
  env var like `PANGAEA_NO_WEBCODECS` so it's test-only — then launch the packaged
  binary with both env vars set.
- Or add a SELFTEST-only branch that calls `encodeFrames` directly (exercises the
  ffmpeg IPC without depending on WebCodecs availability).
- Or do a manual GUI export from the installed app on a machine/condition where the
  WebCodecs path errors, and confirm a valid `.mp4` is produced.

Run pattern once a force-fallback mechanism exists:
```bash
rm -f /tmp/pangaea-selftest.mp4 /tmp/pangaea-selftest.status
PANGAEA_SELFTEST=1 <force-fallback-env> \
  dist/mac-arm64/Pangaea.app/Contents/MacOS/Pangaea
# wait, then:
cat /tmp/pangaea-selftest.status      # expect: OK encoder=ffmpeg
ls -l /tmp/pangaea-selftest.mp4       # expect: non-empty
ffprobe /tmp/pangaea-selftest.mp4     # expect: valid H.264 mp4
```

### C. Smoke checks (quick)
- `npm run dev` still launches (the ffmpeg path fix is a no-op in dev).
- Open `dist/mac-arm64/Pangaea.app` — window opens, custom icon shows in Dock, UI loads.
- If launch fails with a code-signing error, ad-hoc sign manually:
  `codesign --deep --force --sign - dist/mac-arm64/Pangaea.app`

---

## Recipient instructions (send with the DMG)
The app is unsigned / not notarized, so first launch is gated:
1. Open the `.dmg`, drag **Pangaea** to **Applications**.
2. Right-click the app → **Open**, then confirm (a plain double-click only offers
   "Move to Trash").
3. If still blocked, run once:
   `xattr -dr com.apple.quarantine /Applications/Pangaea.app`
