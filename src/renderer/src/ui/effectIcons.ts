// Per-effect animated icon specs for the Library catalog pills. A flat
// lattice at z = 0 in object space (x, y ∈ [-1, 1]) is deformed by the
// effect's math below, then projected. Mirrors the effect's glslDeform where
// a flat plane makes that legible; deviates where it doesn't (see the
// per-effect comments below) — these are illustrations, not the render path,
// and their constants are tuned for legibility at 18px, not fidelity to the
// engine's defaults.
export type EffectIconSpec =
  | {
      kind: "lattice";
      deform: (x: number, y: number, t: number) => [number, number, number];
    }
  // Concentric squares for the `shade` effects, which move no geometry.
  // r = 0 (outer ring) … 1 (inner ring).
  | {
      kind: "rings";
      at: (r: number, t: number) => { opacity: number; dx?: number; dy?: number };
    };

// ~10-line JS port of pg_hash/pg_noise (engine/effects/catalog.ts's
// NOISE_COMMON) so `warp` and `jitter` icons are honest rather than faked.
function frac(v: number): number {
  return v - Math.floor(v);
}
function hash3(x: number, y: number, z: number): number {
  const px = frac(x * 0.3183099 + 0.1) * 17;
  const py = frac(y * 0.3183099 + 0.1) * 17;
  const pz = frac(z * 0.3183099 + 0.1) * 17;
  return frac(px * py * pz * (px + py + pz));
}
function smooth(v: number): number {
  return v * v * (3 - 2 * v);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const ux = smooth(x - ix);
  const uy = smooth(y - iy);
  const uz = smooth(z - iz);
  return lerp(
    lerp(
      lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux),
      lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux),
      uy,
    ),
    lerp(
      lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux),
      lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux),
      uy,
    ),
    uz,
  );
}

export const LATTICE_LINES = 5;
export const LATTICE_SAMPLES = 9;
export const ICON_PERIOD = 1.6; // seconds
export const POSE_T = 0.9; // frozen t for the idle pose
// A slight tilt so out-of-plane (z) motion reads in the flat projection.
export const PROJECT_TILT_X = 0.28;
export const PROJECT_TILT_Y = 0.42;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function pulse(t: number, speed = 2): number {
  return 0.5 + 0.5 * Math.sin(t * speed);
}

