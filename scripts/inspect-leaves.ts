// One-off probe: triangle-size stats + UV footprint of a foliage mesh.
//   bun run scripts/inspect-leaves.ts assets/nature-kit/fbx/trees/mesh_tree_oak_01.fbx
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

(globalThis as { document?: unknown }).document ??= {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    style: {},
  }),
};

import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const file = resolve(process.argv[2] ?? "assets/nature-kit/fbx/trees/mesh_tree_oak_01.fbx");
const buf = await readFile(file);
const loader = new FBXLoader(new THREE.LoadingManager());
const root = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");

root.traverse((obj) => {
  const mesh = obj as THREE.Mesh;
  if (!mesh.isMesh || !/leaves/.test(mesh.name)) return;
  const pos = mesh.geometry.attributes.position;
  const uv = mesh.geometry.attributes.uv;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const areas: number[] = [];
  let uvMin = [1e9, 1e9];
  let uvMax = [-1e9, -1e9];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    areas.push(b.clone().sub(a).cross(c.clone().sub(a)).length() / 2);
  }
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uvMin = [Math.min(uvMin[0], u), Math.min(uvMin[1], v)];
    uvMax = [Math.max(uvMax[0], u), Math.max(uvMax[1], v)];
  }
  areas.sort((x, y) => x - y);
  const tris = areas.length;
  console.log(`${mesh.name}: ${tris} tris`);
  console.log(
    `  tri area m²  min=${areas[0].toFixed(4)} median=${areas[(tris / 2) | 0].toFixed(4)} max=${areas[tris - 1].toFixed(4)}`,
  );
  console.log(
    `  edge≈ median ${Math.sqrt(areas[(tris / 2) | 0] * 2).toFixed(2)} m, max ${Math.sqrt(areas[tris - 1] * 2).toFixed(2)} m`,
  );
  console.log(
    `  uv range u ${uvMin[0].toFixed(2)}..${uvMax[0].toFixed(2)}  v ${uvMin[1].toFixed(2)}..${uvMax[1].toFixed(2)}`,
  );
});
