// ── SENSE MODULE: Netzwerk — the mycelium web in the ground ────
//
// Ported from swarm_network `src/MyceliumNetwork.js`: from mushroom positions it
// grows constant base strands, locally pulsing hotspots and recursively branching
// underground arms (all CPU-built LineSegments; the pulse runs in the shader).
//
// Changes from the prototype: three → three/webgpu; the GLSL line shader became a
// TSL node graph on `LineBasicNodeMaterial` (phase attribute + time uniform); the
// horizontal clamp works around the mushrooms' centroid instead of the world
// origin (the field follows the player); `uFade` (sense signal) scales opacity.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import { attribute, float, sin, smoothstep, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

export interface MyceliumOptions {
  /** Horizontal reach around the mushrooms' centroid. */
  radius: number;
  neighbourLinks: number;
  radialArms: number;
  branchDepth: number;
  segments: number;
  maxDepth: number;
  baseColor: string;
  hotspotColor: string;
  baseAlpha: number;
  hotspotAlpha: number;
  hotspotStrength: number;
  hotspotSpeed: number;
}

export const MYCELIUM_DEFAULTS: MyceliumOptions = {
  radius: 120,
  neighbourLinks: 4,
  radialArms: 8,
  branchDepth: 3,
  segments: 18,
  maxDepth: 7.5,
  baseColor: "#73f7ff",
  hotspotColor: "#d7ff9a",
  baseAlpha: 0.2,
  hotspotAlpha: 0.72,
  hotspotStrength: 2.8,
  hotspotSpeed: 4.8,
};

const previous = new THREE.Vector3();
const current = new THREE.Vector3();

function cubicPoint(
  target: THREE.Vector3,
  start: THREE.Vector3,
  controlA: THREE.Vector3,
  controlB: THREE.Vector3,
  end: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const inverse = 1 - t;
  const startWeight = inverse * inverse * inverse;
  const controlAWeight = 3 * inverse * inverse * t;
  const controlBWeight = 3 * inverse * t * t;
  const endWeight = t * t * t;
  return target
    .copy(start)
    .multiplyScalar(startWeight)
    .addScaledVector(controlA, controlAWeight)
    .addScaledVector(controlB, controlBWeight)
    .addScaledVector(end, endWeight);
}

interface MyceliumMaterialHandle {
  material: THREE.LineBasicNodeMaterial;
  color: { value: THREE.Color };
  baseAlpha: { value: number };
  glowStrength: { value: number };
  hotspotSpeed: { value: number };
}

type FloatUniform = ReturnType<typeof floatUniform>;
function floatUniform(v: number) {
  return uniform(v);
}

function createMyceliumMaterial(
  colorHex: string,
  baseAlphaValue: number,
  glowStrengthValue: number,
  constantBase: boolean,
  hotspotSpeedValue: number,
  uTime: FloatUniform,
  uFade: FloatUniform,
): MyceliumMaterialHandle {
  const material = new THREE.LineBasicNodeMaterial();
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.toneMapped = false;

  const color = uniform(new THREE.Color(colorHex));
  const baseAlpha = uniform(baseAlphaValue);
  const glowStrength = uniform(glowStrengthValue);
  const hotspotSpeed = uniform(hotspotSpeedValue);

  if (constantBase) {
    material.colorNode = color;
    material.opacityNode = float(baseAlpha).mul(uFade);
  } else {
    const phase = attribute<"float">("phase", "float");
    const movingHotspot = sin(phase.mul(38.0).sub(uTime.mul(hotspotSpeed)));
    const localHotspot = sin(phase.mul(93.0).add(uTime.mul(0.42)));
    const pulse = smoothstep(0.93, 1.0, movingHotspot.mul(0.72).add(localHotspot.mul(0.28)));
    material.colorNode = color.mul(pulse.mul(glowStrength).add(1.0));
    material.opacityNode = pulse.mul(baseAlpha).mul(uFade);
  }
  return { material, color, baseAlpha, glowStrength, hotspotSpeed };
}

