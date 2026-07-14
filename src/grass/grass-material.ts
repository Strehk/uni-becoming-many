// ── Becoming Many — Grass Material ─────────────────────────────
//
// One UNLIT `MeshBasicNodeMaterial` per LOD. The vertex node reconstructs a bezier blade
// from the packed compute data (read via this LOD's visible-index buffer), winds + sways
// it, aligns it to the terrain normal, and thickens it view-dependently. The fragment
// runs the blade through the SAME sense-layer compositor as terrain + flora, then the
// shared void look — distanceFog → viewReveal → fresnel rim → master worldReveal — so a
// sense transition restyles grass, ground and plants together (echo reads grass as pure
// depth, etc.), and the grass is invisible in the empty white void.
//
// UNLIT is load-bearing: the scene has NO lights (see terrain/flora materials). Lighting
// flows through the compositor's `light` field — a lambert term from the blade normal.
// `normalWorld` can't be used (it reflects the flat plane, not the deformed blade), so
// fresnel + lambert are hand-rolled from a world-space blade-normal varying.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes from
// `three/webgpu`. No GLSL.

import {
  Fn,
  clamp,
  cross,
  float,
  floor,
  instanceIndex,
  length,
  max,
  mix,
  normalize,
  oneMinus,
  positionView,
  pow,
  select,
  smoothstep,
  sqrt,
  uint,
  uv,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import { cameraPos } from "../render/camera-pos.ts";
import { distanceFog, viewReveal } from "../render/tsl-kit.ts";
import type { KitUniforms, TerrainLayerCompositor } from "../terrain/index.ts";
import type { GrassMaterialUniforms, GrassSharedUniforms } from "./config.ts";
import type { GrassData, LODBuffer } from "./grass-geometry.ts";
import {
  applySlopeAlignment,
  applyViewDependentTilt,
  applyWindPush,
  bezier3,
  bezier3Tangent,
  getBezierControlPoints,
  safeNormalize2D,
  vertexSwayOffset,
} from "./tsl/blade.ts";

/** Sun direction the lambert term reads (matches terrain/flora). */
const SUN = vec3(0.4, 0.75, 0.3).normalize();

export interface GrassMaterialHandle {
  material: MeshBasicNodeMaterial;
  /** Rebuild colorNode after a structural sense change (blend mode / layer order). */
  rewire(): void;
}

export function createGrassMaterial(
  grass: GrassData,
  indices: LODBuffer["indices"],
  um: GrassMaterialUniforms,
  us: GrassSharedUniforms,
  u: KitUniforms,
  layers?: TerrainLayerCompositor,
): GrassMaterialHandle {
  const material = new MeshBasicNodeMaterial();
  material.side = THREE.DoubleSide;

  // Vertex → fragment varyings.
  const vBladeNormalWorld = varying(vec3(0));
  const vHeightT = varying(float(0));
  const vWorldPos = varying(vec3(0));
  const vClumpSeed = varying(float(0));
  const vBladeSeed = varying(float(0));

  // ── Vertex: reconstruct the blade in world space ──
  const grassVertex = Fn(() => {
    const slot = uint(indices.element(instanceIndex)).mul(4);
    const d0 = grass.element(slot);
    const d1 = grass.element(slot.add(1));
    const d2 = grass.element(slot.add(2));
    const d3 = grass.element(slot.add(3));

    const instancePos = d0.xyz;
    const bladeType = floor(d0.w.mul(3));
    const width = d1.x;
    const height = d1.y;
    const bend = d1.z;
    const windStrength01 = d1.w;
    const rotSin = d2.x;
    const rotCos = d2.y;
    const clumpSeed01 = d2.z;
    const perBladeHash01 = d2.w;
    const tnX = d3.x;
    const tnZ = d3.y;
    const tnY = sqrt(max(float(0), oneMinus(tnX.mul(tnX).add(tnZ.mul(tnZ)))));
    const tn = vec3(tnX, tnY, tnZ);

    // Yaw about the base (packed as sin/cos), applied to an XZ vector.
    const rotateFast = (v: ReturnType<typeof vec2>) =>
      vec2(v.x.mul(rotCos).sub(v.y.mul(rotSin)), v.x.mul(rotSin).add(v.y.mul(rotCos)));

    const worldXZ = vec2(instancePos.x, instancePos.z);
    const dist = length(cameraPos.sub(instancePos));
    const windFalloff = select(
      um.uWindDistanceEnd.greaterThan(float(0)),
      oneMinus(smoothstep(um.uWindDistanceStart, um.uWindDistanceEnd, dist)),
      float(1),
    );
    const windStrength = windStrength01.mul(windFalloff);

    const uvCoords = uv();
    const t = uvCoords.y; // 0 base → 1 tip
    const s = uvCoords.x.sub(0.5).mul(2); // -1 … 1 across width

    // Bezier control points + wind push (tip pushed most).
    const p0 = vec3(0, 0, 0);
    const p3base = vec3(0, height, 0);
    const ctrl = getBezierControlPoints(bladeType, height, bend);
    const wd = safeNormalize2D(us.uWindDir);
    const windDir3 = vec3(wd.x, 0, wd.y);
    const pushed = applyWindPush(windDir3, ctrl.p1, ctrl.p2, p3base, windStrength, height);

    const spine = bezier3(p0, pushed.p1, pushed.p2, pushed.p3, t);
    const tangent = normalize(bezier3Tangent(p0, pushed.p1, pushed.p2, pushed.p3, t));
    const side = normalize(cross(vec3(0, 0, 1), tangent));

    const sway = vertexSwayOffset(
      windDir3,
      us.uTime,
      um.uWindSwayFreqMin,
      um.uWindSwayFreqMax,
      um.uWindSwayStrength,
      side,
      t,
      height,
      windStrength,
      perBladeHash01,
      worldXZ,
    );
    const normal = normalize(cross(side, tangent));

    const widthFactor = t.add(um.uBaseWidth).mul(pow(oneMinus(t), um.uTipThin));
    const lposBase = spine.add(sway).add(side.mul(width).mul(widthFactor).mul(s));
    const lposXZ = rotateFast(vec2(lposBase.x, lposBase.z));
    const lpos = vec3(lposXZ.x, lposBase.y, lposXZ.y).toVar();

    const normXZ = rotateFast(vec2(normal.x, normal.z));
    const normalRotated = vec3(normXZ.x, normal.y, normXZ.y).toVar();
    const sideXZ = rotateFast(vec2(side.x, side.z));
    const sideRotated = normalize(vec3(sideXZ.x, side.y, sideXZ.y)).toVar();
    const tanXZ = rotateFast(vec2(tangent.x, tangent.z));
    const tangentRotated = normalize(vec3(tanXZ.x, tangent.y, tanXZ.y)).toVar();

    applySlopeAlignment(tn, lpos, tangentRotated, sideRotated, normalRotated);

    const worldPos = instancePos.add(lpos);
    const camDirW = normalize(cameraPos.sub(worldPos));
    const tilted = applyViewDependentTilt(
      lpos,
      sideRotated,
      normalRotated,
      uvCoords.x,
      t,
      um.uThicknessStrength,
      camDirW,
    );
    const worldPosFinal = instancePos.add(tilted);

    vBladeNormalWorld.assign(normalRotated);
    vHeightT.assign(t);
    vWorldPos.assign(worldPosFinal);
    vClumpSeed.assign(clumpSeed01);
    vBladeSeed.assign(perBladeHash01);
    return worldPosFinal;
  });

  // Group is translation-only → local position = worldPosFinal − groupOffset.
  material.positionNode = Fn(() => grassVertex().sub(um.uGroupOffset))();

  // ── Fragment: albedo → sense compositor → void look ──
  const rewire = (): void => {
    const reveal = viewReveal(u.viewRadius, u.revealSoftness);

    const gradient = mix(um.uBaseColor, um.uTipColor, vHeightT);
    const clumpTint = mix(um.uClumpSeedRange.x, um.uClumpSeedRange.y, vClumpSeed);
    const bladeTint = mix(um.uBladeSeedRange.x, um.uBladeSeedRange.y, vBladeSeed);
    const ao = mix(float(0.35), float(1), clamp(pow(vHeightT, um.uAOPower), 0, 1));
    const albedo = gradient.mul(clumpTint).mul(bladeTint).mul(ao);

    const nWorld = normalize(vBladeNormalWorld);
    const facing = nWorld.dot(SUN).clamp(0, 1);

    let base: Node<"vec3"> | Node<"color"> = albedo;
    if (layers) {
      base = layers.buildColorNode({
        albedo,
        tempK: float(293).add(facing.mul(8)), // grass ~ a touch cool, sun-warmed
        uvSignal: float(0.3),
        distance: positionView.z.negate(),
        light: facing.mul(0.65).add(0.35),
      });
    }

    const fogged = distanceFog(base, u.fogColor, u.fogNear, u.fogFar);

    // Fresnel rim from the blade normal (normalWorld would read the flat plane).
    const viewDir = normalize(cameraPos.sub(vWorldPos));
    const fresnel = oneMinus(nWorld.dot(viewDir).clamp(0, 1)).pow(u.rimPower);
    const rim = fresnel.mul(u.rimStrength).mul(reveal);
    const styled = mix(u.fogColor, fogged, reveal).add(u.rimColor.mul(rim));

    material.colorNode = mix(u.fogColor, styled, u.worldReveal);
    material.needsUpdate = true;
  };
  rewire();

  return { material, rewire };
}