export const EFFECT_ICONS: Record<string, EffectIconSpec> = {
  ripple: {
    kind: "lattice",
    deform: (x, y, t) => {
      const d = Math.hypot(x, y);
      return [x, y, Math.sin(d * 6 - t * 3) * 0.3];
    },
  },
  wave: {
    kind: "lattice",
    deform: (x, y, t) => [
      x,
      y,
      Math.sin(x * 3 + t * 2) * 0.28 + Math.cos(y * 2.4 + t * 2) * 0.14,
    ],
  },
  twist: {
    kind: "lattice",
    deform: (x, y, t) => {
      const a = y * 0.9 + t * 0.8;
      return [Math.cos(a) * x, y, Math.sin(a) * x];
    },
  },
  bulge: {
    kind: "lattice",
    deform: (x, y, t) => {
      // Wide falloff radius so most of the lattice bulges together (only the
      // far corners anchor in place) — a tight radius left only the center
      // point moving, which read as no change at all.
      const f = smoothstep(1.3, 0, Math.hypot(x, y));
      const s = Math.sin(t * 2);
      const scale = 1 + s * f * 0.35;
      return [x * scale, y * scale, s * f * 1.1];
    },
  },
  warp: {
    kind: "lattice",
    deform: (x, y, t) => {
      const s = 2.2;
      const n = noise3(x * s, y * s, t * 0.5);
      const nx = noise3(x * s + 11, y * s, t * 0.5);
      const ny = noise3(x * s - 7, y * s, t * 0.5);
      return [x + (nx - 0.5) * 0.35, y + (ny - 0.5) * 0.35, (n - 0.5) * 1.4];
    },
  },
  // Plane normal is (0,0,1), so the real glslDeform (offset along normal) is
  // degenerate for a flat lattice — authored instead as a breathing scale.
  inflate: {
    kind: "lattice",
    deform: (x, y, t) => {
      const p = 0.5 + 0.5 * Math.sin(t * 2);
      const scale = 1 + 0.22 * p;
      return [x * scale, y * scale, 0.25 * p];
    },
  },
  // The real taper amount is a static uniform; animate it here so the icon moves.
  taper: {
    kind: "lattice",
    deform: (x, y, t) => {
      const f = 1 + y * 0.55 * (0.5 + 0.5 * Math.sin(t * 1.6));
      return [x * f, y, 0];
    },
  },
  // The GLSL rotates xz; rotating xy instead reads far better face-on as a whirlpool.
  vortex: {
    kind: "lattice",
    deform: (x, y, t) => {
      const angle = Math.hypot(x, y) * 1.6 + t * 1.2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return [c * x - s * y, s * x + c * y, 0];
    },
  },
  jitter: {
    kind: "lattice",
    deform: (x, y, t) => {
      const grid = 0.4;
      const qx = Math.floor(x / grid) * grid;
      const qy = Math.floor(y / grid) * grid;
      const qt = Math.floor(t * 6) / 6;
      const nx = noise3(qx * 3, qy * 3, qt * 2) - 0.5;
      const ny = noise3(qx * 3 + 5, qy * 3, qt * 2) - 0.5;
      const nz = noise3(qx * 3, qy * 3 + 5, qt * 2) - 0.5;
      return [x + nx * 0.18, y + ny * 0.18, nz * 0.18];
    },
  },
  // No texture in an icon — substitute a coarse procedural field.
  displace: {
    kind: "lattice",
    deform: (x, y, t) => {
      const lum = 0.5 + 0.5 * Math.sin(x * 3) * Math.cos(y * 3);
      return [x, y, (lum - 0.5) * 0.8 * pulse(t)];
    },
  },
  // Same trick, a finer field, and no pulse (the real effect has no time
  // term) so it stays distinguishable from `displace`.
  relief: {
    kind: "lattice",
    deform: (x, y) => {
      const lum = 0.5 + 0.5 * Math.sin(x * 8) * Math.cos(y * 8);
      return [x, y, (lum - 0.5) * 0.8];
    },
  },
  // Rings: the actual fresnel falloff — bright at the outer ring, dim at the center.
  fresnel: {
    kind: "rings",
    at: (r, t) => ({
      opacity: lerp(0.15, 1, Math.pow(1 - r, 2.5)) * (0.6 + 0.4 * Math.sin(t * 2)),
    }),
  },
  // Rings: nested squares slide apart and overlap.
  multiply: {
    kind: "rings",
    at: (r, t) => ({
      opacity: 0.9 - r * 0.2,
      dx: r * 3 * Math.sin(t * 1.6),
      dy: r * 2 * Math.cos(t * 1.6),
    }),
  },
  // Rings: a matte cutting in from the inside.
  mask: {
    kind: "rings",
    at: (r, t) => ({
      opacity: r < 0.5 + 0.5 * Math.sin(t * 1.8) ? 1 : 0,
    }),
  },
};

// Gentle generic wobble for custom/bespoke effects with no dedicated icon.
export const DEFAULT_EFFECT_ICON: EffectIconSpec = {
  kind: "lattice",
  deform: (x, y, t) => [
    x,
    y,
    Math.sin(x * 2 + t * 1.5) * 0.12 + Math.cos(y * 2 + t * 1.5) * 0.12,
  ],
};

// Module-level rAF driver shared by every icon. The loop starts on the first
// subscriber and is cancelled at zero subscribers, so a settled, unhovered
// panel costs nothing. Ticks carry no time value — each subscriber (intro or
// hover) tracks its own elapsed time from its own start, so it can begin
// exactly at POSE_T and count forward with no jump from the frozen pose.
const clockSubscribers = new Set<() => void>();
let clockRaf: number | null = null;
function clockTick(): void {
  for (const cb of clockSubscribers) cb();
  clockRaf = requestAnimationFrame(clockTick);
}
export function subscribeIconClock(cb: () => void): () => void {
  clockSubscribers.add(cb);
  if (clockRaf === null) clockRaf = requestAnimationFrame(clockTick);
  return () => {
    clockSubscribers.delete(cb);
    if (clockSubscribers.size === 0 && clockRaf !== null) {
      cancelAnimationFrame(clockRaf);
      clockRaf = null;
    }
  };
}