export class MyceliumNetwork {
  readonly group: THREE.Group;
  /** Sense-layer fade 0..1 — scales the strand opacities. */
  readonly fade = floatUniform(0);

  private options: MyceliumOptions;
  private mushrooms: THREE.Vector3[] = [];
  private readonly centre = new THREE.Vector3();
  private readonly time = floatUniform(0);

  private readonly arm: MyceliumMaterialHandle;
  private readonly glow: MyceliumMaterialHandle;
  private armGeometry: THREE.BufferGeometry;
  private glowGeometry: THREE.BufferGeometry;
  private readonly arms: THREE.LineSegments;
  private readonly glowArms: THREE.LineSegments;

  constructor(options: Partial<MyceliumOptions> = {}) {
    this.options = { ...MYCELIUM_DEFAULTS, ...options };
    this.group = new THREE.Group();
    this.group.name = "mycelium-network";

    this.arm = createMyceliumMaterial(
      this.options.baseColor,
      this.options.baseAlpha,
      1,
      true,
      this.options.hotspotSpeed,
      this.time,
      this.fade,
    );
    this.glow = createMyceliumMaterial(
      this.options.hotspotColor,
      this.options.hotspotAlpha,
      this.options.hotspotStrength,
      false,
      this.options.hotspotSpeed,
      this.time,
      this.fade,
    );

    this.armGeometry = new THREE.BufferGeometry();
    this.glowGeometry = new THREE.BufferGeometry();
    this.arms = new THREE.LineSegments(this.armGeometry, this.arm.material);
    this.glowArms = new THREE.LineSegments(this.glowGeometry, this.glow.material);
    this.glowArms.position.y = 0.04;
    this.arms.frustumCulled = false;
    this.glowArms.frustumCulled = false;
    this.group.add(this.arms, this.glowArms);
  }

  setMushrooms(mushrooms: readonly THREE.Vector3[]): void {
    this.mushrooms = [...mushrooms];
  }

  setOptions(options: Partial<MyceliumOptions>): void {
    this.options = { ...this.options, ...options };
    this.arm.color.value.set(this.options.baseColor);
    this.arm.baseAlpha.value = this.options.baseAlpha;
    this.glow.color.value.set(this.options.hotspotColor);
    this.glow.baseAlpha.value = this.options.hotspotAlpha;
    this.glow.glowStrength.value = this.options.hotspotStrength;
    this.glow.hotspotSpeed.value = this.options.hotspotSpeed;
  }

  get currentOptions(): Readonly<MyceliumOptions> {
    return this.options;
  }

  rebuild(): void {
    const positions: number[] = [];
    const phases: number[] = [];

    // Clamp reference: the mushrooms' centroid (the prototype used the origin).
    this.centre.set(0, 0, 0);
    for (const m of this.mushrooms) {
      this.centre.add(m);
    }
    if (this.mushrooms.length > 0) {
      this.centre.divideScalar(this.mushrooms.length);
    }

    for (let i = 0; i < this.mushrooms.length; i += 1) {
      const m = this.mushrooms[i];
      if (!m) {
        continue;
      }
      this.addMushroomNeighbourLinks(positions, phases, i);
      this.addMushroomRadialGrowth(positions, phases, m, i);
    }

    for (let i = 0; i < this.mushrooms.length; i += 1) {
      const source = this.mushrooms[i];
      const opposite = this.mushrooms[(i * 13 + 5) % Math.max(1, this.mushrooms.length)];
      if (!source || !opposite || source === opposite) {
        continue;
      }
      const midpoint = this.clampPoint(
        new THREE.Vector3()
          .copy(source)
          .lerp(opposite, 0.5)
          .add(new THREE.Vector3(Math.sin(i * 1.7) * 16, 0, Math.cos(i * 2.1) * 16)),
      );
      this.addArm(positions, phases, source, midpoint, 0.53 + i * 0.029, 1);
      this.addArm(positions, phases, midpoint, opposite, 0.79 + i * 0.037, 1);
    }

    this.armGeometry.dispose();
    this.glowGeometry.dispose();
    this.armGeometry = new THREE.BufferGeometry();
    this.armGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.armGeometry.setAttribute("phase", new THREE.Float32BufferAttribute(phases, 1));
    this.glowGeometry = this.armGeometry.clone();
    this.arms.geometry = this.armGeometry;
    this.glowArms.geometry = this.glowGeometry;
  }

