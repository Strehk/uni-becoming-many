// ── SENSE MODULE: Duft — the GPU air field ─────────────────────
//
// Ported from ChemischeWahrnemungExperiment `src/scents.js`. The air above the
// terrain is full of particles — invisible while they "smell nothing". When one
// drifts through a plant's scent zone it picks up that scent's colour and carries
// it away on the wind while it slowly evaporates. Fully GPU-simulated (TSL compute).
//
// Kept from the prototype: advection (wind + gusts + turbulence incl. the cheap
// 1-channel variant), pickup/evaporation, the spatial zone grid, visibility culling
// (scentless particles collapse to size 0), the angular-size cap, far culling, the
// reseed pass and the optional atomics-based compaction path.
//
// Changed for Becoming Many: the field lives in LOCAL coordinates around a movable
// anchor (`setCenter` + `setZones` rewrite the zone/grid buffers in place — no
// pipeline rebuild when the player flies on), `deltaTime` is replaced by `u.delta`
// (fed from the clock spine) and `u.fade` (the sense signal) gates the opacity.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import {
  Fn,
  If,
  Loop,
  atomicAdd,
  atomicStore,
  cos,
  exp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  mix,
  mx_noise_float,
  mx_noise_vec3,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { cameraPos } from "../../render/camera-pos.ts";
import { SCENT_TYPES, u } from "./params.ts";

export interface ScentZone {
  /** Local position relative to the field anchor. */
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Index into SCENT_TYPES. */
  type: number;
}

export interface ScentFieldOptions {
  /** Field radius in metres (particles wrap at radius + 8). */
  fieldRadius: number;
  /** Zone-buffer capacity (setZones clamps to this). */
  maxZones?: number;
  maxCount?: number;
  initialCount?: number;
}

const CELL = 4; // spatial grid cell size (m)
const CAP = 32; // max zones per cell

/** Fraction of the air spread UNIFORMLY up to `airHeight` (the rest hugs the
 *  ground via the `airGround` exponent). Without this canopy share, a high
 *  Bodennähe setting leaves virtually no particles at tree-crown height, so
 *  crown scent zones had nothing to colour and treetops read scentless. */
const CANOPY_AIR = 0.25;

/** The attribute type behind an `instancedArray` storage buffer. */
type StorageAttr = THREE.StorageInstancedBufferAttribute | THREE.StorageBufferAttribute;

export class ScentField {
  readonly object: THREE.Group;
  readonly maxCount: number;
  readonly update: THREE.ComputeNode;
  readonly reseedPass: THREE.ComputeNode;
  readonly compactClear: THREE.ComputeNode;
  readonly compact: THREE.ComputeNode;
  reseedRequested = false;
  compactionEnabled = false;

  private readonly material: THREE.SpriteNodeMaterial;
  private readonly compactMaterial: THREE.SpriteNodeMaterial;
  private readonly sprite: THREE.Sprite;
  private readonly compactSprite: THREE.Sprite;
  private readonly active: ReturnType<typeof uniform>;
  private readonly center: ReturnType<typeof uniform>;
  private readonly reseedSeed: ReturnType<typeof uniform>;
  private readonly gridW: number;
  private readonly gridOff: number;
  private readonly maxZones: number;
  private readonly zonePosArr: Float32Array;
  private readonly zoneColArr: Float32Array;
  private readonly cellCountArr: Float32Array;
  private readonly cellListArr: Float32Array;
  private readonly zonePosAttr: StorageAttr;
  private readonly zoneColAttr: StorageAttr;
  private readonly cellCountAttr: StorageAttr;
  private readonly cellListAttr: StorageAttr;
  private readonly counterAttr: StorageAttr;
  private reading = false;

