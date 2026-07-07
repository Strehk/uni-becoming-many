// The initial "grid floor" — a spatial reference plane that made flight read as motion
// back when the world was otherwise empty. Now that terrain fills the world it is no
// longer needed, so it is DISABLED by default (see `SHOW_GRID_FLOOR`). Kept here, intact,
// rather than deleted: flip the flag to bring it back for debugging.
//
// Pure TSL — the colour is a function of world XZ position, so the grid stays fixed in the
// world as the player moves over it, with anti-aliased lines every `GRID_CELL` units.

import { Fn, float, min, mix, positionWorld, smoothstep, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

/**
 * Master switch for the initial grid floor. `false` — the terrain world supersedes it, so
 * it is no longer added to the scene. Set to `true` to render it again (e.g. for debugging
 * motion in an empty scene).
 */
export const SHOW_GRID_FLOOR = false;

/** Grid floor cell size, in world units (metres) — a spatial reference so flight is visible. */
const GRID_CELL = 2;

/**
 * Build the grid-floor mesh: a large ground plane whose TSL colour node draws anti-aliased
 * grid lines from world position. Caller decides whether to add it to the scene.
 */
export function createGridFloor(): THREE.Mesh {
  const floorMaterial = new THREE.MeshBasicNodeMaterial();
  floorMaterial.colorNode = Fn(() => {
    const cell = positionWorld.xz.div(GRID_CELL);
    const f = cell.fract();
    const toLine = min(f, f.oneMinus()); // per-axis distance to the nearest grid line
    const line = smoothstep(float(0), float(0.05), min(toLine.x, toLine.y)).oneMinus();
    return vec4(mix(vec3(0.04, 0.06, 0.09), vec3(0.22, 0.32, 0.48), line), 1.0);
  })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), floorMaterial);
  floor.rotation.x = -Math.PI / 2; // lay the XY plane flat onto the XZ ground
  return floor;
}
