import { type ReactNode } from "react";
import { useStore } from "../state/store";
import { getPrefs } from "../state/prefs";
import { ALL_UNLOCKED } from "../types";

// Lucide icons (github.com/lucide-icons/lucide), inlined so their
// stroke="currentColor" tracks the label's actual text colour.
function Icon({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function LockIcon(): JSX.Element {
  return (
    <Icon>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  );
}

function PaletteIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    </Icon>
  );
}

function MoveIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M12 2v20" />
      <path d="m15 19-3 3-3-3" />
      <path d="m19 9 3 3-3 3" />
      <path d="M2 12h20" />
      <path d="m5 9-3 3 3 3" />
      <path d="m9 5 3-3 3 3" />
    </Icon>
  );
}

function WandIcon(): JSX.Element {
  return (
    <Icon>
      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
      <path d="m14 7 3 3" />
      <path d="M5 6v4" />
      <path d="M19 14v4" />
      <path d="M10 2v2" />
      <path d="M7 8H3" />
      <path d="M21 16h-4" />
      <path d="M11 3H9" />
    </Icon>
  );
}

function ShapesIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <circle cx="17.5" cy="17.5" r="3.5" />
    </Icon>
  );
}

function SurfaceIcon(): JSX.Element {
  return (
    <Icon>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </Icon>
  );
}

const LOCK_ICONS: Record<
  "colours" | "motion" | "effects" | "objects" | "surface",
  () => JSX.Element
> = {
  colours: PaletteIcon,
  motion: MoveIcon,
  effects: WandIcon,
  objects: ShapesIcon,
  surface: SurfaceIcon,
};

// Floating panel (anchored off the library's right edge) holding the per-category
// "lock" toggles (colours/motion/effects/objects/surface). Lifted out of the Explore
// section so it only appears once a scene exists to lock and re-roll. Lock state
// lives in project.lucky.locks; locked categories are restored from the pre-roll
// project inside generateLuckyScene.
export function LockPanel(): JSX.Element {
  const project = useStore((s) => s.project);
  const lucky = project.lucky;
  const update = useStore((s) => s.update);

  return (
    <div className="lock-panel">
      <div className="subhead">
        <span className="btn-with-icon">
          <LockIcon />
          Lock
        </span>
      </div>
      <div className="lucky-radio-group">
        {(["colours", "motion", "effects", "objects", "surface"] as const).map((k) => {
          const OptionIcon = LOCK_ICONS[k];
          return (
            <label className="lucky-radio" key={k}>
              <input
                type="checkbox"
                checked={!!lucky.locks?.[k]}
                onChange={() => {
                  const turningOn = !lucky.locks?.[k];
                  update((p) => {
                    if (!p.lucky.locks) {
                      p.lucky.locks = {
                        colours: false,
                        motion: false,
                        effects: false,
                        objects: false,
                        surface: false,
                      };
                    }
                    p.lucky.locks[k] = !p.lucky.locks[k];
                  });
                  // Credit taste right when the lock engages, not on every
                  // re-roll while it stays on — otherwise leaving a category
                  // locked through many rolls would keep piling weight onto
                  // the same value and skew far past what a deliberate signal
                  // should be. One click, one signal, until unlocked again.
                  if (turningOn && useStore.getState().hasGenerated) {
                    getPrefs().recordLocks(
                      project,
                      { ...ALL_UNLOCKED, [k]: true },
                      useStore.getState().lastLuckyColorScheme,
                    );
                  }
                }}
              />
              <OptionIcon />
              <span>
                {
                  {
                    colours: "Colours",
                    motion: "Motion",
                    effects: "Effects",
                    objects: "Objects",
                    surface: "Surface",
                  }[k]
                }
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
