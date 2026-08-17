// ── Becoming Many — URLs for the files under public/ ──
//
// The world is served from a base path that is not always "/": locally and on a
// root deployment it is, on GitHub Pages it is "/becoming-many-beta/".
// A literal "/creatures/deer_walk.glb" therefore 404s the moment the build is not
// at the domain root. Vite substitutes `import.meta.env.BASE_URL` (always with a
// trailing slash) at build time, so routing every public/ URL through `asset()`
// keeps dev and deployment identical.
//
// Only for files under public/ — modules and files imported from src/ are rewritten
// by the bundler already, and the icaros host sockets ("/ws/…") are paths on ANOTHER
// origin, so neither belongs here.

/** URL of a file in public/, resolved against the deployment base. Leading "/" optional. */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}