  update(_delta: number, elapsed: number): void {
    this.time.value = elapsed;
  }

  private addMushroomNeighbourLinks(
    positions: number[],
    phases: number[],
    sourceIndex: number,
  ): void {
    const start = this.mushrooms[sourceIndex];
    if (!start) {
      return;
    }
    const nearest: { index: number; distanceSq: number }[] = [];

    for (let i = 0; i < this.mushrooms.length; i += 1) {
      if (i === sourceIndex) {
        continue;
      }
      const other = this.mushrooms[i];
      if (!other) {
        continue;
      }
      insertNearest(nearest, i, start.distanceToSquared(other), this.options.neighbourLinks);
    }

    for (let i = 0; i < nearest.length; i += 1) {
      const entry = nearest[i];
      const end = entry ? this.mushrooms[entry.index] : undefined;
      if (!end) {
        continue;
      }
      const phase = sourceIndex * 0.071 + i * 0.19;
      this.addArm(positions, phases, start, end, phase, i < 2 ? 2 : 1);
      const midpoint = new THREE.Vector3().copy(start).lerp(end, 0.46);
      const angle = Math.atan2(end.z - start.z, end.x - start.x) + (i % 2 === 0 ? 1 : -1) * 0.82;
      this.addBranchingArm(positions, phases, midpoint, angle, 18 + i * 5, 1, phase + 0.37, 1);
    }
  }

  private addMushroomRadialGrowth(
    positions: number[],
    phases: number[],
    mushroomPosition: THREE.Vector3,
    sourceIndex: number,
  ): void {
    for (let arm = 0; arm < this.options.radialArms; arm += 1) {
      const angle =
        (sourceIndex * 2.399963 + arm * ((Math.PI * 2) / this.options.radialArms)) % (Math.PI * 2);
      const length = 24 + Math.random() * 68;
      const phase = sourceIndex * 0.043 + arm * 0.113;
      this.addBranchingArm(
        positions,
        phases,
        mushroomPosition,
        angle,
        length,
        this.options.branchDepth,
        phase,
        arm % 3 === 0 ? 2 : 1,
      );
    }
  }

  private addBranchingArm(
    positions: number[],
    phases: number[],
    start: THREE.Vector3,
    angle: number,
    length: number,
    depth: number,
    phaseOffset: number,
    thicknessRepeats: number,
  ): THREE.Vector3 {
    const end = this.clampPoint(
      new THREE.Vector3(
        start.x + Math.cos(angle) * length,
        start.y - (0.36 + depth * 0.18 + Math.random() * 0.55),
        start.z + Math.sin(angle) * length,
      ),
    );
    this.addArm(positions, phases, start, end, phaseOffset, thicknessRepeats);
    if (depth <= 0) {
      return end;
    }

    const branchCount = Math.max(2, depth + 1);
    for (let branch = 0; branch < branchCount; branch += 1) {
      const branchT = 0.24 + branch * (0.56 / branchCount);
      const branchStart = this.clampPoint(
        new THREE.Vector3()
          .copy(start)
          .lerp(end, branchT)
          .add(new THREE.Vector3(0, -0.24 - Math.random() * 0.8, 0)),
      );
      const sideSign = branch % 2 === 0 ? 1 : -1;
      const branchAngle =
        angle +
        sideSign *
          (0.36 + depth * 0.18 + branch * 0.1 + Math.sin(phaseOffset * 19.0 + branch) * 0.12);
      const branchLength = length * (0.36 + Math.random() * 0.16);
      this.addBranchingArm(
        positions,
        phases,
        branchStart,
        branchAngle,
        branchLength,
        depth - 1,
        phaseOffset + branch * 0.173 + depth * 0.41,
        1,
      );
    }

    return end;
  }

