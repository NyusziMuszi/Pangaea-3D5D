// Derives a block's identity accent (the CSS custom properties consumed by the
// .accented marker class) from a single base colour, so a panel/segment can
// take its colour scheme straight from the content it edits: an object's
// surface colour, or a text/segment background colour.
//
// The base is mapped into a legible lightness band on the dark UI so very dark,
// very light, or near-grey inputs still read as a clear accent while keeping
// their hue and saturation. Returns inline styles to set on the element that
// carries the identity class.

import type { CSSProperties } from "react";
import type { ObjectState, Project } from "../types";

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return { r: 136, g: 136, b: 136 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((((g - b) / d) % 6) + 6) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Pull a saturation into a legible range. Hue is always kept, but a very
// saturated base reads as harsh against the dark UI, so anything above the
// threshold is compressed with diminishing returns (s=1 lands ~0.82) — slightly
// more muted, never grey.
function legibleSaturation(s: number): number {
  const cap = 0.62;
  return s <= cap ? s : cap + (s - cap) * 0.5;
}

// Build the identity CSS variables for a block from one base colour. Hue is
// preserved; lightness is pulled into a legible band (very dark inputs become a
// lighter tint of the same hue, very light inputs are darkened) and very
// saturated inputs are slightly muted. The result is fanned into four prominence
// levels that share the hue so a block reads as one colour throughout the UI:
//   - muted (--slider-track): a dim, hue-true groove for slider tracks
//   - default (--text-section): the readable base — section headers, slider heads
//   - important (--accent-strong): emphasised — keyframed props + active keyframes
//   - hover (--obj-hover): the brightest step, for hover/focus feedback
// Plus a darker divider rule and a translucent highlight tint for the panel fill.
export function accentVars(baseHex: string): CSSProperties {
  const { r, g, b } = hexToRgb(baseHex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const mainS = legibleSaturation(s);
  const mainL = clamp(l, 0.55, 0.72);
  const main = hslToHex(h, mainS, mainL);
  const rule = hslToHex(h, mainS, clamp(mainL - 0.12, 0.32, 0.66));
  const muted = hslToHex(h, mainS, clamp(mainL - 0.16, 0.28, 0.44));
  const important = hslToHex(h, mainS, clamp(mainL + 0.08, 0.56, 0.8));
  const hover = hslToHex(h, mainS, clamp(mainL + 0.16, 0.62, 0.88));
  const hl = hslToRgb(h, mainS, Math.max(mainL, 0.7));
  return {
    ["--text-section" as string]: main,
    ["--text-section-rule" as string]: rule,
    ["--slider-track" as string]: muted,
    ["--accent-strong" as string]: important,
    ["--obj-hover" as string]: hover,
    ["--obj-highlight" as string]: `rgba(${hl.r}, ${hl.g}, ${hl.b}, 0.16)`,
  } as CSSProperties;
}

// Fixed per-object identity hues, used when an object has no colour of its own
// (an image surface) — so each object still reads as a distinct accent. Cycles
// if there are more objects than hues.
const IDENTITY_HUES = ["#997a59", "#955999", "#599399", "#5a7da0", "#a06a5a"];
export function identityHue(index: number): string {
  return IDENTITY_HUES[index % IDENTITY_HUES.length];
}

// The base colour an object's accent is drawn from: its surface colour when the
// surface is a solid (silhouette/wireframe/faceted), otherwise — an image
// surface has no single colour of its own — a fixed per-object identity hue.
export function objectAccentColor(
  project: Project,
  obj: ObjectState,
  index: number,
): string {
  const surface = obj.surface ?? "image";
  if (surface !== "image") return obj.surfaceColor || "#878787";
  return identityHue(index);
}
