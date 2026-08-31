import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  DEFAULT_EFFECT_ICON,
  EFFECT_ICONS,
  ICON_PERIOD,
  LATTICE_LINES,
  LATTICE_SAMPLES,
  POSE_T,
  PROJECT_TILT_X,
  PROJECT_TILT_Y,
  subscribeIconClock,
  type EffectIconSpec,
} from "./effectIcons";

const CENTER = 12;
const SCALE = 8;
const RING_COUNT = 4;
// How long a settle (intro-end or mouse-leave) takes to ease back to the pose.
const SETTLE_MS = 260;

export type EffectIconHandle = {
  startHover: () => void;
  stopHover: () => void;
};

type LatticeFrame = [number, number][][]; // one [x,y][] per line (screen space)
type RingFrame = { x: number; y: number; size: number; opacity: number }[];

function project(x: number, y: number, z: number): [number, number] {
  const sx = x + z * PROJECT_TILT_X;
  const sy = -y - z * PROJECT_TILT_Y;
  return [CENTER + sx * SCALE, CENTER + sy * SCALE];
}

function computeLatticeFrame(
  spec: Extract<EffectIconSpec, { kind: "lattice" }>,
  t: number,
): LatticeFrame {
  const frame: LatticeFrame = [];
  // 5 horizontal lines (y fixed, x sampled) then 5 vertical (x fixed, y sampled).
  for (let i = 0; i < LATTICE_LINES; i++) {
    const y0 = -1 + i * (2 / (LATTICE_LINES - 1));
    const line: [number, number][] = [];
    for (let j = 0; j < LATTICE_SAMPLES; j++) {
      const x0 = -1 + j * (2 / (LATTICE_SAMPLES - 1));
      const [x, y, z] = spec.deform(x0, y0, t);
      line.push(project(x, y, z));
    }
    frame.push(line);
  }
  for (let i = 0; i < LATTICE_LINES; i++) {
    const x0 = -1 + i * (2 / (LATTICE_LINES - 1));
    const line: [number, number][] = [];
    for (let j = 0; j < LATTICE_SAMPLES; j++) {
      const y0 = -1 + j * (2 / (LATTICE_SAMPLES - 1));
      const [x, y, z] = spec.deform(x0, y0, t);
      line.push(project(x, y, z));
    }
    frame.push(line);
  }
  return frame;
}

function applyLatticeFrame(
  els: (SVGPolylineElement | null)[],
  frame: LatticeFrame,
): void {
  frame.forEach((line, i) => {
    els[i]?.setAttribute(
      "points",
      line.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "),
    );
  });
}

function computeRingFrame(
  spec: Extract<EffectIconSpec, { kind: "rings" }>,
  t: number,
): RingFrame {
  const frame: RingFrame = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const r = i / (RING_COUNT - 1);
    const { opacity, dx = 0, dy = 0 } = spec.at(r, t);
    const half = 9 - r * 6;
    frame.push({
      x: CENTER - half + dx * SCALE,
      y: CENTER - half + dy * SCALE,
      size: half * 2,
      opacity,
    });
  }
  return frame;
}

function applyRingFrame(els: (SVGRectElement | null)[], frame: RingFrame): void {
  frame.forEach((r, i) => {
    const el = els[i];
    if (!el) return;
    el.setAttribute("x", String(r.x));
    el.setAttribute("y", String(r.y));
    el.setAttribute("width", String(r.size));
    el.setAttribute("height", String(r.size));
    el.setAttribute("stroke-opacity", String(r.opacity));
  });
}

function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}
function lerp(a: number, b: number, e: number): number {
  return a + (b - a) * e;
}

// A small animated SVG illustrating what an effect does to a flat lattice
// (or, for shade effects, a set of nested rings). Renders once; all motion
// is applied by mutating SVG attributes directly inside the shared rAF clock
// so React never re-renders per frame. See effectIcons.ts for the per-effect
// math and the clock itself.
export const EffectIcon = forwardRef<
  EffectIconHandle,
  { defId: string; introToken: number; index: number }
