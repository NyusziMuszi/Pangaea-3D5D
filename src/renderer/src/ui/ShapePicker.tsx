import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { ShapeIcon, type ShapeIconKind } from "./ShapeIcon";
import { PRIMITIVE_OPTIONS } from "./objectOptions";

type ShapePickerOption = { value: string; label: string; icon: ShapeIconKind };

// Same order as the native <select> it replaces: None, then the 13
// primitives in PRIMITIVE_MODELS order, then Bespoke.
const SHAPE_PICKER_OPTIONS: ShapePickerOption[] = [
  { value: "none", label: "None", icon: "none" },
  ...PRIMITIVE_OPTIONS.map(
    (o): ShapePickerOption => ({ value: o.value, label: o.label, icon: o.value }),
  ),
  { value: "bespoke", label: "Bespoke", icon: "bespoke" },
];

const GRID_COLUMNS = 3;

/**
 * Replaces the native <select> for an object's Type field — a native
 * <select> can't render an image inside an <option>, so this opens a
 * portal-rendered grid of icon-over-label tiles instead. Popover
 * anchoring/dismissal mirrors ColorSwatch (controls.tsx): portal to
 * document.body so panel overflow can't clip it, flip above the trigger when
 * short on space below, outside mousedown / Escape to close.
 */
export function ShapePicker({
  value,
  onChange,
  variant,
}: {
  value: string;
  onChange: (v: string) => void;
  variant: "field" | "compact";
}): JSX.Element {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const open = pos !== null;

  const selectedIndex = Math.max(
    0,
    SHAPE_PICKER_OPTIONS.findIndex((o) => o.value === value),
  );
  const current = SHAPE_PICKER_OPTIONS[selectedIndex];

  const openAt = (): void => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const estimatedPickerHeight = 300;
    const spaceBelow = window.innerHeight - r.bottom;
    const top =
      spaceBelow < estimatedPickerHeight + 6
        ? r.top - estimatedPickerHeight - 6
        : r.bottom + 6;
    setFocusedIndex(selectedIndex);
    setPos({ top, left: r.left });
  };

  const close = (returnFocus: boolean): void => {
    setPos(null);
    if (returnFocus) btnRef.current?.focus();
  };

  const commit = (v: string): void => {
    onChange(v);
    close(true);
  };

  // Outside click / Escape close the popover, same as ColorSwatch.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setPos(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Roving tabIndex: move real DOM focus to the tile at focusedIndex whenever
  // it changes, so arrow keys behave like a native <select>'s option list.
  useEffect(() => {
    if (open) tileRefs.current[focusedIndex]?.focus();
  }, [open, focusedIndex]);

  const onGridKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const last = SHAPE_PICKER_OPTIONS.length - 1;
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, last));
        break;
      case "ArrowLeft":
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        break;
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + GRID_COLUMNS, last));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - GRID_COLUMNS, 0));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(SHAPE_PICKER_OPTIONS[focusedIndex].value);
        break;
    }
  };

  return (
    <div className={`shape-picker shape-picker-${variant}`}>
      <button
        type="button"
        ref={btnRef}
        className="shape-picker-trigger"
        onClick={(e) => {
          e.stopPropagation();
          if (open) close(false);
          else openAt();
        }}
      >
        <ShapeIcon shape={current.icon} size={16} />
        <span className="shape-picker-label">{current.label}</span>
        <svg
          className="shape-picker-caret"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="shape-picker-popover"
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="shape-picker-grid"
              role="listbox"
              aria-label="Shape"
              onKeyDown={onGridKeyDown}
            >
              {SHAPE_PICKER_OPTIONS.map((o, i) => (
                <div
                  key={o.value}
                  ref={(el) => {
                    tileRefs.current[i] = el;
                  }}
                  role="option"
                  aria-selected={o.value === value}
                  tabIndex={i === focusedIndex ? 0 : -1}
                  className={
                    "shape-picker-tile" + (o.value === value ? " selected" : "")
                  }
                  onClick={() => commit(o.value)}
                  onFocus={() => setFocusedIndex(i)}
                >
                  <ShapeIcon shape={o.icon} size={22} />
                  <span>{o.label}</span>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