  constructor(opts: ScentFieldOptions) {
    this.maxCount = opts.maxCount ?? 400_000;
    this.maxZones = opts.maxZones ?? 192;
    const initialCount = Math.min(opts.initialCount ?? 200_000, this.maxCount);
    const bound = opts.fieldRadius + 8;

    // Active particle count: drives rendering AND simulation (compute early-out).
    const active = uniform(initialCount);
    this.active = active;
    // World anchor of the field (particles simulate in local coordinates around it).
    const center = uniform(new THREE.Vector3(0, 0, 0));
    this.center = center;

    // ── particle buffers ──
    const posArr = new Float32Array(this.maxCount * 3);
    const scentArr = new Float32Array(this.maxCount * 4);
    for (let i = 0; i < this.maxCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * bound;
      const yFrac = Math.random() < CANOPY_AIR ? Math.random() : Math.random() ** u.airGround.value;
      posArr[i * 3 + 0] = Math.cos(a) * r;
      posArr[i * 3 + 1] = yFrac * u.airHeight.value + 0.03;
      posArr[i * 3 + 2] = Math.sin(a) * r;
    }
    const posBuf = instancedArray(posArr, "vec3");
    const scentBuf = instancedArray(scentArr, "vec4");

    // ── zone buffers (rewritten in place by setZones) ──
    this.zonePosArr = new Float32Array(this.maxZones * 4); // xyz + radius
    this.zoneColArr = new Float32Array(this.maxZones * 4); // rgb + type index
    const zonePosBuf = instancedArray(this.zonePosArr, "vec4");
    const zoneColBuf = instancedArray(this.zoneColArr, "vec4");
    this.zonePosAttr = zonePosBuf.value;
    this.zoneColAttr = zoneColBuf.value;

    // ── spatial grid (2D, XZ, local coords) ──
    const half = Math.ceil((bound + 8) / CELL);
    this.gridW = half * 2;
    this.gridOff = half * CELL;
    this.cellCountArr = new Float32Array(this.gridW * this.gridW);
    this.cellListArr = new Float32Array(this.gridW * this.gridW * CAP);
    const cellCountBuf = instancedArray(this.cellCountArr, "float");
    const cellListBuf = instancedArray(this.cellListArr, "float");
    this.cellCountAttr = cellCountBuf.value;
    this.cellListAttr = cellListBuf.value;

    const GRID_W = this.gridW;
    const GRID_OFF = this.gridOff;

    // ── simulation compute ──
    this.update = Fn(() => {
      If(instanceIndex.toFloat().greaterThanEqual(active), () => {
        // Particles above the configured count: simulate nothing.
      }).Else(() => {
        const pos = posBuf.element(instanceIndex);
        const scent = scentBuf.element(instanceIndex);
        const dt = u.delta.min(0.05).mul(u.timeScale);
        const sd = instanceIndex.toFloat();
        const t = u.time;

        // Advection: wind + gusts + turbulence + individual drift.
        const gust = mx_noise_float(vec3(t.mul(u.gustFreq), 7.31, 1.17))
          .mul(u.gust)
          .add(1)
          .max(0);
        const wind = vec3(cos(u.windDirRad), 0, sin(u.windDirRad)).mul(u.windSpeed.mul(gust));
        // Turbulence: full 3D perlin field or the cheap 1-channel variant
        // (swirl angle from one noise instead of three — ~3× less compute).
        const turb = vec3(0).toVar();
        If(u.cheapNoise.greaterThan(0.5), () => {
          const swirl = mx_noise_float(
            pos.mul(u.noiseScale).add(vec3(0, 0, t.mul(u.noiseSpeed))),
          ).mul(6.2832);
          turb.assign(
            vec3(cos(swirl), sin(swirl.mul(1.7)).mul(0.35), sin(swirl)).mul(u.turbulence),
          );
        }).Else(() => {
          turb.assign(
            mx_noise_vec3(
              pos
                .mul(u.noiseScale)
                .add(vec3(0, t.mul(u.noiseSpeed).negate(), t.mul(u.noiseSpeed.mul(0.6)))),
            ).mul(u.turbulence),
          );
        });
        const drift = vec3(hash(sd.add(3.13)), hash(sd.add(5.29)).mul(0.5), hash(sd.add(9.71)))
          .sub(vec3(0.5, 0.25, 0.5))
          .mul(u.spread);

        pos.addAssign(
          wind
            .add(turb)
            .add(drift)
            .add(vec3(0, u.rise, 0))
            .mul(dt),
        );
        pos.y.assign(pos.y.max(0.03));

        // A particle leaving the field is replaced by fresh (scentless) air.
        If(
          pos.xz
            .length()
            .greaterThan(bound)
            .or(pos.y.greaterThan(u.airHeight.add(3))),
          () => {
            const h1 = hash(sd.add(t));
            const h2 = hash(sd.add(t).add(17.17));
            const h3 = hash(sd.add(t).add(43.7));
            const h4 = hash(sd.add(t).add(91.3));
            const ang = h1.mul(6.2832);
            const rad = sqrt(h2).mul(bound);
            // Canopy share: a fixed fraction respawns uniformly high (see CANOPY_AIR).
            const yFrac = mix(h3.pow(u.airGround), h3, step(h4, float(CANOPY_AIR)));
            pos.assign(
              vec3(cos(ang).mul(rad), yFrac.mul(u.airHeight).add(0.03), sin(ang).mul(rad)),
            );
            scent.w.assign(0);
          },
        );

        // Evaporation runs every frame.
        const decayed = scent.w.mul(exp(dt.negate().div(u.evaporate)));

        // Scent pickup, possibly only every Nth frame (rotating; compensated).
        const myTurn = sd.mod(u.pickupStride).round().equal(u.frameMod.round());
        If(myTurn, () => {
          // Only sample the zones of the particle's own grid cell.
          const cx = pos.x
            .add(GRID_OFF)
            .div(CELL)
            .floor()
            .clamp(0, GRID_W - 1);
          const cz = pos.z
            .add(GRID_OFF)
            .div(CELL)
            .floor()
            .clamp(0, GRID_W - 1);
          const cellIdx = cz.mul(GRID_W).add(cx).toInt();
          const zonesInCell = cellCountBuf.element(cellIdx).toInt();

          const sumInfl = float(0).toVar();
          const sumCol = vec3(0).toVar();
          Loop({ start: 0, end: zonesInCell, type: "int" }, ({ i }) => {
            const zi = cellListBuf.element(cellIdx.mul(CAP).add(i)).toInt();
            const zp = zonePosBuf.element(zi);
            const zc = zoneColBuf.element(zi);
            const typeIdx = zc.w.toInt();
            const r = zp.w.mul(u.spawnRadius);
            const infl = smoothstep(r, r.mul(0.15), pos.distance(zp.xyz)).mul(
              float(u.typeIntensity.element(typeIdx)),
            );
            sumInfl.addAssign(infl);
            // Colour is looked up LIVE per type (not the baked zone rgb), so the
            // panel's per-type colour pickers retint the air without a rebuild.
            sumCol.addAssign(u.typeColor.element(typeIdx).mul(infl));
          });

          // Scent mixes in.
          const pick = sumInfl.mul(u.pickup).mul(dt).mul(u.pickupStride);
          const total = decayed.add(pick);
          const newCol = scent.xyz
            .mul(decayed)
            .add(sumCol.mul(u.pickup).mul(dt).mul(u.pickupStride))
            .div(total.max(1e-5));
          scent.assign(vec4(newCol, total.min(1)));
        }).Else(() => {
          scent.w.assign(decayed);
        });
      });
    })().compute(this.maxCount);

    // ── reseed (instant redistribution, e.g. after re-anchoring) ──
    const reseedSeed = uniform(0);
    this.reseedSeed = reseedSeed;
    this.reseedPass = Fn(() => {
      const pos = posBuf.element(instanceIndex);
      const scent = scentBuf.element(instanceIndex);
      const sd = instanceIndex.toFloat().add(reseedSeed);
      const h1 = hash(sd.add(1.71));
      const h2 = hash(sd.add(23.19));
      const h3 = hash(sd.add(57.31));
      const h4 = hash(sd.add(77.7));
      const ang = h1.mul(6.2832);
      const rad = sqrt(h2).mul(bound);
      const yFrac = mix(h3.pow(u.airGround), h3, step(h4, float(CANOPY_AIR)));
      pos.assign(vec3(cos(ang).mul(rad), yFrac.mul(u.airHeight).add(0.03), sin(ang).mul(rad)));
      scent.w.assign(0);
    })().compute(this.maxCount);

    // ── rendering ──
    const posAttr = posBuf.toAttribute();
    const scentAttr = scentBuf.toAttribute();
    const amount = scentAttr.w.clamp(0, 1);

    const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    material.positionNode = posAttr.add(center);

    // Invisible particles (no scent, air not visible) collapse to size 0 — the
    // rasterizer discards them instead of blending millions of transparent sprites.
    const visible = step(0.008, amount.add(u.airOpacity.mul(50)).add(u.windOnly));

    // Angular-size cap: particles near the camera would cover huge screen areas
    // (fill-rate crater when flying through a cloud) — cap world size at a fraction
    // of the distance.
    const camDist = posAttr.add(center).sub(cameraPos).length();

    material.scaleNode = u.size
      .mul(amount.mul(0.9).add(0.55)) // scented particles look fuller
      .mul(hash(instanceIndex.toFloat()).mul(0.5).add(0.75))
      .mul(mix(float(1), float(0.5), u.windOnly)) // wind dots: finer
      .min(camDist.mul(0.18))
      .mul(step(camDist, u.cullDist)) // far culling (behind the fog)
      .mul(visible);

    // Unscented air is neutral light grey (only relevant with "air visible"); in
    // wind-only mode every particle is neutral grey.
    material.colorNode = mix(
      mix(vec3(0.72), scentAttr.xyz, amount.pow(0.35)),
      vec3(0.55),
      u.windOnly,
    );

    const d = uv().sub(0.5).length();
    const disc = smoothstep(0.1, 0.5, d).oneMinus();
    material.opacityNode = disc
      .mul(mix(u.airOpacity.add(amount.pow(1.3).mul(u.intensity)), float(0.25), u.windOnly))
      .min(1)
      .mul(u.fade);
    this.material = material;

    const sprite = new THREE.Sprite(material);
    sprite.count = initialCount;
    sprite.frustumCulled = false;
    sprite.renderOrder = 10;
    this.sprite = sprite;

    // ── optional GPU compaction (atomics collect visible indices) ──
    const counterRaw = instancedArray(new Uint32Array(1), "uint");
    const counter = counterRaw.toAtomic();
    const visIdxBuf = instancedArray(this.maxCount, "uint");
    this.counterAttr = counterRaw.value;

    this.compactClear = Fn(() => {
      atomicStore(counter.element(0), 0);
    })().compute(1);

    this.compact = Fn(() => {
      If(instanceIndex.toFloat().lessThan(active), () => {
        const a = scentBuf.element(instanceIndex).w;
        If(a.add(u.airOpacity.mul(50)).add(u.windOnly).greaterThan(0.008), () => {
          const slot = atomicAdd(counter.element(0), 1);
          visIdxBuf.element(slot).assign(instanceIndex);
        });
      });
    })().compute(this.maxCount);

    const cMat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const pIdx = visIdxBuf.element(instanceIndex);
    const cPos = varying(posBuf.element(pIdx));
    const cScent = varying(scentBuf.element(pIdx));
    const cRnd = varying(hash(pIdx.toFloat()));
    const cAmount = cScent.w.clamp(0, 1);

    cMat.positionNode = cPos.add(center);
    const cDist = cPos.add(center).sub(cameraPos).length();
    cMat.scaleNode = u.size
      .mul(cAmount.mul(0.9).add(0.55))
      .mul(cRnd.mul(0.5).add(0.75))
      .mul(mix(float(1), float(0.5), u.windOnly))
      .min(cDist.mul(0.18))
      .mul(step(cDist, u.cullDist));
    cMat.colorNode = mix(mix(vec3(0.72), cScent.xyz, cAmount.pow(0.35)), vec3(0.55), u.windOnly);
    cMat.opacityNode = disc
      .mul(mix(u.airOpacity.add(cAmount.pow(1.3).mul(u.intensity)), float(0.25), u.windOnly))
      .min(1)
      .mul(u.fade);
    this.compactMaterial = cMat;

    const compactSprite = new THREE.Sprite(cMat);
    compactSprite.count = 1;
    compactSprite.frustumCulled = false;
    compactSprite.renderOrder = 10;
    compactSprite.visible = false;
    this.compactSprite = compactSprite;

    this.object = new THREE.Group();
    this.object.add(sprite, compactSprite);
  }

