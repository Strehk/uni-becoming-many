// ── Becoming Many — Grass Compute ──────────────────────────────
//
// The per-frame compute kernel: for each of the ~590 k blades it derives a world
// position (grid + PCG jitter, world-stable via the global grid index), frustum+circle
// culls, GATES on the grass mask (so grass only exists on fitting biomes), samples the
// field texture for height/normal, does Voronoi clumping + wind facing, packs the result
// into one vec4 buffer (4 vec4 per blade), and atomically appends its index to the matching
// LOD's indirect-draw buffer. A tiny reset kernel zeroes the draw counters each frame.
//
// One packed data buffer (not four) is deliberate: WebGPU allows only 8 storage buffers per
// shader stage, and the compute already needs 3 LOD index + 3 LOD draw buffers — four data
// buffers would total 10 and fail pipeline creation. 1 + 3 + 3 = 7 fits.
//
// Ported from momentchan/false-earth `core/grassCompute.ts`, with the analytic terrain
// swapped for `sampleField` (the CPU→GPU bridge) + a mask gate, and character-push
// dropped. Structure mirrors the repo's own GPU code (`senses/duft/scent-field.ts`):
// one big `Fn(() => …)`, inference-typed, no `any`.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes from
// `three/webgpu`. No GLSL.

import {
  Fn,
  If,
  abs,
  atan,
  atomicAdd,
  atomicStore,
  cos,
  dot,
  float,
  floor,
  fract,
  instanceIndex,
  int,
  length,
  mix,
  oneMinus,
  round,
  sin,
  sqrt,
  uint,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type * as THREE from "three/webgpu";
import {
  BLADES_PER_AXIS,
  BLADE_SPACING,
  GRASS_AREA_SIZE,
  type GrassComputeUniforms,
  type GrassSharedUniforms,
} from "./config.ts";
import type { GrassData, LODBuffer } from "./grass-geometry.ts";
import { hash2to1, hash2to2 } from "./tsl/hash.ts";
import type { FloatNode } from "./tsl/nodes.ts";
import { sampleField } from "./tsl/terrain-sample.ts";
import { applyWindFacingAndNormalize, calculateWindStrength } from "./tsl/wind.ts";

const CLUMP_OFFSETS: readonly [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export function createGrassCompute(
  grass: GrassData,
  lodBuffers: LODBuffer[],
  uc: GrassComputeUniforms,
  us: GrassSharedUniforms,
  fieldTex: THREE.Texture,
  texRes: number,
): { compute: THREE.ComputeNode; reset: THREE.ComputeNode } {
  const HALF = GRASS_AREA_SIZE * 0.5;

  const compute = Fn(() => {
    // ── World position: grid cell + PCG jitter, keyed on the GLOBAL index ──
    const uIdx = uint(instanceIndex);
    const iGridX = uIdx.div(uint(BLADES_PER_AXIS));
    const iGridZ = uIdx.mod(uint(BLADES_PER_AXIS));
    const globalGridX = int(iGridX).add(int(round(uc.uGridIndex.x)));
    const globalGridZ = int(iGridZ).add(int(round(uc.uGridIndex.y)));

    const jitter = hash2to2(globalGridX, globalGridZ);
    const jx = jitter.x.sub(0.5).mul(float(BLADE_SPACING));
    const jz = jitter.y.sub(0.5).mul(float(BLADE_SPACING));
    const px = float(iGridX).div(float(BLADES_PER_AXIS)).sub(0.5).mul(float(GRASS_AREA_SIZE));
    const pz = float(iGridZ).div(float(BLADES_PER_AXIS)).sub(0.5).mul(float(GRASS_AREA_SIZE));
    const worldPos = vec3(px.add(jx), float(0), pz.add(jz)).add(uc.uGroupOffset);
    const worldXZ = vec2(worldPos.x, worldPos.z);

    // ── Cull stage 1: cheap XZ circle around the patch centre (no height needed) ──
    const diff = worldPos.sub(uc.uCameraPosition);
    const isClose = abs(diff.x).add(abs(diff.z)).lessThan(float(3));
    const inCircle = length(worldPos.sub(uc.uGroupOffset)).lessThan(float(HALF));

    If(isClose.or(inCircle), () => {
      const field = sampleField(fieldTex, worldXZ, uc.uFieldTexOrigin, uc.uFieldTexSize, texRes);

      // ── Mask gate: no grass off fitting ground (never routed → zero draw cost) ──
      If(field.mask.greaterThan(uc.uMaskThreshold), () => {
        const finalPos = vec3(worldPos.x, field.height, worldPos.z); // absolute Y
        const tn = field.normal;

        // ── Cull stage 2: frustum at the REAL terrain height (worldPos.y is 0 above;
        // this world's absolute Y is large, so testing the true height is essential —
        // otherwise nearly every blade is wrongly culled). Gates LOD routing only.
        const distToCamera = length(finalPos.sub(uc.uCameraPosition));
        const radius = float(1.5);
        const clip = uc.uViewProjectionMatrix.mul(vec4(finalPos, float(1)));
        const inFrustum = clip.w
          .greaterThan(radius.negate())
          .and(abs(clip.x).lessThan(clip.w.add(radius)))
          .and(abs(clip.y).lessThan(clip.w.add(radius)))
          .and(clip.z.lessThan(clip.w.add(radius)));
        const onScreen = isClose.or(inFrustum);

        // ── Voronoi clumping → per-clump blade dims + a soft blend at borders ──
        const bladesPerClump = uc.uClumpSize.div(float(BLADE_SPACING));
        const cellX = floor(float(globalGridX).div(bladesPerClump));
        const cellZ = floor(float(globalGridZ).div(bladesPerClump));
        const localPos = vec2(
          fract(float(globalGridX).div(bladesPerClump)),
          fract(float(globalGridZ).div(bladesPerClump)),
        );
        const minD2 = float(1e9).toVar();
        const secondMinD2 = float(1e9).toVar();
        const bestID = vec2(0).toVar();
        const secondBestID = vec2(0).toVar();
        const bestDiff = vec2(0).toVar();
        for (const [ox, oy] of CLUMP_OFFSETS) {
          const nX = cellX.add(float(ox));
          const nZ = cellZ.add(float(oy));
          const rand = hash2to2(int(nX), int(nZ));
          const point = vec2(float(ox), float(oy)).add(rand);
          const d = point.sub(localPos);
          const d2 = dot(d, d);
          If(d2.lessThan(minD2), () => {
            secondMinD2.assign(minD2);
            secondBestID.assign(bestID);
            bestDiff.assign(d);
            minD2.assign(d2);
            bestID.assign(vec2(nX, nZ));
          }).ElseIf(d2.lessThan(secondMinD2), () => {
            secondMinD2.assign(d2);
            secondBestID.assign(vec2(nX, nZ));
          });
        }
        const centerFactor = sqrt(secondMinD2)
          .sub(sqrt(minD2))
          .smoothstep(float(0), uc.uClumpBlendSmoothness);
        const toCenter = bestDiff.mul(uc.uClumpSize);
        const blendFactor = mix(float(0.5), float(1), centerFactor);

        const clumpParams = (idx: FloatNode, idy: FloatNode) => {
          const ix = int(idx);
          const iy = int(idy);
          return {
            height: mix(uc.uBladeHeightMin, uc.uBladeHeightMax, hash2to1(ix, iy)),
            width: mix(uc.uBladeWidthMin, uc.uBladeWidthMax, hash2to1(ix.add(123), iy.add(456))),
            bend: mix(uc.uBendAmountMin, uc.uBendAmountMax, hash2to1(ix.add(789), iy.add(101))),
            type: hash2to1(ix.add(999), iy.add(999)),
          };
        };
        const p1 = clumpParams(bestID.x, bestID.y);
        const p2 = clumpParams(secondBestID.x, secondBestID.y);
        const height = mix(p2.height, p1.height, blendFactor);
        const width = mix(p2.width, p1.width, blendFactor);
        const bend = mix(p2.bend, p1.bend, blendFactor);
        const type = p1.type;

        // ── Per-blade size jitter ──
        const randX = uc.uBladeRandomness.x;
        const randY = uc.uBladeRandomness.y;
        const randZ = uc.uBladeRandomness.z;
        const seed1 = hash2to1(globalGridX, globalGridZ);
        const seed2 = hash2to1(globalGridX.add(1), globalGridZ);
        const seed3 = hash2to1(globalGridX.add(2), globalGridZ);
        const finalHeight = height.mul(mix(oneMinus(randX), float(1).add(randX), seed1));
        const finalWidth = width.mul(mix(oneMinus(randY), float(1).add(randY), seed2));
        const finalBend = bend.mul(mix(oneMinus(randZ), float(1).add(randZ), seed3));

        // ── Yaw: lean toward the clump centre + per-blade + per-clump jitter ──
        const perBladeHash01 = seed1;
        const clumpSeed01 = hash2to1(int(bestID.x).add(47), int(bestID.y).add(31));
        const clumpHash = hash2to1(int(bestID.x), int(bestID.y));
        const baseAngle = atan(toCenter.y, toCenter.x)
          .mul(uc.uCenterYaw)
          .mul(centerFactor)
          .add(perBladeHash01.sub(0.5).mul(uc.uBladeYaw))
          .add(clumpHash.sub(0.5).mul(uc.uClumpYaw).mul(centerFactor));

        // ── Wind facing ──
        const windStrength01 = calculateWindStrength(
          worldXZ,
          us.uWindDir,
          uc.uWindScale,
          us.uTime,
          uc.uWindSpeed,
          uc.uWindStrength,
        );
        const facing01 = applyWindFacingAndNormalize(
          baseAngle,
          windStrength01,
          us.uWindDir,
          uc.uWindFacing,
        );
        const angleRad = facing01.mul(6.28318);

        // ── Pack (4 vec4 per blade at base = index*4) ──
        const slot = uint(instanceIndex).mul(4);
        grass.element(slot).assign(vec4(finalPos, type));
        grass.element(slot.add(1)).assign(vec4(finalWidth, finalHeight, finalBend, windStrength01));
        grass
          .element(slot.add(2))
          .assign(vec4(sin(angleRad), cos(angleRad), clumpSeed01, perBladeHash01));
        grass.element(slot.add(3)).assign(vec4(tn.x, tn.z, float(0), float(0)));

        // ── Route on-screen blades to a LOD by (noisy) distance ──
        If(onScreen, () => {
          routeLOD(distToCamera);
        });
      });
    });
  })().compute(BLADES_PER_AXIS * BLADES_PER_AXIS);

  // Add-noise-to-distance LOD selection, then atomic-append to that LOD's draw buffer.
  function routeLOD(distToCamera: FloatNode): void {
    const noiseSeed = fract(float(instanceIndex).mul(0.12345)).mul(2).sub(1);
    const noisy = distToCamera.add(distToCamera.mul(uc.uLODNoiseScale).mul(noiseSeed));

    const append = (lod: LODBuffer): void => {
      const slot = atomicAdd(lod.drawStorage.get("instanceCount"), uint(1));
      lod.indices.element(slot).assign(uint(instanceIndex));
    };

    const build = (i: number): void => {
      const lod = lodBuffers[i];
      if (!lod) return;
      const isLast = i === lodBuffers.length - 1;
      const minD = float(lod.minDistance);
      if (isLast) {
        If(noisy.greaterThanEqual(minD), () => append(lod));
        return;
      }
      const maxD = float(lod.maxDistance);
      If(noisy.greaterThanEqual(minD).and(noisy.lessThan(maxD)), () => append(lod)).Else(() =>
        build(i + 1),
      );
    };
    build(0);
  }

  // ── Reset: re-arm each LOD's indirect draw buffer for the frame ──
  const reset = Fn(() => {
    for (const lod of lodBuffers) {
      lod.drawStorage.get("vertexCount").assign(uint(lod.vertexCount)); // index count
      atomicStore(lod.drawStorage.get("instanceCount"), uint(0));
      lod.drawStorage.get("firstVertex").assign(uint(0));
      lod.drawStorage.get("firstInstance").assign(uint(0));
      lod.drawStorage.get("offset").assign(uint(0));
    }
  })().compute(1);

  return { compute, reset };
}
