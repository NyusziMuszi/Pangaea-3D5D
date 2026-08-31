// The checkbox group behind every Explore option set, in both panels.
//
// The two panels want different layouts — the Explore panel stacks its boxes in
// a narrow column, Preferences wraps them inline under a Field label — so the
// markup differs by `variant` while the selection logic (what counts as
// checked, and how a click rewrites the set) is shared. That logic living in one
// place is the point: the two panels previously hand-rolled four different
// toggle semantics between them and disagreed about what an emptied set meant.
import { toggleExploreSet } from "../state/exploreSections";
import type { ExploreOption } from "./exploreOptions";

export function ExploreCheckboxGroup<T extends string | number>({
  options,
  selected,
  all,
  optional,
  variant,
  disabledFor,
  titleFor,
  onChange,
}: {
  options: readonly ExploreOption<T>[];
  // The stored set. `undefined` means "all" on the optional axes.
  selected: T[] | undefined;
  // Every legal value, for the "emptying re-selects all" rule.
  all: readonly T[];
  // True for axes stored as `T[] | undefined` (undefined = all).
  optional?: boolean;
  variant: "stack" | "inline";
  // An option that cannot apply yet (e.g. "image" with no palette images).
  disabledFor?: (value: T) => boolean;
  titleFor?: (value: T) => string | undefined;
  onChange: (next: T[] | undefined) => void;
}): JSX.Element {
  const stack = variant === "stack";
  const labelClass = stack ? "lucky-radio" : "checkbox-inline-label";
  const Group = stack ? "div" : "span";
  return (
    <Group className={stack ? "lucky-radio-group" : "field-control"}>
      {options.map((o) => {
        const disabled = disabledFor?.(o.value) ?? false;
        return (
          <label className={labelClass} key={String(o.value)} title={titleFor?.(o.value)}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={!selected || selected.includes(o.value)}
              onChange={() => onChange(toggleExploreSet(selected, o.value, all, { optional }))}
            />
            <span>{o.label}</span>
          </label>
        );
      })}
    </Group>
  );
}
