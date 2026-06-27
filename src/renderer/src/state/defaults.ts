import type { ObjectState, Project } from "../types";
import {
  BASE_PROJECT,
  BASE_SECOND_OBJECT,
  uid,
} from "./defaultsBase";
import { getPrefs } from "./prefs";

// Pure helpers live in the dependency-free base module; re-exported here so the
// many existing importers of "../state/defaults" keep working unchanged.
export {
  uid,
  instanceFromDef,
  defaultObjectImage,
} from "./defaultsBase";

// Give every effect instance on an object a fresh instanceId, so two projects
// (or two objects) seeded from the same blueprint never share ids.
function regenerateEffectIds(o: ObjectState): void {
  for (const fx of o.effects) fx.instanceId = uid("fx");
}

// A fresh project, seeded from the user's stored blueprint (or BASE_PROJECT when
// nothing is stored). Deep-cloned with fresh segment + effect ids so each new
// project is independent.
export function defaultProject(): Project {
  const next = structuredClone(getPrefs().project ?? BASE_PROJECT) as Project;
  for (const seg of next.segments) seg.id = uid("seg");
  for (const o of next.objects) regenerateEffectIds(o);
  return next;
}

// A fresh optional second object, seeded from the stored blueprint (or
// BASE_SECOND_OBJECT), with regenerated effect ids.
export function defaultSecondObject(): ObjectState {
  const next = structuredClone(
    getPrefs().secondObject ?? BASE_SECOND_OBJECT,
  ) as ObjectState;
  regenerateEffectIds(next);
  return next;
}
