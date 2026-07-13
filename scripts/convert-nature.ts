// ── Becoming Many — Nature-Kit Asset Conversion ─────────────────
//
//   bun run scripts/convert-nature.ts [--only <id>]
//
// Converts the LowWorld Nature Kit FBX pack (assets/nature-kit/fbx/, committed)
// into binary glTF under `public/life/`, one .glb per species — the same contract
// scripts/convert-flora.ts established: one glTF primitive per material, albedo in
// baseColorFactor, geometry normalized at load time by src/life/assets.ts.
//
// The kit carries its colours in two texture atlases (assets/nature-kit/textures/):
//
//  · t_lowworld_naturekit.png (64×64, opaque palette cells) — every SOLID mesh
//    (trunks, rocks, mushrooms, stumps, branches) maps each face into one cell.
//    We bake that here: per triangle, UV centroid → texel → colour, then bucket
//    triangles by colour into one OBJ `usemtl` group each. The GLB ends up with
//    flat per-part colours and NO UVs — exactly like the old OBJ pack.
//
//  · t_lowworld_naturekit_foliage.png (2048², greyscale + real alpha) — leaf/card
//    geometry (tree crowns, bushes, flowers, reeds) is 1-2 m cutout planes; solid
//    colour would read as paper rectangles. Those triangles KEEP their UVs and are
//    emitted as one `foliage` primitive whose Kd is the species tint; the runtime
//    (src/life/material.ts) multiplies tint × atlas luminance and discards on
//    atlas alpha. The atlas itself ships once as public/life/foliage-atlas.png.
//
// LOD choice is per manifest entry: the kit ships _LOD0..3 per mesh and the flora
// draw cost is CONSTANT in `49 × Σ(perChunkCap × tris)` (see species.ts budget),
// so we deliberately pick mid LODs for heavy meshes. The script prints per-part
// triangle counts — keep the species.ts budget comment in sync with them.
//
// One-shot authoring step; output is committed. Re-run when the manifest changes.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decode } from "fast-png";
import obj2gltf from "obj2gltf";

// Minimal DOM shim so FBXLoader's TextureLoader path survives under bun. The stub
// image never fires "load" — textures stay empty; we only read geometry + UVs.
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

/** One converted species. `id` must match a SpeciesId in `src/life/species.ts`.
 *  `lod` picks the solid meshes' LOD (0 = finest); `leavesLod` the foliage's.
 *  `tint` is the foliage albedo (the kit leaves foliage colour to the engine). */
interface Entry {
  readonly id: string;
  readonly fbx: string;
  readonly lod?: number;
  readonly leavesLod?: number;
  readonly tint?: string;
  /** Fraction of foliage cards to KEEP (0..1, default 1). Cards are consecutive
   *  triangle pairs; a deterministic hash drops whole quads, so heavy crowns
   *  (oak: 2100 tris) trade fullness for per-instance cost — density is bought
   *  with perChunkCap instead. */
  readonly leafKeep?: number;
}

