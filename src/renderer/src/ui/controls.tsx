import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { totalDuration, type Scalar } from "../types";
import { useStore } from "../state/store";
import { engine } from "../engine/engineSingleton";
import {
  evalScalar,
  hasKeyAt,
  isAnimated,
  keyTimes,
  moveKeyAt,
  removeKeyAt,
  setValueAt,
  toggleKeyAt,
} from "./scalarUtils";

export function Section({
  title,
  children,
  defaultOpen = true,
  right,
  className,
  style,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section ${className ?? ""}`} style={style}>
      <div className="section-head">
        <button className="section-toggle" onClick={() => setOpen((o) => !o)}>
          <svg
            className={`section-caret ${open ? "open" : ""}`}
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="M12 5.5L17 17.5H7L12 5.5Z" fill="currentColor" />
          </svg>{" "}
          {title}
        </button>
        {right}
      </div>
      <div className={`section-body-wrap ${open ? "open" : ""}`}>
        <div className="section-body">
          <div className="section-body-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Lightweight foldable header for a subsection nested inside a `Section`
// (e.g. each Explore option group). Same collapse mechanic as `Section`,
// smaller chrome.
export function Subsection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="subsection">
      <button
        className="subhead subhead-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          className={`subsection-caret ${open ? "open" : ""}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path d="M12 5.5L17 17.5H7L12 5.5Z" fill="currentColor" />
        </svg>
        {title}
      </button>
      <div className={`section-body-wrap ${open ? "open" : ""}`}>
        <div className="section-body">
          <div className="subsection-body-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  stacked = false,
}: {
  label: string;
  children: ReactNode;
  // Label on its own line above the controls, which then flow in a row
  // underneath. Used for wide multi-checkbox groups (Effects, Explore).
  stacked?: boolean;
}): JSX.Element {
  return (
    <label className={stacked ? "field field-stacked" : "field"}>
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
    </label>
  );
}

// Segment-duration number input, shared by the inspector and timeline. The
// timeline renders it bare (no Field wrapper) inside a clickable segment block,
// so it can opt out of the label and swallow the click.
export function DurationField({
  value,
  onChange,
  className,
  wrapInField = true,
  stopClickPropagation = false,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  wrapInField?: boolean;
  stopClickPropagation?: boolean;
}): JSX.Element {
  const input = (
    <input
      type="number"
      className={className}
      min={0.2}
      max={20}
      step={0.1}
      value={value}
      onClick={stopClickPropagation ? (e) => e.stopPropagation() : undefined}
      onChange={(e) =>
        onChange(Math.max(0.2, parseFloat(e.target.value || "1")))
      }
    />
  );
  return wrapInField ? <Field label="Duration">{input}</Field> : input;
}

