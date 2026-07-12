// ── Becoming Many — Dust Geometry ──────────────────────────────
//
// The mote field, as ONE mesh over an InstancedBufferGeometry: a shared unit quad
// plus one instanced `vec3` attribute — the per-mote base seed in [0, BOX). All the
// per-frame motion lives in the material's `vertexNode` (see material.ts), so this
// buffer is built once and never touched again.
//
// Why a plain Mesh and not the flora InstancedMesh: flora swaps its instance matrix
// to a StorageInstancedBufferAttribute only to dodge the 64 KB uniform binding the
// mat4 path selects (see src/life/instancing.ts). Dust carries no per-instance
// matrix — just a `vec3` seed, an ordinary instanced vertex attribute like flora's
// own `instanceTint` — so none of that machinery is needed.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": classes from `three/webgpu`.

import * as THREE from "three/webgpu";

/** How many motes fill the box. ~3 k is plenty at this size — one cheap draw call. */
const COUNT = 3000;
/** Box the motes fill, in metres: XZ span, vertical band, XZ span. Must match `material.ts`. */
const BOX_X = 60;
const BOX_Y = 30;
const BOX_Z = 60;

/** Build the dust mesh. The material owns the wrap/billboard; this owns the seeds. */
export function createDustMesh(material: THREE.Material): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1); // billboard quad: position + uv + index
  const position = base.getAttribute("position");
  const uvAttr = base.getAttribute("uv");
  if (!base.index || !position || !uvAttr) {
    throw new Error("[atmosphere] PlaneGeometry is missing position/uv/index");
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", position);
  geometry.setAttribute("uv", uvAttr);

  const seeds = new Float32Array(COUNT * 3); // per-instance base offset in [0, BOX)
  for (let i = 0; i < COUNT; i++) {
    seeds[i * 3] = Math.random() * BOX_X;
    seeds[i * 3 + 1] = Math.random() * BOX_Y;
    seeds[i * 3 + 2] = Math.random() * BOX_Z;
  }
  geometry.setAttribute("instanceSeed", new THREE.InstancedBufferAttribute(seeds, 3));
  geometry.instanceCount = COUNT;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // the cloud always surrounds the player — nothing to cull
  mesh.renderOrder = 2; // draw after the opaque world
  return mesh;
}