  private addArm(
    positions: number[],
    phases: number[],
    start: THREE.Vector3,
    end: THREE.Vector3,
    phaseOffset: number,
    thicknessRepeats: number,
  ): void {
    const side = new THREE.Vector3(
      Math.sin(phaseOffset * 13.7),
      0,
      Math.cos(phaseOffset * 9.1),
    ).normalize();
    const distance = start.distanceTo(end);
    const bend = Math.min(24, Math.max(5, distance * 0.2));
    const controlA = new THREE.Vector3()
      .copy(start)
      .lerp(end, 0.34)
      .addScaledVector(side, bend * Math.sin(phaseOffset * 8.0));
    const controlB = new THREE.Vector3()
      .copy(start)
      .lerp(end, 0.7)
      .addScaledVector(side, bend * Math.cos(phaseOffset * 6.3) * -0.72);
    const depthSag =
      0.7 +
      Math.min(this.options.maxDepth, distance * 0.045) +
      Math.abs(Math.sin(phaseOffset * 12.0)) * 2.1;
    controlA.y -= depthSag * 0.46;
    controlB.y -= depthSag * 0.86;

    for (let repeat = 0; repeat < thicknessRepeats; repeat += 1) {
      const strandOffset = (repeat - (thicknessRepeats - 1) * 0.5) * 0.58;
      for (let segment = 0; segment < this.options.segments; segment += 1) {
        const t0 = segment / this.options.segments;
        const t1 = (segment + 1) / this.options.segments;
        const wiggle0 =
          Math.sin(t0 * Math.PI * 3.0 + phaseOffset * 11.0) * 2.1 +
          Math.sin(t0 * Math.PI * 7.0 + phaseOffset * 5.0) * 0.72;
        const wiggle1 =
          Math.sin(t1 * Math.PI * 3.0 + phaseOffset * 11.0) * 2.1 +
          Math.sin(t1 * Math.PI * 7.0 + phaseOffset * 5.0) * 0.72;

        cubicPoint(previous, start, controlA, controlB, end, t0).addScaledVector(
          side,
          wiggle0 + strandOffset,
        );
        cubicPoint(current, start, controlA, controlB, end, t1).addScaledVector(
          side,
          wiggle1 + strandOffset,
        );
        previous.y -= Math.sin(t0 * Math.PI) * depthSag;
        current.y -= Math.sin(t1 * Math.PI) * depthSag;
        previous.y += 0.12 + Math.sin((t0 + phaseOffset) * 18.0) * 0.06;
        current.y += 0.12 + Math.sin((t1 + phaseOffset) * 18.0) * 0.06;

        positions.push(previous.x, previous.y, previous.z, current.x, current.y, current.z);
        phases.push(t0 + phaseOffset, t1 + phaseOffset);
      }
    }
  }

  /** Keep points inside the horizontal radius around the mushrooms' centroid. */
  private clampPoint(point: THREE.Vector3): THREE.Vector3 {
    const dx = point.x - this.centre.x;
    const dz = point.z - this.centre.z;
    const horizontalLengthSq = dx * dx + dz * dz;
    if (horizontalLengthSq > this.options.radius * this.options.radius) {
      const horizontalScale = this.options.radius / Math.sqrt(horizontalLengthSq);
      point.x = this.centre.x + dx * horizontalScale;
      point.z = this.centre.z + dz * horizontalScale;
    }
    return point;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.armGeometry.dispose();
    this.glowGeometry.dispose();
    this.arm.material.dispose();
    this.glow.material.dispose();
  }
}

function insertNearest(
  nearest: { index: number; distanceSq: number }[],
  index: number,
  distanceSq: number,
  limit: number,
): void {
  for (let i = 0; i < nearest.length; i += 1) {
    const entry = nearest[i];
    if (entry && distanceSq >= entry.distanceSq) {
      continue;
    }
    nearest.splice(i, 0, { index, distanceSq });
    nearest.length = Math.min(nearest.length, limit);
    return;
  }
  if (nearest.length < limit) {
    nearest.push({ index, distanceSq });
  }
}