// Tick marks for a range slider with a small, fixed number of stops (e.g.
// line weight, 1-3 step 0.1). Returns a CSS gradient — assign it to the
// `--tick-gradient` custom property on the `<input>` — that gets layered
// into `.scalar-slider`'s own `::-webkit-slider-runnable-track` background
// (styles.css). Baking ticks into the track itself (rather than an overlay
// element) means the native thumb, which paints after the track within the
// same atomic input, always renders on top of them — an overlay sibling div
// can't be stacked between a single input's own track and thumb.
export function tickGradient(
  min: number,
  max: number,
  step: number,
  thumbSize = 14,
): string {
  const count = Math.round((max - min) / step) + 1;
  const stops: string[] = [];
  // Skip the first/last tick — they sit at the thumb's travel limits, where
  // the thumb itself already marks the position.
  for (let i = 1; i < count - 1; i++) {
    const pos = `${thumbSize / 2}px + ${i} / ${count - 1} * (100% - ${thumbSize}px)`;
    stops.push(`transparent calc(${pos} - 0.75px)`);
    stops.push(`var(--border) calc(${pos} - 0.75px)`);
    stops.push(`var(--border) calc(${pos} + 0.75px)`);
    stops.push(`transparent calc(${pos} + 0.75px)`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

// Memoized: with a stable `onChange` this skips re-rendering when an unrelated
// part of the project changes (it still re-renders on playhead change, which it
// subscribes to directly).
export const ScalarControl = memo(function ScalarControl({
  label,
  scalar,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  label: string;
  scalar: Scalar;
  min: number;
  max: number;
  step?: number;
  onChange: (s: Scalar) => void;
}): JSX.Element {
  const playhead = useStore((s) => s.playhead);

  const value = evalScalar(scalar, playhead);
  const animated = isAnimated(scalar);
  const keyed = hasKeyAt(scalar, playhead);
  const fillPct =
    max > min
      ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
      : 0;

  const diamondTitle = !animated
    ? "Animate (add first keyframe)"
    : keyed
      ? "Remove keyframe at playhead"
      : "Add keyframe at playhead";

  return (
    <div className="scalar-control">
      <div
        className={`scalar-row ${animated ? "anim" : ""} ${keyed ? "keyed" : ""}`}
      >
        <span className="scalar-label" title={label}>
          {label}
        </span>
        <input
          className="scalar-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ ["--slider-pct" as string]: `${fillPct}%` } as CSSProperties}
          onChange={(e) =>
            onChange(setValueAt(scalar, playhead, parseFloat(e.target.value)))
          }
        />
        <input
          className="scalar-num"
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(3))}
          onChange={(e) =>
            onChange(setValueAt(scalar, playhead, parseFloat(e.target.value)))
          }
        />
        <button
          className={`btn-icon diamond ${animated ? "anim" : ""} ${keyed ? "keyed" : ""}`}
          title={diamondTitle}
          onClick={() => onChange(toggleKeyAt(scalar, playhead))}
        >
          ◆
        </button>
      </div>
    </div>
  );
});

export function KeyframeTrack({
  scalar,
  onChange,
  className,
}: {
  scalar: Scalar;
  onChange: (s: Scalar) => void;
  className?: string;
}): JSX.Element {
  const playhead = useStore((s) => s.playhead);
  const project = useStore((s) => s.project);
  const setPlaying = useStore((s) => s.setPlaying);
  const total = totalDuration(project) || 1;

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ origT: number; curT: number } | null>(
    null,
  );
  const dragRef = useRef<{ origT: number; curT: number } | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);

  // The only correct way to move the playhead: seekTo renders the frame and
  // fires onTick -> setPlayhead. Pause first so playback doesn't drift off it.
  const seek = (t: number): void => {
    if (engine.isPlaying) {
      engine.pause();
      setPlaying(false);
    }
    engine.seekTo(t);
  };

  // Drag a marker horizontally to retime its keyframe. Uses window listeners
  // (like startResize in App.tsx) so a re-render mid-drag can't break the
  // gesture, and commits only on release for a single clean history entry.
  const onMarkerPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    t: number,
  ): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    e.preventDefault();
    const startX = e.clientX;
    movedRef.current = false;
    dragRef.current = { origT: t, curT: t };
    setDrag({ origT: t, curT: t });

    const onMove = (ev: PointerEvent): void => {
      if (Math.abs(ev.clientX - startX) > 3) movedRef.current = true;
      const ratio = (ev.clientX - rect.left) / rect.width;
      const nt = Math.max(0, Math.min(total, ratio * total));
      dragRef.current = { origT: t, curT: nt };
      setDrag({ origT: t, curT: nt });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (movedRef.current && dragRef.current) {
        suppressClickRef.current = true;
        onChange(
          moveKeyAt(scalar, dragRef.current.origT, dragRef.current.curT),
        );
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className={`kf-track ${className ?? ""}`} ref={trackRef}>
      {keyTimes(scalar).map((t) => {
        const dragging = drag != null && Math.abs(t - drag.origT) < 1e-3;
        const left = dragging ? drag.curT : t;
        return (
          <button
            key={t}
            className={`kf-marker ${Math.abs(t - playhead) < 1e-3 ? "active" : ""} ${dragging ? "dragging" : ""}`}
            style={{ left: `${(left / total) * 100}%` }}
            title="Drag to move · click to jump · double-click to delete"
            onPointerDown={(e) => onMarkerPointerDown(e, t)}
            onClick={(e) => {
              e.stopPropagation();
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              seek(t);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onChange(removeKeyAt(scalar, t));
            }}
          />
        );
      })}
    </div>
  );
}

/** Normalize a user-typed hex string to `#rrggbb`, or null if it isn't valid. */
export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (/^[0-9a-f]{6}$/.test(s)) return "#" + s;
  return null;
}

/**
 * Hex text field that lets the user type freely and only commits a colour once
 * it parses to a valid hex value (3- or 6-digit, with or without a leading #).
 */
