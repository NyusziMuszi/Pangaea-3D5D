import { findEffectDef } from "../engine/effects/catalog";
import { constant, type EffectDef, type ObjectState, type Scalar } from "../types";

export interface KfChannel {
  key: string;
  section: string;
  property: string;
  scalar: Scalar;
  apply: (o: ObjectState, s: Scalar) => void;
}

const TRANSFORM: { field: keyof ObjectState; label: string }[] = [
  { field: "rotX", label: "Rotate X" },
  { field: "rotY", label: "Rotate Y" },
  { field: "rotZ", label: "Rotate Z" },
  { field: "scale", label: "Scale" },
  { field: "posX", label: "Position X" },
  { field: "posY", label: "Position Y" },
  { field: "posZ", label: "Position Z" },
];

export function objectKeyframeChannels(
  obj: ObjectState,
  customEffects: EffectDef[],
): KfChannel[] {
  const out: KfChannel[] = [];

  for (const { field, label } of TRANSFORM) {
    out.push({
      key: `transform:${field}`,
      section: "Transform",
      property: label,
      scalar: (obj[field] as Scalar | undefined) ?? constant(0),
      apply: (o, s) => {
        (o[field] as Scalar) = s;
      },
    });
  }

  for (const inst of obj.effects) {
    const def = findEffectDef(inst.defId, customEffects);
    if (!def) continue;
    for (const u of def.uniforms) {
      out.push({
        key: `${inst.instanceId}:${u.name}`,
        section: def.name,
        property: u.label,
        scalar: inst.values[u.name] ?? constant(u.default),
        apply: (o, s) => {
          const t = o.effects.find((e) => e.instanceId === inst.instanceId);
          if (t) t.values[u.name] = s;
        },
      });
    }
  }

  return out;
}
