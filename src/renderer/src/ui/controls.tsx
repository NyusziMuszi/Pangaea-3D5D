import { useState, type CSSProperties, type ReactNode } from "react";
import { totalDuration, type Scalar } from "../types";
import { useStore } from "../state/store";
import { engine } from "../engine/engineSingleton";
import {
  evalScalar,
  hasKeyAt,
  isAnimated,
  keyTimes,
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
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
  className?: string;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section ${className ?? ""}`}>
      <div className="section-head">
        <button className="section-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5.5L17 17.5H7L12 5.5Z" fill="currentColor"/>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 17.5L17 5.5H7L12 17.5Z" fill="currentColor"/>
            </svg>
          )}{" "}
          {title}
        </button>
        {right}
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
    </label>
  );
}

export function ScalarControl({
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
  const project = useStore((s) => s.project);
  const setPlaying = useStore((s) => s.setPlaying);
  const total = totalDuration(project) || 1;
  const value = evalScalar(scalar, playhead);
  const animated = isAnimated(scalar);
  const keyed = hasKeyAt(scalar, playhead);
  const fillPct =
    max > min
      ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
      : 0;

  // The only correct way to move the playhead: seekTo renders the frame and
  // fires onTick -> setPlayhead. Pause first so playback doesn't drift off it.
  const seek = (t: number): void => {
    if (engine.isPlaying) {
      engine.pause();
      setPlaying(false);
    }
    engine.seekTo(t);
  };

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
      {animated && (
        <div className="kf-track">
          {keyTimes(scalar).map((t) => (
            <button
              key={t}
              className={`kf-marker ${Math.abs(t - playhead) < 1e-3 ? "active" : ""}`}
              style={{ left: `${(t / total) * 100}%` }}
              title="Click to jump, double-click to delete"
              onClick={() => seek(t)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onChange(removeKeyAt(scalar, t));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ColorRow({
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
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        className="hex"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </Field>
  );
}