const MANIFEST: readonly Entry[] = [
  // ── Trees — trunk (palette) + crown (foliage cards) ───────────────────────
  // Trunks ride the coarsest LOD: forests are read as crowns + silhouettes, and
  // the saved triangles are spent on DENSITY (higher perChunkCaps in species.ts).
  { id: "pine", fbx: "trees/mesh_tree_pine_01.fbx", lod: 3, tint: "#2f5c38" },
  { id: "pine-2", fbx: "trees/mesh_tree_pine_02.fbx", lod: 3, tint: "#35663c" },
  { id: "pine-3", fbx: "trees/mesh_tree_pine_03.fbx", lod: 3, tint: "#2b5433" },
  { id: "common-tree", fbx: "trees/mesh_tree_oak_01.fbx", lod: 3, tint: "#4a8040", leafKeep: 0.6 },
  { id: "oak-2", fbx: "trees/mesh_tree_oak_03.fbx", lod: 3, tint: "#548a44", leafKeep: 0.5 },
  { id: "oak-3", fbx: "trees/mesh_tree_oak_04.fbx", lod: 3, tint: "#457a3d", leafKeep: 0.75 },
  { id: "birch", fbx: "trees/mesh_tree_birch_01.fbx", lod: 3, tint: "#6fa84e" },
  { id: "birch-2", fbx: "trees/mesh_tree_birch_02.fbx", lod: 3, tint: "#7bb257", leafKeep: 0.7 },
  { id: "birch-3", fbx: "trees/mesh_tree_birch_03.fbx", lod: 3, tint: "#66a049", leafKeep: 0.7 },
  { id: "dead-tree", fbx: "trees/mesh_tree_birch_01_dead.fbx", lod: 3 },
  { id: "dead-pine", fbx: "trees/mesh_tree_pine_01_dead.fbx", lod: 3 },

  // ── Ground cover — pure foliage cards ─────────────────────────────────────
  { id: "bush", fbx: "bushes/mesh_bush_01.fbx", tint: "#3f7d3c" },
  { id: "bush-2", fbx: "bushes/mesh_bush_02.fbx", tint: "#487f38" },
  { id: "flower", fbx: "flowers/mesh_flowers_01.fbx", tint: "#d98bb4" },
  { id: "flower-2", fbx: "flowers/mesh_flowers_02.fbx", tint: "#c9d06e" },
  { id: "shrub", fbx: "flowers/mesh_shrub_01.fbx", tint: "#4c8347" },
  { id: "reeds", fbx: "flowers/mesh_reeds_01.fbx", tint: "#7a9c55" },

  // ── Mushrooms — solid palette meshes ──────────────────────────────────────
  { id: "mushroom-brown", fbx: "mushrooms/mesh_mushroom_01_brown.fbx", lod: 1 },
  { id: "mushroom-red", fbx: "mushrooms/mesh_mushroom_02_red.fbx", lod: 1 },
  { id: "mushroom-white", fbx: "mushrooms/mesh_mushroom_03_white.fbx", lod: 1 },
  { id: "mushroom-cluster", fbx: "mushrooms/mesh_mushrooms_01_red.fbx", lod: 2 },

  // ── Forest-floor props ─────────────────────────────────────────────────────
  { id: "stump", fbx: "stumps/mesh_stump_pine_01.fbx" },
  { id: "stump-birch", fbx: "stumps/mesh_stump_birch_01.fbx" },
  { id: "branch-pine", fbx: "branches/mesh_branch_pine_01.fbx" },
  { id: "branch-birch", fbx: "branches/mesh_branch_birch_01.fbx" },

  // ── Rocks — three size tiers ───────────────────────────────────────────────
  { id: "rock-small", fbx: "rocks/mesh_rock_small_01.fbx", lod: 2 },
  { id: "rock", fbx: "rocks/mesh_rock_big_01.fbx", lod: 3 },
  { id: "rock-huge", fbx: "rocks/mesh_rock_huge_02.fbx", lod: 3 },
];

const SRC = "assets/nature-kit";
const OUT_DIR = "public/life";
const FOLIAGE_ATLAS_OUT = "foliage-atlas.png";

// ── Atlas sampling ───────────────────────────────────────────────────────────

interface Atlas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint16Array;
  readonly channels: number;
}

function texel(atlas: Atlas, u: number, v: number): [number, number, number] {
  // FBX/three UV convention: v=0 is the image's BOTTOM row.
  const x = Math.min(atlas.width - 1, Math.max(0, Math.floor(u * atlas.width)));
  const y = Math.min(atlas.height - 1, Math.max(0, Math.floor((1 - v) * atlas.height)));
  const i = (y * atlas.width + x) * atlas.channels;
  return [atlas.data[i], atlas.data[i + 1], atlas.data[i + 2]];
}

// ── FBX → primitive buckets ──────────────────────────────────────────────────

/** One future glTF primitive: triangles sharing an albedo (and, for foliage, UVs). */
interface Bucket {
  readonly key: string;
  readonly kd: [number, number, number]; // 0..1 sRGB
  readonly foliage: boolean;
  positions: number[];
  normals: number[];
  uvs: number[];
}

const LOD_RE = /_LOD(\d+)$/;

/** Pick, per LOD group, the mesh whose LOD index is closest to `wanted`. */
function pickLodMeshes(root: THREE.Object3D, wanted: number): THREE.Mesh[] {
  const groups = new Map<string, { lod: number; mesh: THREE.Mesh }[]>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = LOD_RE.exec(mesh.name);
    const base = m ? mesh.name.slice(0, -m[0].length) : mesh.name;
    const lod = m ? Number(m[1]) : 0;
    let list = groups.get(base);
    if (!list) {
      list = [];
      groups.set(base, list);
    }
    list.push({ lod, mesh });
  });
  const picked: THREE.Mesh[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => Math.abs(a.lod - wanted) - Math.abs(b.lod - wanted));
    picked.push(list[0].mesh);
  }
  return picked;
}

