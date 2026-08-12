// The still-mode invariant: in a still, objects[0] (image) and objects[1]
// (mesh) are two views of the SAME picture on the SAME plane, so displace/
// relief deform exactly what layer 0 shows. Layer 0 is the source of truth;
// layer 1 mirrors its shape and image. Transforms and effects stay
// independent — that's the whole point of layer 1 existing.
//
// normalizeStill runs from the store after every edit (see store.ts), so no
// panel needs to remember to keep the two layers in sync — image import, the
// preview drag-pan, and any future editor all funnel through it for free.
import {
  constant,
  isStill,
  STILL_IMAGE_LAYER,
  STILL_MESH_LAYER,
  STILL_MESH_SURFACES,
  STILL_SHAPE_LAYER,
  type HingeEdge,
  type ObjectState,
  type Project,
} from "../types";
import { STILL_HINGE_LAYOUTS } from "./defaultsBase";

export function normalizeStill(p: Project): void {
  if (!isStill(p)) return;
  const img = p.objects[STILL_IMAGE_LAYER];
  const mesh = p.objects[STILL_MESH_LAYER];
  if (!img || !mesh) return;
  img.surface = "image";
  mesh.primitive = img.primitive;
  mesh.modelName = img.modelName;
  mesh.modelDataUrl = img.modelDataUrl;
  mesh.mapping = img.mapping;
  mesh.image = structuredClone(img.image); // asset id + keyframeable pan
  if (!(STILL_MESH_SURFACES as readonly string[]).includes(mesh.surface)) {
    mesh.surface = "wireframe";
  }

  // The optional 3D shape layer is a free peer in every respect — its own
  // primitive, mapping, surface, effects and transform — except which
  // picture it wears. Only the image mirrors, so it reads as carved from
  // the same photo without inheriting the flat layer's shape.
  const shape = p.objects[STILL_SHAPE_LAYER];
  if (shape) shape.image = structuredClone(img.image);
}

// Switching the hinge re-lays-out the card from the blueprint for that edge,
// rather than mirroring whatever transform is currently there: the tilt has
// to move between the X and Y axis when the hinge goes from a vertical to a
// horizontal edge, and there is no meaningful mirror of an arbitrary
// (possibly keyframed) tilt across that swap. Both still layers are reset —
// the mesh layer's transform is only a fallback for when the fold is off,
// but it should still match the photo if that happens.
export function applyHingeEdge(p: Project, edge: HingeEdge): void {
  if (!isStill(p)) return;
  const layout = STILL_HINGE_LAYOUTS[edge];
  p.fold = {
    enabled: p.fold?.enabled ?? true,
    edge,
    angle: constant(layout.angle),
  };
  for (const i of [STILL_IMAGE_LAYER, STILL_MESH_LAYER]) {
    const o = p.objects[i];
    if (!o) continue;
    o.rotX = constant(layout.rotX);
    o.rotY = constant(layout.rotY);
    o.posX = constant(layout.posX);
    o.posY = constant(layout.posY);
  }
}

// Whose image a pan gesture (or "Load image" click) edits. In a still, always
// the image layer — panning the mesh layer would be immediately overwritten
// by normalizeStill on the next edit.
export function imageOwner(
  p: Project,
  selected: number,
): ObjectState | undefined {
  if (isStill(p)) return p.objects[STILL_IMAGE_LAYER];
  return p.objects[selected] ?? p.objects[0];
}
