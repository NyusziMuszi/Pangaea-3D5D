import { useRef, type CSSProperties } from "react";
import { PALETTE_ROLES, type PaletteColor, type PaletteRole } from "../types";
import { ColorSwatch } from "./controls";
import cancelIcon from "@assets/cancel.svg";
import addIcon from "@assets/add_24dp_E3E3E3_FILL1_wght400_GRAD0_opsz24.svg";

// Shared cap: the merged list now holds what used to be two 12-entry lists.
export const MAX_COLORS = 16;

// Chip width per importance step — step 1 is exactly today's 18px swatch, so
// an all-default palette looks unchanged. 16px per step matches the drag
// math in PaletteChip below.
const CHIP_W: Record<1 | 2 | 3, number> = { 1: 18, 2: 34, 3: 50 };
const CHIP_STEP = 16;

export const PALETTE_ROLE_LABELS: Record<PaletteRole, string> = {
  type: "Typography",
  background: "Background",
  object: "Object",
  textBackground: "Text block background",
  textObject: "Text block object",
};

// Header labels are staggered per the mock: each drops further down
// (HEADER_STEP px per step) so a leader line can run from the label to its
// checkbox column without the labels' text overlapping. leaderH is that
// line's length, computed so every line ends flush with the top of the first
// palette row regardless of how far down its own label starts — each +22px of
// top is a -22px of leaderH. Derived from PALETTE_ROLES.length so adding a
// role column needs no hand-edited table (and no CSS edit — the header's
// height and the row's column count are handed to CSS as inline vars below).
const HEADER_STEP = 22;
const HEADER_LEADER_MIN = 6;
const HEADER_LABEL_H = 18;
const HEADER_TOP = (i: number): number => i * HEADER_STEP;
const HEADER_LEADER = (i: number): number =>
  HEADER_TOP(PALETTE_ROLES.length - 1) - HEADER_TOP(i) + HEADER_LEADER_MIN;
const HEADER_H =
  HEADER_TOP(PALETTE_ROLES.length - 1) + HEADER_LABEL_H + HEADER_LEADER_MIN;

// Add/remove `role` on `color` in place. Deliberately does NOT rescue an
// emptied set back to "all" the way toggleExplore does elsewhere in Explore —
// a palette colour with no roles ticked is meant to just sit unused (see
// PaletteColor in types.ts).
function toggleRole(color: PaletteColor, role: PaletteRole): void {
  const i = color.roles.indexOf(role);
  if (i >= 0) color.roles.splice(i, 1);
  else color.roles.push(role);
}

// The colour swatch, widened to CHIP_W[weight] to show importance at a
// glance, with a drag grip on its right edge to change that weight. Uses
// window pointermove/pointerup listeners (same pattern as the keyframe
// marker drag in controls.tsx's KeyframeTrack) so a re-render mid-drag can't
// break the gesture; each step change commits immediately via onSetWeight so
// the chip visibly snaps as it's dragged, deduped against a plain closure
// variable rather than the (possibly stale) weight prop.
function PaletteChip({
  hex,
  weight,
  onSetHex,
  onSetWeight,
}: {
  hex: string;
  weight: 1 | 2 | 3;
  onSetHex: (v: string) => void;
  onSetWeight: (w: 1 | 2 | 3) => void;
}): JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null);

  const onGripPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = slotRef.current?.getBoundingClientRect();
    if (!rect) return;
    let last = weight;
    const stepFromX = (clientX: number): 1 | 2 | 3 => {
      const raw = Math.round((clientX - rect.left - CHIP_W[1]) / CHIP_STEP) + 1;
      return Math.min(3, Math.max(1, raw)) as 1 | 2 | 3;
    };
    const onMove = (ev: PointerEvent): void => {
      const step = stepFromX(ev.clientX);
      if (step !== last) {
        last = step;
        onSetWeight(step);
      }
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onGripKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onSetWeight(Math.max(1, weight - 1) as 1 | 2 | 3);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onSetWeight(Math.min(3, weight + 1) as 1 | 2 | 3);
    }
  };

  return (
    <div className="palette-chip-slot" ref={slotRef}>
      <ColorSwatch className="palette-chip" value={hex} onChange={onSetHex} />
      <div
        className="palette-chip-grip"
        role="slider"
        tabIndex={0}
        title="Drag to set how often this colour is used"
        aria-label={`Importance of ${hex}`}
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={weight}
        onPointerDown={onGripPointerDown}
        onKeyDown={onGripKeyDown}
      />
    </div>
  );
}

// The unified "Feeling lucky" colour palette editor: one swatch + three role
// checkboxes + remove button per colour, plus the staggered header labelling
// each checkbox column. Shared by LibraryPanel (edits the live project) and
// PreferencesPanel (edits a draft blueprint) — `onMutate` receives the live
// `colors` array to mutate in place, so each caller only has to plug in how
// that mutation reaches its own state (store `update` vs. draft `setState`).
export function PaletteColorList({
  colors,
  onMutate,
}: {
  colors: PaletteColor[];
  onMutate: (fn: (colors: PaletteColor[]) => void) => void;
}): JSX.Element {
  return (
    <div
      className="palette-list"
      style={{ ["--pal-n" as string]: PALETTE_ROLES.length } as CSSProperties}
    >
      <div className="palette-header" style={{ height: `${HEADER_H}px` }}>
        {PALETTE_ROLES.map((role, i) => (
          <span
            key={role}
            className="palette-header-label"
            style={
              {
                // Checkboxes are the first 3 grid columns now (colour swatch
                // trails after them), so column i starts right at the row's
                // left edge. +6px nudges the anchor from the checkbox's left
                // edge toward its center (checkbox is 14px wide, so
                // dead-center is +7px).
                left: `calc(${i} * (var(--pal-cb) + var(--pal-gap)) + 6px)`,
                top: `${HEADER_TOP(i)}px`,
                ["--leader-h" as string]: `${HEADER_LEADER(i)}px`,
              } as CSSProperties
            }
          >
            {PALETTE_ROLE_LABELS[role]}
          </span>
        ))}
      </div>
      {colors.map((c, i) => (
        <div
          className="palette-row"
          key={i}
          style={{ ["--chip-w" as string]: `${CHIP_W[c.weight ?? 2]}px` } as CSSProperties}
        >
          {PALETTE_ROLES.map((role) => (
            <input
              key={role}
              type="checkbox"
              title={PALETTE_ROLE_LABELS[role]}
              aria-label={`${PALETTE_ROLE_LABELS[role]}: ${c.hex}`}
              checked={c.roles.includes(role)}
              onChange={() =>
                onMutate((cs) => {
                  toggleRole(cs[i], role);
                })
              }
            />
          ))}
          <PaletteChip
            hex={c.hex}
            weight={c.weight ?? 2}
            onSetHex={(v) =>
              onMutate((cs) => {
                cs[i].hex = v;
              })
            }
            onSetWeight={(w) =>
              onMutate((cs) => {
                cs[i].weight = w;
              })
            }
          />
          <button
            className="btn-icon"
            title="Remove colour"
            onClick={() =>
              onMutate((cs) => {
                cs.splice(i, 1);
              })
            }
          >
            <img src={cancelIcon} alt="remove" />
          </button>
        </div>
      ))}
      {colors.length < MAX_COLORS && (
        <button
          className="swatch-add-btn"
          title="Add colour"
          onClick={() =>
            onMutate((cs) => {
              cs.push({ hex: "#a3d6dc", roles: ["background", "object"] });
            })
          }
        >
          <img src={addIcon} alt="add" />
        </button>
      )}
    </div>
  );
}
