import { branding } from '@branding'

// Family name used in canvas `ctx.font` strings for the text cards. The bundled
// font differs per build target (Space Mono Bold on web, Parabole on Electron) —
// see src/renderer/src/branding.
export const TEXT_CARD_FONT_FAMILY = branding.font.family

// Family the uploaded custom font is registered under, when one is set.
export const CUSTOM_FONT_FAMILY = 'Pangaea Custom Card Font'

// The family text cards currently draw with. Starts as the bundled font and
// flips to the custom family once a user font is loaded (and back on revert).
let activeFamily = TEXT_CARD_FONT_FAMILY

let loadPromise: Promise<void> | null = null

// Register the bundled text-card font so the 2D canvas can draw text cards with
// it. Idempotent: the FontFace is loaded and added to document.fonts once.
export function loadTextCardFont(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    // Declare the single static face as covering the full weight range so the
    // card's `600` font request maps to the real glyphs without faux-bolding.
    const face = new FontFace(TEXT_CARD_FONT_FAMILY, `url(${branding.font.url})`, {
      weight: branding.font.weight
    })
    await face.load()
    document.fonts.add(face)
  })()
  return loadPromise
}

// The family text cards should currently render with. textOverlay reads this
// instead of the bundled constant so a custom font takes effect everywhere.
export function getTextCardFontFamily(): string {
  return activeFamily
}

// Register an uploaded font (data URL) and make it the active card family. The
// face is declared across the full weight range so the card's `600` request
// maps to the real glyphs without faux-bolding (matching the bundled face).
export async function setCustomTextCardFont(dataUrl: string): Promise<void> {
  const face = new FontFace(CUSTOM_FONT_FAMILY, `url(${dataUrl})`, {
    weight: '100 900'
  })
  await face.load()
  document.fonts.add(face)
  activeFamily = CUSTOM_FONT_FAMILY
}

// Switch back to the bundled font family (the registered custom face is left in
// document.fonts; it's simply no longer referenced).
export function revertTextCardFont(): void {
  activeFamily = TEXT_CARD_FONT_FAMILY
}
