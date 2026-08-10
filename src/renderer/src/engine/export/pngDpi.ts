// Stamp a PNG with a pHYs chunk so print apps (InDesign, Photoshop) read its
// intended physical size instead of defaulting to 96/72dpi. Canvas-generated
// PNGs carry no DPI metadata at all, so without this a 4500px-wide export
// would be placed ~4x too large in a page layout.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function writeUint32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false)
}

// Insert a pHYs chunk (pixels-per-metre, both axes equal) right after the
// PNG's IHDR chunk. IHDR is always the first chunk and always 13 bytes of
// data, so it ends at a fixed offset: 8 (signature) + 4 (length) + 4 (type)
// + 13 (data) + 4 (CRC) = 33.
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const IHDR_END = 33
  const ppu = Math.round(dpi / 0.0254) // pixels per metre

  const chunk = new Uint8Array(4 + 4 + 9 + 4) // length + type + data + crc
  const view = new DataView(chunk.buffer)
  writeUint32BE(view, 0, 9) // data length
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // "pHYs"
  writeUint32BE(view, 8, ppu) // x pixels per unit
  writeUint32BE(view, 12, ppu) // y pixels per unit
  chunk[16] = 1 // unit specifier: 1 = metre
  const crc = crc32(chunk.subarray(4, 17)) // type + data
  writeUint32BE(view, 17, crc)

  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, IHDR_END), 0)
  out.set(chunk, IHDR_END)
  out.set(png.subarray(IHDR_END), IHDR_END + chunk.length)
  return out
}