export function HexInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string): void => {
    const normalized = normalizeHex(raw);
    if (normalized) onChange(normalized);
    setDraft(null);
  };

  return (
    <input
      className="hex"
      type="text"
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") setDraft(null);
      }}
      spellCheck={false}
    />
  );
}

// Chromium's EyeDropper API (Electron). Not yet in the default TS DOM lib, so
// declare the minimal surface we use.
type EyeDropperResult = { sRGBHex: string };
type EyeDropperCtor = new () => {
  open: () => Promise<EyeDropperResult>;
};

/**
 * A colour swatch button that opens a popover picker (saturation/hue area, an
 * eyedropper that samples any pixel on screen, plus a hex field) in place of the
 * native OS colour dialog, so the value is always shown and edited as hex.
 */
export function ColorSwatch({
  value,
  onChange,
  className,
  title,
  selected,
  onShiftClick,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  title?: string;
  selected?: boolean;
  onShiftClick?: () => void;
}): JSX.Element {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [tab, setTab] = useState<"rgb" | "palette">("rgb");
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  // The project's "Feeling lucky" palette (state/lucky.ts) doubles as the set
  // of colours the user has already picked elsewhere in this project, so it's
  // offered here as a quick-reuse tab. Deduped by hex since the same colour
  // can appear under several roles/weights.
  const paletteColors = useStore((s) => s.project.lucky.colors);
  const paletteHexes = Array.from(
    new Map(paletteColors.map((c) => [c.hex.toLowerCase(), c.hex])).values(),
  );

  // Anchor the popover to the swatch in viewport coordinates. It renders into a
  // portal (fixed position) so it isn't clipped by panels/segments that hide
  // their overflow. Flip above the swatch when there isn't enough space below.
  const openAt = (): void => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const estimatedPickerHeight = 260;
    const spaceBelow = window.innerHeight - r.bottom;
    const top =
      spaceBelow < estimatedPickerHeight + 6
        ? r.top - estimatedPickerHeight + 75
        : r.bottom + 6;
    setPos({ top, left: r.left });
  };

  const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor })
    .EyeDropper;
  const pickWithEyedropper = async (): Promise<void> => {
    if (!Ctor) return;
    try {
      const { sRGBHex } = await new Ctor().open();
      onChange(sRGBHex);
    } catch {
      // The user dismissed the eyedropper (Escape); leave the colour unchanged.
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) {
        return;
      }
      setPos(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPos(null);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="color-swatch">
      <button
        type="button"
        ref={btnRef}
        className={
          "color-swatch-btn" +
          (className ? " " + className : "") +
          (selected ? " selected" : "")
        }
        title={title}
        style={{ background: value }}
        onClick={(e) => {
          e.stopPropagation();
          if (e.shiftKey && onShiftClick) {
            onShiftClick();
            return;
          }
          if (open) setPos(null);
          else openAt();
        }}
      />
      {pos &&
        createPortal(
          <div
            ref={popRef}
            className="color-popover"
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="color-popover-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "rgb"}
                className={"color-popover-tab" + (tab === "rgb" ? " active" : "")}
                onClick={() => setTab("rgb")}
              >
                RGB
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "palette"}
                className={"color-popover-tab" + (tab === "palette" ? " active" : "")}
                onClick={() => setTab("palette")}
              >
                Palette
              </button>
            </div>
            {tab === "rgb" ? (
              <HexColorPicker color={value} onChange={onChange} />
            ) : (
              <div className="color-popover-palette">
                {paletteHexes.length === 0 ? (
                  <div className="color-popover-empty">
                    No colours in the palette yet
                  </div>
                ) : (
                  paletteHexes.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      className={
                        "color-swatch-btn" +
                        (hex.toLowerCase() === value.toLowerCase() ? " selected" : "")
                      }
                      title={hex}
                      style={{ background: hex }}
                      onClick={() => onChange(hex)}
                    />
                  ))
                )}
              </div>
            )}
            <div className="color-popover-row">
              {Ctor && (
                <button
                  type="button"
                  className="btn-icon color-eyedropper"
                  title="Pick a colour from anywhere on screen"
                  onClick={pickWithEyedropper}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m2 22 1-1h3l9-9" />
                    <path d="M3 21v-3l9-9" />
                    <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
                  </svg>
                </button>
              )}
              <HexInput value={value} onChange={onChange} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export const ColorRow = memo(function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <Field label={label}>
      <ColorSwatch value={value} onChange={onChange} />
    </Field>
  );
});
