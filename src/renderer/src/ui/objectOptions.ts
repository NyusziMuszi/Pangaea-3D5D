import { PRIMITIVE_MODELS, OBJECT_SURFACES, type ObjectSurface, type PrimitiveModel } from "../types";

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Primitive shapes offered in an object's Type dropdown. Shared by the inspector
// and the timeline object head so both stay in sync.
export const PRIMITIVE_OPTIONS: { value: PrimitiveModel; label: string }[] =
  PRIMITIVE_MODELS.map((v) => ({ value: v, label: cap(v) }));

// How an object's surface is drawn. Shared by the inspector and timeline.
export const SURFACE_OPTIONS: { value: ObjectSurface; label: string }[] =
  OBJECT_SURFACES.map((v) => ({ value: v, label: cap(v) }));