>(function EffectIcon({ defId, introToken, index }, ref) {
  const spec = EFFECT_ICONS[defId] ?? DEFAULT_EFFECT_ICON;
  const latticeRefs = useRef<(SVGPolylineElement | null)[]>([]);
  const ringRefs = useRef<(SVGRectElement | null)[]>([]);
  const hoverUnsub = useRef<(() => void) | undefined>(undefined);
  const settleRaf = useRef<number | null>(null);
  // The last frame actually painted, so a settle can ease *from* whatever is
  // on screen right now rather than from a re-derived (and possibly stale) t.
  const lastLatticeFrame = useRef<LatticeFrame | null>(null);
  const lastRingFrame = useRef<RingFrame | null>(null);
  const reducedMotion = useRef(
    typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  function paint(t: number): void {
    if (spec.kind === "lattice") {
      const frame = computeLatticeFrame(spec, t);
      lastLatticeFrame.current = frame;
      applyLatticeFrame(latticeRefs.current, frame);
    } else {
      const frame = computeRingFrame(spec, t);
      lastRingFrame.current = frame;
      applyRingFrame(ringRefs.current, frame);
    }
  }

  function cancelSettle(): void {
    if (settleRaf.current !== null) {
      cancelAnimationFrame(settleRaf.current);
      settleRaf.current = null;
    }
  }

  // Eases from whatever is currently on screen back to the frozen pose,
  // instead of snapping — used both when a hover ends and when an intro
  // loop finishes.
  function settleToPose(): void {
    cancelSettle();
    const startPerf = performance.now();
    if (spec.kind === "lattice") {
      const start = lastLatticeFrame.current ?? computeLatticeFrame(spec, POSE_T);
      const target = computeLatticeFrame(spec, POSE_T);
      const tick = (): void => {
        const e = easeOutCubic(Math.min(1, (performance.now() - startPerf) / SETTLE_MS));
        const frame: LatticeFrame = start.map((line, li) =>
          line.map(([x0, y0], pi) => {
            const [x1, y1] = target[li][pi];
            return [lerp(x0, x1, e), lerp(y0, y1, e)] as [number, number];
          }),
        );
        lastLatticeFrame.current = frame;
        applyLatticeFrame(latticeRefs.current, frame);
        settleRaf.current = e < 1 ? requestAnimationFrame(tick) : null;
      };
      settleRaf.current = requestAnimationFrame(tick);
    } else {
      const start = lastRingFrame.current ?? computeRingFrame(spec, POSE_T);
      const target = computeRingFrame(spec, POSE_T);
      const tick = (): void => {
        const e = easeOutCubic(Math.min(1, (performance.now() - startPerf) / SETTLE_MS));
        const frame: RingFrame = start.map((r0, i) => {
          const r1 = target[i];
          return {
            x: lerp(r0.x, r1.x, e),
            y: lerp(r0.y, r1.y, e),
            size: lerp(r0.size, r1.size, e),
            opacity: lerp(r0.opacity, r1.opacity, e),
          };
        });
        lastRingFrame.current = frame;
        applyRingFrame(ringRefs.current, frame);
        settleRaf.current = e < 1 ? requestAnimationFrame(tick) : null;
      };
      settleRaf.current = requestAnimationFrame(tick);
    }
  }

  useEffect(() => {
    if (reducedMotion.current || introToken === 0) {
      paint(POSE_T);
      return;
    }
    cancelSettle();
    let unsub: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      // Start exactly at POSE_T and count forward, so the intro picks up
      // from the same phase the previous frozen pose was showing.
      const startPerf = performance.now();
      unsub = subscribeIconClock(() => {
        const elapsed = (performance.now() - startPerf) / 1000;
        paint(POSE_T + elapsed);
        if (elapsed > ICON_PERIOD) {
          unsub?.();
          unsub = undefined;
          settleToPose();
        }
      });
    }, index * 40);
    return () => {
      window.clearTimeout(timer);
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introToken, defId]);

  useImperativeHandle(
    ref,
    () => ({
      startHover: () => {
        if (reducedMotion.current) return;
        hoverUnsub.current?.();
        cancelSettle();
        // Same trick: resume from POSE_T rather than jumping to wall-clock
        // phase, so hovering the frozen pose never pops.
        const startPerf = performance.now();
        hoverUnsub.current = subscribeIconClock(() => {
          const elapsed = (performance.now() - startPerf) / 1000;
          paint(POSE_T + elapsed);
        });
      },
      stopHover: () => {
        hoverUnsub.current?.();
        hoverUnsub.current = undefined;
        settleToPose();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defId],
  );

  useEffect(
    () => () => {
      hoverUnsub.current?.();
      cancelSettle();
    },
    [],
  );

  if (spec.kind === "lattice") {
    return (
      <svg viewBox="0 0 24 24" className="fx-icon" aria-hidden="true">
        {Array.from({ length: LATTICE_LINES * 2 }, (_, i) => (
          <polyline
            key={i}
            ref={(el) => {
              latticeRefs.current[i] = el;
            }}
          />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="fx-icon" aria-hidden="true">
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <rect
          key={i}
          ref={(el) => {
            ringRefs.current[i] = el;
          }}
        />
      ))}
    </svg>
  );
});
