/**
 * Shoreline helpers shared by the water builders (verbatim from WolrdGen3's
 * ShorelineBuilder). The shore transition is a per-vertex tint on the water:
 * shallow water lightens toward foam, deep water darkens toward open-water blue.
 */

const DEEP: [number, number, number] = [0.04, 0.13, 0.28];
const SHALLOW: [number, number, number] = [0.22, 0.43, 0.52];
const FOAM: [number, number, number] = [0.55, 0.62, 0.6];

/**
 * Water vertex colour from depth (world units, surface − bed).
 * @param depth   surface height minus terrain bed height, in world units.
 * @param river   true for river water (slightly greener/calmer tint).
 */
export function waterVertexColor(depth: number, river: boolean): [number, number, number] {
  const d = Math.max(0, depth);
  const deepT = Math.min(1, d / 14);
  const r = SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * deepT;
  const g = SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * deepT;
  const b = SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * deepT;
  const foam = Math.max(0, 1 - d / 1.5) * 0.5;
  let cr = r + (FOAM[0] - r) * foam;
  let cg = g + (FOAM[1] - g) * foam;
  let cb = b + (FOAM[2] - b) * foam;
  if (river) {
    cr *= 0.95;
    cg = Math.min(1, cg * 1.05);
    cb *= 0.98;
  }
  return [cr, cg, cb];
}