function convertEntry(
  entry: Entry,
  fbxBuffer: ArrayBuffer,
  palette: Atlas,
): { buckets: Bucket[]; tris: number } {
  const loader = new FBXLoader(new THREE.LoadingManager());
  const root = loader.parse(fbxBuffer, "");
  root.updateMatrixWorld(true);

  const solidLod = entry.lod ?? 0;
  const leavesLod = entry.leavesLod ?? 0;
  // Split mesh set: foliage-only meshes (crowns, bushes) follow leavesLod. A mesh
  // is "foliage" when every one of its triangles uses the foliage material.
  const buckets = new Map<string, Bucket>();
  let tris = 0;

  const wanted = new Set<THREE.Mesh>();
  for (const mesh of pickLodMeshes(root, solidLod)) wanted.add(mesh);
  // Re-pick foliage groups at their own LOD (replaces the solid pick for crowns).
  for (const mesh of pickLodMeshes(root, leavesLod)) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const allFoliage =
      mesh.geometry.groups.length > 0
        ? mesh.geometry.groups.every((g) => /foliage/.test(mats[g.materialIndex ?? 0]?.name ?? ""))
        : /foliage/.test(mats[0]?.name ?? "");
    if (!allFoliage) continue;
    for (const other of [...wanted]) {
      const strip = (n: string): string => n.replace(LOD_RE, "");
      if (strip(other.name) === strip(mesh.name)) wanted.delete(other);
    }
    wanted.add(mesh);
  }

  const nrm = new THREE.Matrix3();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();

  for (const mesh of wanted) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = geo.attributes.uv;
    if (!pos || !nor || !uv) throw new Error(`${entry.id}: mesh ${mesh.name} missing attributes`);
    if (geo.index) throw new Error(`${entry.id}: mesh ${mesh.name} unexpectedly indexed`);
    nrm.getNormalMatrix(mesh.matrixWorld);

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Material index per triangle range; empty groups → everything is material 0.
    const ranges =
      geo.groups.length > 0 ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];

    const leafKeep = entry.leafKeep ?? 1;
    let foliageTri = 0; // running foliage-triangle index → quad = pair

    for (const range of ranges) {
      const matName = mats[range.materialIndex ?? 0]?.name ?? "";
      const foliage = /foliage/.test(matName);

      for (let i = range.start; i < range.start + (range.count ?? 0); i += 3) {
        if (foliage && leafKeep < 1) {
          // One card = two consecutive triangles; decide per PAIR so no half-quads.
          const quad = foliageTri >> 1;
          foliageTri++;
          let h = (quad * 2654435761) | 0;
          h = Math.imul(h ^ (h >>> 13), 1274126177);
          if (((h >>> 16) & 0xffff) / 0x10000 >= leafKeep) continue;
        }
        let bucket: Bucket;
        if (foliage) {
          const key = "foliage";
          let b = buckets.get(key);
          if (!b) {
            const hex = entry.tint ?? "#4a8040";
            const c = new THREE.Color(hex);
            b = { key, kd: [c.r, c.g, c.b], foliage: true, positions: [], normals: [], uvs: [] };
            buckets.set(key, b);
          }
          bucket = b;
        } else {
          // UV centroid → palette cell. The kit maps whole faces into flat cells,
          // so the centroid is always interior to the right cell.
          const cu = (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3;
          const cv = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3;
          const [r, g, bch] = texel(palette, cu, cv);
          const key = `c_${((r << 16) | (g << 8) | bch).toString(16).padStart(6, "0")}`;
          let b = buckets.get(key);
          if (!b) {
            b = {
              key,
              kd: [r / 255, g / 255, bch / 255],
              foliage: false,
              positions: [],
              normals: [],
              uvs: [],
            };
            buckets.set(key, b);
          }
          bucket = b;
        }

        for (let k = 0; k < 3; k++) {
          va.fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld);
          vb.fromBufferAttribute(nor, i + k)
            .applyMatrix3(nrm)
            .normalize();
          bucket.positions.push(va.x, va.y, va.z);
          bucket.normals.push(vb.x, vb.y, vb.z);
          if (bucket.foliage) bucket.uvs.push(uv.getX(i + k), uv.getY(i + k));
        }
        tris++;
      }
    }
  }

  return { buckets: [...buckets.values()], tris };
}

