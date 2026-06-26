// ---------------------------------------------------------------------------
// Asset registry — module-level, non-serialized store of image bytes keyed by a
// stable id. The project model holds only the id (ObjectImage.assetId), never
// the bytes, so the per-edit structuredClone in store.update() no longer copies
// multi-MB image data on every slider drag.
//
// Each asset lazily materializes a same-origin `blob:` URL on first use. Such
// URLs do NOT taint WebGL (the engine's taint guard is about cross-origin /
// file:// sources), so they upload to textures and read back on export safely.
// The `?selftest=1` end-to-end run confirms this.
// ---------------------------------------------------------------------------

interface Asset {
  mime: string;
  bytes: Uint8Array;
  url: string | null; // lazily created blob: URL; null until first assetUrl()
}

const registry = new Map<string, Asset>();
let counter = 0;

function store(id: string, bytes: Uint8Array, mime: string): void {
  registry.set(id, { mime, bytes, url: null });
}

// Keep the counter ahead of any numeric id we adopt from a loaded project so a
// freshly registered asset can never collide with a reloaded one.
function bumpCounter(id: string): void {
  const m = /(\d+)$/.exec(id);
  if (m) counter = Math.max(counter, parseInt(m[1], 10));
}

// Register new bytes and return a fresh stable id.
export function registerAsset(bytes: Uint8Array, mime: string): string {
  const id = `asset${++counter}`;
  store(id, bytes, mime);
  return id;
}

// Register bytes under a known id (reloading a saved project, so the project's
// stored assetIds still resolve). Must run before the project is set.
export function registerAssetWithId(
  id: string,
  bytes: Uint8Array,
  mime: string,
): void {
  store(id, bytes, mime);
  bumpCounter(id);
}

// Resolve an id to a same-origin blob: URL, creating it on first use.
export function assetUrl(id: string): string | null {
  const a = registry.get(id);
  if (!a) return null;
  if (!a.url) {
    a.url = URL.createObjectURL(new Blob([a.bytes.slice()], { type: a.mime }));
  }
  return a.url;
}

export function assetBytes(id: string): Uint8Array | null {
  return registry.get(id)?.bytes ?? null;
}

export function assetMime(id: string): string | null {
  return registry.get(id)?.mime ?? null;
}

export function assetBlob(id: string): Blob | null {
  const a = registry.get(id);
  return a ? new Blob([a.bytes.slice()], { type: a.mime }) : null;
}

// Drop an asset and revoke its blob URL. Optional housekeeping; the registry is
// session-scoped, so leaks are bounded by a session anyway.
export function releaseAsset(id: string): void {
  const a = registry.get(id);
  if (a?.url) URL.revokeObjectURL(a.url);
  registry.delete(id);
}
