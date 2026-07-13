// One-off probe: dump geometry/material structure of a nature-kit FBX.
//   bun run scripts/inspect-fbx.ts assets/nature-kit/fbx/trees/mesh_tree_pine_01.fbx
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Minimal DOM shim so TextureLoader/ImageLoader survive under bun. The stub image
// never fires "load" — textures stay empty, which is fine: we only read geometry.
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

const file = resolve(process.argv[2] ?? "assets/nature-kit/fbx/trees/mesh_tree_pine_01.fbx");
const buf = await readFile(file);

// Missing texture paths must not hit the filesystem: serve a 1x1 transparent PNG.
const manager = new THREE.LoadingManager();
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
manager.setURLModifier(() => PIXEL);

const loader = new FBXLoader(manager);
const root = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");

root.updateMatrixWorld(true);
root.traverse((obj) => {
  if (!(obj as THREE.Mesh).isMesh) return;
  const mesh = obj as THREE.Mesh;
  const geo = mesh.geometry;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  console.log(`mesh "${mesh.name}"`);
  console.log(
    `  world scale: ${mesh
      .getWorldScale(new THREE.Vector3())
      .toArray()
      .map((v) => v.toFixed(3))}`,
  );
  console.log(
    `  size: ${size
      .toArray()
      .map((v) => v.toFixed(2))
      .join(" x ")}`,
  );
  console.log(
    `  verts: ${geo.attributes.position.count}, index: ${geo.index ? geo.index.count : "none"}`,
  );
  console.log(`  attributes: ${Object.keys(geo.attributes).join(", ")}`);
  console.log(`  groups: ${JSON.stringify(geo.groups)}`);
  for (const [i, m] of mats.entries()) {
    const mm = m as THREE.MeshPhongMaterial;
    console.log(
      `  material[${i}] "${mm.name}" color=#${mm.color?.getHexString()} map=${mm.map ? "yes" : "no"} transparent=${mm.transparent} alphaTest=${mm.alphaTest} side=${mm.side}`,
    );
  }
});
