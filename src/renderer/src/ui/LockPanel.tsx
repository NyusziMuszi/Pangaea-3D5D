import { useStore } from "../state/store";

// Floating panel (anchored off the library's right edge) holding the per-category
// "lock" toggles. Lifted out of the Explore section so it only appears once a scene
// exists to lock and re-roll. Lock state lives in project.lucky.locks; locked
// categories are restored from the pre-roll project inside generateLuckyScene.
export function LockPanel(): JSX.Element {
  const lucky = useStore((s) => s.project.lucky);
  const update = useStore((s) => s.update);

  return (
    <div className="lock-panel">
      <div className="subhead">Lock</div>
      <div className="lucky-radio-group">
        {(["colours", "motion", "effects", "objects"] as const).map((k) => (
          <label className="lucky-radio" key={k}>
            <input
              type="checkbox"
              checked={!!lucky.locks?.[k]}
              onChange={() =>
                update((p) => {
                  if (!p.lucky.locks) {
                    p.lucky.locks = {
                      colours: false,
                      motion: false,
                      effects: false,
                      objects: false,
                    };
                  }
                  p.lucky.locks[k] = !p.lucky.locks[k];
                })
              }
            />
            <span>
              {
                {
                  colours: "Colours",
                  motion: "Motion",
                  effects: "Effects",
                  objects: "Objects",
                }[k]
              }
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