// ── Buckets → OBJ/MTL → GLB (obj2gltf, the proven tail of the pipeline) ──────

function writeObj(buckets: readonly Bucket[], mtlName: string): { obj: string; mtl: string } {
  const obj: string[] = [`mtllib ${mtlName}`];
  const mtl: string[] = [];
  let vBase = 1;
  let vtBase = 1;

  for (const b of buckets) {
    mtl.push(
      `newmtl ${b.key}`,
      `Kd ${b.kd[0].toFixed(4)} ${b.kd[1].toFixed(4)} ${b.kd[2].toFixed(4)}`,
    );
    const n = b.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const p = b.positions;
      const q = b.normals;
      obj.push(`v ${p[i * 3].toFixed(5)} ${p[i * 3 + 1].toFixed(5)} ${p[i * 3 + 2].toFixed(5)}`);
      obj.push(`vn ${q[i * 3].toFixed(4)} ${q[i * 3 + 1].toFixed(4)} ${q[i * 3 + 2].toFixed(4)}`);
    }
    if (b.foliage) {
      for (let i = 0; i < n; i++) {
        obj.push(`vt ${b.uvs[i * 2].toFixed(5)} ${b.uvs[i * 2 + 1].toFixed(5)}`);
      }
    }
    obj.push(`usemtl ${b.key}`);
    for (let i = 0; i < n; i += 3) {
      const [a, c, d] = [vBase + i, vBase + i + 1, vBase + i + 2];
      if (b.foliage) {
        const [ta, tc, td] = [vtBase + i, vtBase + i + 1, vtBase + i + 2];
        obj.push(`f ${a}/${ta}/${a} ${c}/${tc}/${c} ${d}/${td}/${d}`);
      } else {
        obj.push(`f ${a}//${a} ${c}//${c} ${d}//${d}`);
      }
    }
    vBase += n;
    if (b.foliage) vtBase += n;
  }
  return { obj: obj.join("\n"), mtl: mtl.join("\n") };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const only = arg("only");
  const entries = only ? MANIFEST.filter((e) => e.id === only) : MANIFEST;
  if (entries.length === 0) throw new Error(`--only ${only}: no such manifest id`);

  const paletteFile = await readFile(resolve(SRC, "textures/t_lowworld_naturekit.png"));
  const png = decode(paletteFile);
  const palette: Atlas = {
    width: png.width,
    height: png.height,
    data: png.data,
    channels: png.channels,
  };

  await mkdir(resolve(OUT_DIR), { recursive: true });
  const tmp = join(tmpdir(), `nature-kit-${process.pid}`);
  await mkdir(tmp, { recursive: true });

  let total = 0;
  for (const entry of entries) {
    const buf = await readFile(resolve(SRC, "fbx", entry.fbx));
    const { buckets, tris } = convertEntry(
      entry,
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      palette,
    );

    const objPath = join(tmp, `${entry.id}.obj`);
    const { obj, mtl } = writeObj(buckets, `${entry.id}.mtl`);
    await writeFile(objPath, obj);
    await writeFile(join(tmp, `${entry.id}.mtl`), mtl);

    const glb: Buffer = await obj2gltf(objPath, { binary: true, unlit: true });
    await writeFile(resolve(OUT_DIR, `${entry.id}.glb`), glb);
    total += glb.byteLength;

    const parts = buckets.map((b) => `${b.key}:${b.positions.length / 9}`).join(" ");
    console.info(
      `  ${entry.id.padEnd(17)} ${String(tris).padStart(5)} tris  ${(glb.byteLength / 1024).toFixed(0).padStart(4)} KB  [${parts}]`,
    );
  }

  // The foliage atlas ships once; every species' foliage primitive samples it.
  const atlasSrc = await readFile(resolve(SRC, "textures/t_lowworld_naturekit_foliage.png"));
  await writeFile(resolve(OUT_DIR, FOLIAGE_ATLAS_OUT), atlasSrc);

  await rm(tmp, { recursive: true, force: true });
  console.info(
    `\n${entries.length} species → ${OUT_DIR}/  (${(total / 1024).toFixed(0)} KB total + foliage atlas ${(atlasSrc.byteLength / 1024).toFixed(0)} KB)`,
  );
}

await main();
