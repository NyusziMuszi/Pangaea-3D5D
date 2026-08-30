// Whether this is running as the plain browser build (GitHub Pages) rather
// than under Electron. Set once during boot by main.tsx, before
// installWebApi() replaces window.api with the browser shim — kept in its
// own module (rather than webApi.ts) so reading it doesn't drag callers into
// webApi.ts's type-only import of the preload package.
export let isWebBuild = false;

export function markWebBuild(): void {
  isWebBuild = true;
}
