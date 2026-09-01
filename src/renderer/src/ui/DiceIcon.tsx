import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type DiceIconHandle = {
  /** Tumble the die and land on a new random face. */
  roll: () => void;
};

// The 7 pip slots of a die face, on a 3x3 grid inside the 24-unit viewBox.
const PIPS: [number, number][] = [
  [8, 8], // 0 top-left
  [16, 8], // 1 top-right
  [8, 12], // 2 mid-left
  [12, 12], // 3 centre
  [16, 12], // 4 mid-right
  [8, 16], // 5 bottom-left
  [16, 16], // 6 bottom-right
];

// Which pip slots are lit for each face, 1 through 6.
const FACES: number[][] = [
  [3],
  [0, 6],
  [0, 3, 6],
  [0, 1, 5, 6],
  [0, 1, 3, 5, 6],
  [0, 1, 2, 4, 5, 6],
];

// Must match the .dice-icon.rolling animation duration in styles.css.
const ROLL_MS = 620;
// How long each intermediate face is shown mid-tumble.
const SWAP_MS = 90;

function randomFaceExcept(exclude: number): number {
  const n = Math.floor(Math.random() * (FACES.length - 1));
  return n >= exclude ? n + 1 : n;
}

// The die on the "Feeling lucky" button. Pip visibility is applied by mutating
// SVG attributes directly (same approach as EffectIcon) so the tumble never
// re-renders React; the spin itself is a CSS keyframe on the <svg>.
export const DiceIcon = forwardRef<DiceIconHandle, unknown>(
  function DiceIcon(_props, ref) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const pipRefs = useRef<(SVGCircleElement | null)[]>([]);
    const raf = useRef<number | null>(null);
    const face = useRef(4); // face 5 — a pleasant resting pose
    const reducedMotion = useRef(
      typeof matchMedia !== "undefined" &&
        matchMedia("(prefers-reduced-motion: reduce)").matches,
    );

    function paint(f: number): void {
      face.current = f;
      const lit = FACES[f];
      pipRefs.current.forEach((el, i) => {
        if (el) el.setAttribute("opacity", lit.includes(i) ? "1" : "0");
      });
    }

    useEffect(() => {
      paint(face.current);
      return () => {
        if (raf.current !== null) cancelAnimationFrame(raf.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      roll: () => {
        const landing = randomFaceExcept(face.current);
        if (reducedMotion.current) {
          paint(landing);
          return;
        }

        // The faces flashed while the die is in the air, ending on the one it
        // lands on. Precomputed so the rAF loop is a pure lookup by elapsed
        // time and never lands somewhere the tumble didn't lead to.
        const steps = Math.max(1, Math.round(ROLL_MS / SWAP_MS));
        const sequence: number[] = [];
        let prev = face.current;
        for (let i = 0; i < steps - 1; i++) {
          prev = randomFaceExcept(prev);
          sequence.push(prev);
        }
        sequence.push(landing);

        const el = svgRef.current;
        if (el) {
          // Restart the keyframe even if a previous roll is still running.
          el.classList.remove("rolling");
          void el.getBoundingClientRect();
          el.classList.add("rolling");
        }

        if (raf.current !== null) cancelAnimationFrame(raf.current);
        const start = performance.now();
        const tick = (): void => {
          const elapsed = performance.now() - start;
          if (elapsed >= ROLL_MS) {
            raf.current = null;
            paint(landing);
            svgRef.current?.classList.remove("rolling");
            return;
          }
          const i = Math.min(sequence.length - 1, Math.floor(elapsed / SWAP_MS));
          if (sequence[i] !== face.current) paint(sequence[i]);
          raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      },
    }));

    return (
      <svg
        ref={svgRef}
        viewBox="0 0 24 24"
        className="dice-icon"
        aria-hidden="true"
      >
        <rect
          className="dice-body"
          x="3.5"
          y="3.5"
          width="17"
          height="17"
          rx="3.5"
        />
        {PIPS.map(([cx, cy], i) => (
          <circle
            key={i}
            className="dice-pip"
            cx={cx}
            cy={cy}
            r="1.7"
            opacity="0"
            ref={(el) => {
              pipRefs.current[i] = el;
            }}
          />
        ))}
      </svg>
    );
  },
);
