// ── Becoming Many — Flora Asset Conversion ─────────────────────
//
//   bun run scripts/convert-flora.ts [--src <dir>] [--compress]
//
// Converts the curated slice of the sinneswandler OBJ pack into binary glTF under
// `public/life/`, one .glb per species. Each source OBJ carries its material split
// as `usemtl` groups (trees: "Wood" + "Green"), and obj2gltf turns those into one
// glTF primitive per material — which is exactly the per-part split `src/life/`
// instances separately. The MTL's `Kd` becomes the primitive's baseColorFactor, so
// the species' bark/foliage albedo travels with the asset.
//
// Deliberately NOT compressed by default: fourteen low-poly meshes total ~1-2 MB as
// plain GLB, while Draco costs a decoder in `public/` and meshopt costs decoder
// wiring at load. `--compress` reserves the upgrade path for when the pack grows.
//
// This is a one-shot authoring step. Its output is committed; the runtime never
// sees an OBJ. Re-run only when the curated list below changes.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import obj2gltf from "obj2gltf";

/** The curated subset. `id` must match a SpeciesId in `src/life/species.ts`. */
const CURATED: ReadonlyArray<{ id: string; obj: string }> = [
  // Trees — two primitives each (Wood, Green).
  { id: "pine", obj: "trees/pine/PineTree_1.obj" },
  { id: "common-tree", obj: "trees/common/CommonTree_1.obj" },
  { id: "birch", obj: "trees/birch/BirchTree_1.obj" },
  { id: "dead-tree", obj: "trees/dead/BirchTree_Dead_1.obj" },
  { id: "palm", obj: "trees/palm/PalmTree_1.obj" },
  // Rocks — single primitive.
  { id: "rock", obj: "rocks/regular/Rock_1.obj" },
  { id: "moss-rock", obj: "rocks/moss/Rock_Moss_1.obj" },
  // Ground cover.
  { id: "grass", obj: "grass/Grass_2.obj" },
  { id: "grass-short", obj: "grass/Grass_Short.obj" },
  { id: "wheat", obj: "grass/Wheat.obj" },
  { id: "bush", obj: "plants/Bush_1.obj" },
  { id: "berry-bush", obj: "plants/BushBerries_1.obj" },
  { id: "flower", obj: "plants/Flowers.obj" },
  { id: "cactus", obj: "cacti/Cactus_1.obj" },
  { id: "stump", obj: "props/TreeStump.obj" },
];

const DEFAULT_SRC = "../neural-flight-template/static/sinneswandler_test1/models";
const OUT_DIR = "public/life";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const src = resolve(arg("src") ?? DEFAULT_SRC);
  const compress = process.argv.includes("--compress");
  if (compress) {
    // Reserved: wire Draco (needs decoder files in public/) or meshopt (needs
    // MeshoptDecoder at load) here once the pack outgrows a plain GLB.
    throw new Error("--compress is not implemented yet; plain GLB is intentional for v1.");
  }

  await mkdir(resolve(OUT_DIR), { recursive: true });

  let total = 0;
  for (const { id, obj } of CURATED) {
    const input = resolve(src, obj);
    const output = resolve(OUT_DIR, `${id}.glb`);
    await mkdir(dirname(output), { recursive: true });

    // `binary` → .glb; `unlit` keeps the exported material simple (we shade in TSL
    // anyway and only read baseColorFactor). Textures are absent from this pack.
    const glb: Buffer = await obj2gltf(input, { binary: true, unlit: true });
    await writeFile(output, glb);

    total += glb.byteLength;
    console.info(`  ${id.padEnd(14)} ${obj.padEnd(38)} → ${(glb.byteLength / 1024).toFixed(1)} KB`);
  }

  console.info(
    `\n${CURATED.length} species → ${OUT_DIR}/  (${(total / 1024).toFixed(0)} KB total)`,
  );
}

await main();
