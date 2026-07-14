// ── SenseSurface — the contract between a scene and the sense layers ──
//
// Ported from ShaderSinneModul `src/core/surface.js`.
//
// A scene (here: the streamed terrain) describes the physical properties of a surface;
// each sense layer reads exactly the field it perceives. All fields optional:
//
//   albedo    vec3 (white)   visible colour            → "Wahrnehmbare Farben"
//   tempK     Kelvin (293)   surface temperature       → "Infrarot"
//   uvSignal  0..1 (0)       organic UV reflectance    → "UV-Reflexion"
//   distance  world metres   camera-view depth override → "Echoortung"
//   light     0..1           lighting factor (shading of the colours)

import { clamp, dot, normalWorld, positionView, positionWorld, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { F, type FloatLike, type Vec3Like } from "./uniforms.ts";

/** What a scene provides per surface (all optional; numbers auto-wrap to nodes). */
export interface SurfaceDesc {
  albedo?: Vec3Like;
  tempK?: FloatLike;
  uvSignal?: FloatLike;
  distance?: FloatLike;
  light?: FloatLike;
  thermalBird?: FloatLike;
  thermalTree?: FloatLike;
  thermalGround?: FloatLike;
  thermalGrass?: FloatLike;
  thermalWater?: FloatLike;
  thermalObjectVariation?: FloatLike;
  thermalCenter?: Vec3Like;
  thermalRadius?: FloatLike;
}

/** The normalized surface every sense's `build()` reads. */
export interface SenseSurface {
  albedo: Node<"vec3">;
  tempK: Node<"float">;
  uvSignal: Node<"float">;
  distance: Node<"float">;
  light: Node<"float">;
  thermalBird: Node<"float">;
  thermalTree: Node<"float">;
  thermalGround: Node<"float">;
  thermalGrass: Node<"float">;
  thermalWater: Node<"float">;
  thermalObjectVariation: Node<"float">;
  thermalCenter: Node<"vec3">;
  thermalRadius: Node<"float">;
}

// Fixed fallback sun — only for the default Lambert shading when a host scene
// provides no `light` of its own. The terrain passes its own factor instead.
export const SUN_DIR = vec3(0.4, 0.75, 0.3).normalize();

export function lambertLight(strength = 0.8, ambient = 0.35): Node<"float"> {
  return clamp(dot(normalWorld, SUN_DIR), 0.0, 1.0).mul(strength).add(ambient);
}

export function normalizeSurface(desc: SurfaceDesc = {}): SenseSurface {
  return {
    albedo: desc.albedo !== undefined ? desc.albedo.rgb : vec3(1.0, 1.0, 1.0),
    tempK: F(desc.tempK ?? 293.0),
    uvSignal: F(desc.uvSignal ?? 0.0),
    // Use view-space camera depth by default, not radial world distance. This gives
    // echolocation a real perspective depth field: fragments on the same camera
    // plane share the same depth, matching the renderer's depth buffer semantics.
    distance: desc.distance !== undefined ? F(desc.distance) : positionView.z.negate(),
    light: desc.light !== undefined ? F(desc.light) : lambertLight(),
    thermalBird: F(desc.thermalBird ?? 0.0),
    thermalTree: F(desc.thermalTree ?? 0.0),
    thermalGround: F(desc.thermalGround ?? 0.0),
    thermalGrass: F(desc.thermalGrass ?? 0.0),
    thermalWater: F(desc.thermalWater ?? 0.0),
    thermalObjectVariation: F(desc.thermalObjectVariation ?? 0.0),
    thermalCenter: desc.thermalCenter !== undefined ? desc.thermalCenter.rgb : positionWorld,
    thermalRadius: F(desc.thermalRadius ?? 1.0),
  };
}
