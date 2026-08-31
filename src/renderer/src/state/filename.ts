// Builds the shared filename stem.
//   desktop: 3d-5d-MM-DD-HH-MM-shape[-shape2]
//   web:     MM-DD-HH-MM-shape[-shape2]
// "shape[-shape2]" lists every object's label (see objectLabel), slugified
// for filesystem/URL safety.
import { objectLabel, type Project } from "../types";
import { branding } from "@branding";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "object";
}

export function defaultStem(project: Project): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const shapes = project.objects.length
    ? project.objects.map((o) => slug(objectLabel(o))).join("-")
    : "scene";
  const prefix = `${branding.filenamePrefix}${stamp}`;
  return `${prefix}-${shapes}`;
}

// Builds a unique default filename: [stem].[ext]
export function defaultFilename(project: Project, ext: string): string {
  return `${defaultStem(project)}.${ext}`;
}
