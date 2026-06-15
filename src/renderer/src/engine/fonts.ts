import fontUrl from '@assets/parabole-mediumdisplay.otf?url'

// Family name used in canvas `ctx.font` strings for the text cards.
export const TEXT_CARD_FONT_FAMILY = 'Parabole Medium Display'

let loadPromise: Promise<void> | null = null
let loaded = false

// Register the bundled Parabole OTF so the 2D canvas can draw text cards with it.
// Idempotent: the FontFace is loaded and added to document.fonts exactly once.
export function loadTextCardFont(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    // Declare the single static face as covering the full weight range so the
    // card's `600` font request maps to the real glyphs without faux-bolding.
    const face = new FontFace(TEXT_CARD_FONT_FAMILY, `url(${fontUrl})`, {
      weight: '100 900'
    })
    await face.load()
    document.fonts.add(face)
    loaded = true
  })()
  return loadPromise
}

export function isTextCardFontLoaded(): boolean {
  return loaded
}