  set count(v: number) {
    const n = Math.min(Math.round(v), this.maxCount);
    this.sprite.count = n;
    this.active.value = n;
    this.compactSprite.count = Math.min(this.compactSprite.count, Math.max(n, 1));
  }
  get count(): number {
    const v: unknown = this.active.value;
    return typeof v === "number" ? v : 0;
  }

  /** Move the field's world anchor (particles keep their local distribution). */
  setCenter(x: number, y: number, z: number): void {
    const c: unknown = this.center.value;
    if (c instanceof THREE.Vector3) {
      c.set(x, y, z);
    }
  }

  /** Rewrite the zone + grid buffers in place (no pipeline rebuild). */
  setZones(zones: readonly ScentZone[]): void {
    const capped = zones.slice(0, this.maxZones);
    this.zonePosArr.fill(0);
    this.zoneColArr.fill(0);
    this.cellCountArr.fill(0);
    this.cellListArr.fill(0);

    const c = new THREE.Color();
    let overflow = 0;
    capped.forEach((z, i) => {
      c.set(SCENT_TYPES[z.type]?.color ?? 0xffffff);
      this.zonePosArr[i * 4 + 0] = z.x;
      this.zonePosArr[i * 4 + 1] = z.y;
      this.zonePosArr[i * 4 + 2] = z.z;
      this.zonePosArr[i * 4 + 3] = z.radius;
      this.zoneColArr[i * 4 + 0] = c.r;
      this.zoneColArr[i * 4 + 1] = c.g;
      this.zoneColArr[i * 4 + 2] = c.b;
      this.zoneColArr[i * 4 + 3] = z.type;

      // Circle/cell overlap instead of a plain bounding box.
      const rMax = z.radius * 4 + 0.5;
      const x0 = Math.max(0, Math.floor((z.x - rMax + this.gridOff) / CELL));
      const x1 = Math.min(this.gridW - 1, Math.floor((z.x + rMax + this.gridOff) / CELL));
      const z0 = Math.max(0, Math.floor((z.z - rMax + this.gridOff) / CELL));
      const z1 = Math.min(this.gridW - 1, Math.floor((z.z + rMax + this.gridOff) / CELL));
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const nx = Math.max(
            cx * CELL - this.gridOff,
            Math.min(z.x, (cx + 1) * CELL - this.gridOff),
          );
          const nz = Math.max(
            cz * CELL - this.gridOff,
            Math.min(z.z, (cz + 1) * CELL - this.gridOff),
          );
          if ((nx - z.x) ** 2 + (nz - z.z) ** 2 > rMax * rMax) {
            continue;
          }
          const idx = cz * this.gridW + cx;
          const n = this.cellCountArr[idx] ?? 0;
          if (n < CAP) {
            this.cellListArr[idx * CAP + n] = i;
            this.cellCountArr[idx] = n + 1;
          } else {
            overflow++;
          }
        }
      }
    });
    if (overflow > 0) {
      console.warn(`ScentField: ${overflow} Zonen-Zell-Einträge über CAP=${CAP} verworfen`);
    }

    this.zonePosAttr.needsUpdate = true;
    this.zoneColAttr.needsUpdate = true;
    this.cellCountAttr.needsUpdate = true;
    this.cellListAttr.needsUpdate = true;
  }

  setAdditive(on: boolean): void {
    const blending = on ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of [this.material, this.compactMaterial]) {
      m.blending = blending;
      m.needsUpdate = true;
    }
  }

  requestReseed(): void {
    this.reseedSeed.value = Math.random() * 1000;
    this.reseedRequested = true;
  }

  setCompaction(on: boolean): void {
    this.compactionEnabled = on;
    this.sprite.visible = !on;
    this.compactSprite.visible = on;
    if (on) {
      this.compactSprite.count = 1; // the readback pulls in the real number
    }
  }

  /** Pull the visible-particle counter from the GPU (max one read in flight). */
  syncDrawCount(renderer: THREE.WebGPURenderer): void {
    if (this.reading) {
      return;
    }
    this.reading = true;
    renderer
      .getArrayBufferAsync(this.counterAttr)
      .then((ab) => {
        const n = new Uint32Array(ab)[0] ?? 0;
        this.compactSprite.count = Math.max(1, Math.min(n, this.count));
        this.reading = false;
      })
      .catch((err: unknown) => {
        console.warn("Kompaktierung: Readback fehlgeschlagen", err);
        this.reading = false;
        this.setCompaction(false);
      });
  }

  dispose(): void {
    this.object.removeFromParent();
    this.material.dispose();
    this.compactMaterial.dispose();
  }
}
