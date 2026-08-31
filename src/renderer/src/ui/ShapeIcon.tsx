import type { PrimitiveModel } from "../types";

// The 13 primitives plus the two non-primitive Type options ("no object" and
// an imported mesh), so one lookup covers every tile the shape pickers need.
export type ShapeIconKind = PrimitiveModel | "none" | "bespoke";

// Inner geometry per shape, hand-drawn on a shared 24x24 stroke grid (see
// ShapeIcon below). Kept separate from the <svg> wrapper so the geometry
// itself is easy to scan and tweak shape-by-shape.
export const SHAPE_ICON_PATHS: Record<ShapeIconKind, JSX.Element> = {
  // Aspect is the only real difference between these two (PLANE_DIMENSIONS in
  // Engine.ts) — a tall vs. wide rounded rect mirrors that directly.
  plane: <rect x="7.5" y="5" width="9" height="14" rx="1.3" />,
  landscape: <rect x="4.5" y="7" width="15" height="10" rx="1.3" />,
  sphere: (
    <>
      <circle cx="12" cy="12" r="8" />
      <ellipse cx="12" cy="12" rx="3" ry="8" />
    </>
  ),
  // Same circular footprint as sphere, but straight chords + facet lines so
  // it reads as faceted (it's an IcosahedronGeometry) against the smooth ball.
  polyhedron: (
    <>
      <path d="M12,4.5 L18,8 L18,16 L12,19.5 L6,16 L6,8 Z" />
      <path d="M12,4.5 L18,16" />
      <path d="M6,8 L12,19.5" />
    </>
  ),
  // Two nested pentagons, same orientation — the d12 silhouette without the
  // busier rotated-inner-pentagon-plus-spokes construction.
  dodecahedron: (
    <>
      <path d="M12,4.5 L19.1,9.7 L16.4,18.1 L7.6,18.1 L4.9,9.7 Z" />
      <path d="M12,8.25 L15.55,10.85 L14.2,15.05 L9.8,15.05 L8.45,10.85 Z" />
    </>
  ),
  // A 4-sided open-ended tube: rhombus lips (the square cross-section, seen
  // at an angle) at both ends, since both ends of the primitive are open.
  portal: (
    <>
      <path d="M12,4.5 L17,7 L12,9.5 L7,7 Z" />
      <path d="M12,14.5 L17,17 L12,19.5 L7,17 Z" />
      <path d="M7,7 V17" />
      <path d="M17,7 V17" />
    </>
  ),
  cylinder: (
    <>
      <ellipse cx="12" cy="6.5" rx="5" ry="2.2" />
      <ellipse cx="12" cy="17.5" rx="5" ry="2.2" />
      <path d="M7,6.5 V17.5" />
      <path d="M17,6.5 V17.5" />
    </>
  ),
  // Seam lines mark where the two hemisphere caps meet the cylindrical body
  // (matches CapsuleGeometry: a cylinder capped by two hemispheres).
  capsule: (
    <>
      <rect x="7.5" y="4" width="9" height="16" rx="4.5" />
      <path d="M7.5,8.5 H16.5" />
      <path d="M7.5,15.5 H16.5" />
    </>
  ),
  torus: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  // Standard isometric-cube construction: a hexagon hull plus a 3-spoke "Y"
  // from the centre (the near vertex) to alternating hull corners.
  box: (
    <>
      <path d="M12,4.8 L17.9,8.6 L17.9,15.4 L12,18.8 L6.1,15.4 L6.1,8.6 Z" />
      <path d="M12,12 L12,18.8" />
      <path d="M12,12 L17.9,8.6" />
      <path d="M12,12 L6.1,8.6" />
    </>
  ),
  // Goblet silhouette: wide rim tapering to a stem and foot — reads as a
  // lathe-turned object more readily than a literal latheProfile() trace.
  lathe: (
    <>
      <path d="M8,4.5 C8,8 10,9 10,15" />
      <path d="M16,4.5 C16,8 14,9 14,15" />
      <path d="M8,4.5 H16" />
      <ellipse cx="12" cy="16.5" rx="4.5" ry="1.8" />
    </>
  ),
  knot: (
    <>
      <circle cx="12" cy="7.8" r="5" />
      <circle cx="15.64" cy="14.1" r="5" />
      <circle cx="8.36" cy="14.1" r="5" />
    </>
  ),
  twist: (
    <>
      <circle cx="10" cy="12" r="5" />
      <circle cx="14" cy="12" r="5" />
    </>
  ),
  none: (
    <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" strokeDasharray="3 2.2" />
  ),
  // Redrawn (not reused) from the filled upload_file Material glyph: that one
  // is a fill-based path in its own viewBox and can't take a stroke colour,
  // which is the whole reason this module exists.
  bespoke: (
    <>
      <path d="M7,4.5 L13.5,4.5 L18,9 L18,19.5 L7,19.5 Z" />
      <path d="M13.5,4.5 L13.5,9 L18,9" />
      <path d="M12.3,17 V11.2" />
      <path d="M9.5,14 L12.3,11.2 L15,14" />
    </>
  ),
};

export function ShapeIcon({
  shape,
  size = 18,
  className,
}: {
  shape: ShapeIconKind;
  size?: number;
  className?: string;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {SHAPE_ICON_PATHS[shape]}
    </svg>
  );
}
