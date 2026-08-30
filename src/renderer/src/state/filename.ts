// Builds the shared filename stem.
//   desktop: 3d5d-insta-MM-DD-HH-MM-object
//   web:     MM-DD-HH-MM-object
// "object" is the first object's label (see objectLabel), slugified for
// filesystem/URL safety.
import { objectLabel, type Project } from "../types";
import { isWebBuild } from "../platform/isWeb";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "object";
}

export function defaultStem(project: Project): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const object = slug(objectLabel(project.objects[0]));
  const prefix = isWebBuild ? stamp : `3d5d-insta-${stamp}`;
  return `${prefix}-${object}`;
}

// Builds a unique default filename: [stem].[ext]
export function defaultFilename(project: Project, ext: string): string {
  return `${defaultStem(project)}.${ext}`;
}
