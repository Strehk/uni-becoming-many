// ── Becoming Many — Flora Asset Loading ────────────────────────
//
// Loads the baked GLBs from `public/life/` (see scripts/convert-flora.ts) and hands
// back, per species, one FloraPart per distinct source material. Each part becomes
// its own instanced draw, which is why we keep them apart rather than merging: a
// pine's bark and needles are different colours, and a birch has four.
//
// The GLBs carry POSITION + NORMAL only (no UVs, no textures) and their albedo
// lives in the material's baseColorFactor, straight from the original MTL's `Kd`.
// EXCEPTION: primitives whose material is named "foliage" (nature-kit tree crowns,
// bushes, flowers — see scripts/convert-nature.ts) keep TEXCOORD_0: they are 1-2 m
// cutout cards whose shape lives in a shared greyscale+alpha atlas
// (`/life/foliage-atlas.png`, loaded once here), sampled by the flora material.
//
// `three/addons/*` resolves to `three/examples/jsm/*`, which imports from the
// classic `three` entry. That is safe here: `three.module.js` and `three.webgpu.js`
// both re-export a SHARED `three.core.js`, so `BufferGeometry` is the same class in
// both — no duplicate core, no `instanceof` hazard. (Verified for r185.)

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three/webgpu";
import { SPECIES, SPECIES_IDS, type SpeciesId } from "./species.ts";

/** One instanced draw's worth of a species: a distinct material on the source mesh. */
export interface FloraPart {
  /** The source material's name — "Wood", "Green", "c_927054", "foliage", … */
  readonly name: string;
  /** Normalized geometry: base at y=0, centred on XZ, scaled to `targetHeight`. */
  readonly geometry: THREE.BufferGeometry;
  /** Linear-space albedo baked from the asset's baseColorFactor. */
  readonly baseColor: THREE.Color;
  /** Atlas-cutout card geometry: UVs kept, rendered by the foliage material. */
  readonly foliage: boolean;
}

const BASE_URL = "/life";

/**
 * Load every species' parts.
 *
 * Parts of one species share a SINGLE normalization transform, derived from their
 * combined bounding box — normalizing each part independently would scale a trunk
 * and its crown differently and pull the tree apart.
 */
export async function loadFloraParts(): Promise<Map<SpeciesId, FloraPart[]>> {
  const loader = new GLTFLoader();
  const out = new Map<SpeciesId, FloraPart[]>();

  const loaded = await Promise.all(
    SPECIES_IDS.map(async (id) => ({ id, gltf: await loader.loadAsync(`${BASE_URL}/${id}.glb`) })),
  );

  for (const { id, gltf } of loaded) {
    const raw: {
      name: string;
      geometry: THREE.BufferGeometry;
      baseColor: THREE.Color;
      foliage: boolean;
    }[] = [];

    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      // GLTFLoader emits one Mesh per primitive, so each carries a single material.
      const material = Array.isArray(node.material) ? node.material[0] : node.material;
      if (!material) return;

      // Foliage cards need their UVs — their shape lives in the cutout atlas.
      const foliage = material.name === "foliage";
      const geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld); // bake the node transform; instances are world-space
      if (!foliage) geometry.deleteAttribute("uv");
      geometry.deleteAttribute("uv1");
      // Normals are authored and correct, and the transform below is a uniform scale
      // plus a translation — both normal-preserving. Recomputing them here would
      // smooth the faceted low-poly shading these meshes are built around.

      const baseColor = new THREE.Color(0xffffff);
      if ("color" in material && material.color instanceof THREE.Color) {
        baseColor.copy(material.color);
      }
      raw.push({ name: material.name || "solid", geometry, baseColor, foliage });
    });

    if (raw.length === 0) throw new Error(`[life] ${id}.glb contained no meshes`);

    normalizeSpecies(
      raw.map((p) => p.geometry),
      SPECIES[id].targetHeight,
    );

    // The GLTF's own materials/textures are never used — we shade in TSL.
    disposeGltfMaterials(gltf.scene);
    out.set(id, raw);
  }

  return out;
}

/**
 * Put the species' combined base on y=0, centre it on XZ, and scale it uniformly to
 * `targetHeight`. Base-at-origin (rather than `.center()`, as the reference
 * `world-models.ts` does) is what lets a scatter matrix place a tree by its foot:
 * the instance translation IS the point on the ground it stands on.
 */
function normalizeSpecies(geometries: readonly THREE.BufferGeometry[], targetHeight: number): void {
  const bounds = new THREE.Box3();
  for (const g of geometries) {
    g.computeBoundingBox();
    if (g.boundingBox) bounds.union(g.boundingBox);
  }
  if (bounds.isEmpty()) return;

  const centreX = (bounds.min.x + bounds.max.x) / 2;
  const centreZ = (bounds.min.z + bounds.max.z) / 2;
  const height = bounds.max.y - bounds.min.y;
  const scale = height > 1e-6 ? targetHeight / height : 1;

  for (const g of geometries) {
    g.translate(-centreX, -bounds.min.y, -centreZ);
    g.scale(scale, scale, scale);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
}

function disposeGltfMaterials(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const m of materials) m?.dispose();
  });
}

/**
 * Load the shared foliage cutout atlas (greyscale shading in RGB, card shape in
 * alpha). `flipY = false`: the GLB UVs are already in glTF convention (obj2gltf
 * flipped the OBJ vt), so the texture must be sampled top-down, un-flipped.
 */
export async function loadFoliageAtlas(): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(`${BASE_URL}/foliage-atlas.png`);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Release every geometry handed out by {@link loadFloraParts}. */
export function disposeFloraParts(parts: Map<SpeciesId, FloraPart[]>): void {
  for (const list of parts.values()) {
    for (const p of list) p.geometry.dispose();
  }
  parts.clear();
}
