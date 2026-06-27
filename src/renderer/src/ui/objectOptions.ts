import type { ObjectSurface, PrimitiveModel } from "../types";

// Primitive shapes offered in an object's Type dropdown. Shared by the inspector
// and the timeline object head so both stay in sync.
export const PRIMITIVE_OPTIONS: { value: PrimitiveModel; label: string }[] = [
  { value: "plane", label: "Plane" },
  { value: "sphere", label: "Sphere" },
  { value: "portal", label: "Portal" },
  { value: "cylinder", label: "Cylinder" },
  { value: "capsule", label: "Capsule" },
  { value: "torus", label: "Torus" },
  { value: "box", label: "Box" },
  { value: "lathe", label: "Lathe" },
  { value: "knot", label: "Knot" },
  { value: "twist", label: "Twist" },
  { value: "polyhedron", label: "Polyhedron" },
  { value: "dodecahedron", label: "Dodecahedron" },
];

// How an object's surface is drawn. Shared by the inspector and timeline.
export const SURFACE_OPTIONS: { value: ObjectSurface; label: string }[] = [
  { value: "image", label: "Image" },
  { value: "silhouette", label: "Silhouette" },
  { value: "wireframe", label: "Wireframe" },
  { value: "faceted", label: "Faceted" },
];
