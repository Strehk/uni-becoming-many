// ── SENSE MODULE: Netzwerk — the swarm communication web ───────
//
// Ported from swarm_network `src/SwarmNetwork.js`: between moving nodes (here the
// boids birds) it draws curved connection tubes (InstancedMesh) with a soft glow
// shell and one travelling signal particle per link.
//
// Changes from the prototype: three → three/webgpu, the classic materials became
// NodeMaterials, and the GLSL point shader for the signal particles became an
// instanced-sprite TSL graph (WebGPU has no sizable point primitives). A `uFade`
// uniform (sense signal) scales all opacities.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import { float, instancedArray, mix, smoothstep, uniform, uv } from "three/tsl";
import * as THREE from "three/webgpu";

export interface SwarmNode {
  position: THREE.Vector3;
}

export interface SwarmNetworkOptions {
  maxNodes: number;
  nearestLinks: number;
  linkSegments: number;
  linkRadius: number;
  glowRadius: number;
  linkColor: string;
  glowColor: string;
  signalCoreColor: string;
  signalHaloColor: string;
  signalSpeed: number;
  signalTravelSeconds: number;
  /** Signal particle size in world metres. */
  signalSize: number;
  networkIntensity: number;
  curveStrength: number;
  endpointPadding: number;
}

export const SWARM_DEFAULTS: SwarmNetworkOptions = {
  maxNodes: 64,
  nearestLinks: 2,
  linkSegments: 6,
  linkRadius: 0.09,
  glowRadius: 0.3,
  linkColor: "#ffe45c",
  glowColor: "#ffd400",
  signalCoreColor: "#fff15a",
  signalHaloColor: "#ffd400",
  signalSpeed: 2.45,
  signalTravelSeconds: 0.52,
  signalSize: 1.4,
  networkIntensity: 0.7,
  curveStrength: 0.032,
  endpointPadding: 0.28,
};

// Scratch objects — no per-frame allocation.
const curvePoint = new THREE.Vector3();
const curveNext = new THREE.Vector3();
const curveMid = new THREE.Vector3();
const curveOffset = new THREE.Vector3();
const curveAxis = new THREE.Vector3();
const tubeMatrix = new THREE.Matrix4();
const tubeQuaternion = new THREE.Quaternion();
const tubeScale = new THREE.Vector3();
const tubeUp = new THREE.Vector3(0, 1, 0);
const signalPoint = new THREE.Vector3();

function pingPong(value: number): number {
  const wrapped = value % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

function curvedLinkPoint(
  start: THREE.Vector3,
  end: THREE.Vector3,
  t: number,
  phase: number,
  target: THREE.Vector3,
  curveStrength: number,
): THREE.Vector3 {
  curveMid.copy(start).lerp(end, 0.5);
  curveAxis.copy(end).sub(start);
  curveOffset.set(Math.sin(phase * 5.1), Math.cos(phase * 3.7) * 0.45, Math.sin(phase * 2.9 + 1.3));
  if (curveAxis.lengthSq() > 0.0001) {
    curveOffset.cross(curveAxis).normalize();
  }

  const arcStrength = Math.min(8, Math.max(2.4, curveAxis.length() * curveStrength));
  const arc = Math.sin(t * Math.PI) * arcStrength;
  return target.copy(start).lerp(end, t).addScaledVector(curveOffset, arc);
}

function setTubeSegmentInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
): void {
  curveAxis.copy(end).sub(start);
  const length = curveAxis.length();
  if (length <= 0.001) {
    tubeMatrix.makeScale(0, 0, 0);
    mesh.setMatrixAt(index, tubeMatrix);
    return;
  }

  curveMid.copy(start).add(end).multiplyScalar(0.5);
  tubeQuaternion.setFromUnitVectors(tubeUp, curveAxis.normalize());
  tubeScale.set(radius, length, radius);
  tubeMatrix.compose(curveMid, tubeQuaternion, tubeScale);
  mesh.setMatrixAt(index, tubeMatrix);
}

/** Insert into a sorted nearest-list capped at `limit` (from swarm_network utils). */
export function insertNearestLink(
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

export class SwarmNetwork {
  readonly group: THREE.Group;
  /** Sense-layer fade 0..1 — scales every opacity. */
  readonly fade = uniform(0);

  private options: SwarmNetworkOptions;
  private nodes: SwarmNode[] = [];

  private readonly lineGeometry: THREE.CylinderGeometry;
  private readonly lineMaterial: THREE.MeshBasicNodeMaterial;
  private readonly glowMaterial: THREE.MeshBasicNodeMaterial;
  private readonly lines: THREE.InstancedMesh;
  private readonly glowLines: THREE.InstancedMesh;

  private readonly linkOpacity = uniform(0.3);
  private readonly glowOpacity = uniform(0.05);

  private readonly particlePositions: Float32Array;
  private readonly particleAlphas: Float32Array;
  private readonly particleSizes: Float32Array;
  private readonly particlePosAttr: { needsUpdate: boolean };
  private readonly particleAlphaAttr: { needsUpdate: boolean };
  private readonly particleSizeAttr: { needsUpdate: boolean };
  private readonly particleMaterial: THREE.SpriteNodeMaterial;
  private readonly particles: THREE.Sprite;
  private readonly coreColor = uniform(new THREE.Color(SWARM_DEFAULTS.signalCoreColor));
  private readonly haloColor = uniform(new THREE.Color(SWARM_DEFAULTS.signalHaloColor));

  constructor(options: Partial<SwarmNetworkOptions> = {}) {
    this.options = { ...SWARM_DEFAULTS, ...options };
    this.group = new THREE.Group();
    this.group.name = "swarm-network";

    const maxLinks = this.options.maxNodes * this.options.nearestLinks;
    const tubeInstanceCount = maxLinks * this.options.linkSegments;

    this.lineGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

    this.lineMaterial = new THREE.MeshBasicNodeMaterial();
    this.lineMaterial.colorNode = uniform(new THREE.Color(this.options.linkColor));
    this.lineMaterial.opacityNode = float(this.linkOpacity).mul(this.fade);
    this.lineMaterial.transparent = true;
    this.lineMaterial.depthWrite = false;
    this.lineMaterial.toneMapped = false;
    this.lines = new THREE.InstancedMesh(this.lineGeometry, this.lineMaterial, tubeInstanceCount);
    this.lines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);

    this.glowMaterial = new THREE.MeshBasicNodeMaterial();
    this.glowMaterial.colorNode = uniform(new THREE.Color(this.options.glowColor));
    this.glowMaterial.opacityNode = float(this.glowOpacity).mul(this.fade);
    this.glowMaterial.transparent = true;
    this.glowMaterial.blending = THREE.AdditiveBlending;
    this.glowMaterial.depthWrite = false;
    this.glowMaterial.toneMapped = false;
    this.glowLines = new THREE.InstancedMesh(
      this.lineGeometry,
      this.glowMaterial,
      tubeInstanceCount,
    );
    this.glowLines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glowLines.frustumCulled = false;
    this.group.add(this.glowLines);

    // ── signal particles: one instanced sprite per link (TSL port of the GLSL points) ──
    this.particlePositions = new Float32Array(maxLinks * 3);
    this.particleAlphas = new Float32Array(maxLinks);
    this.particleSizes = new Float32Array(maxLinks);
    const posBuf = instancedArray(this.particlePositions, "vec3");
    const alphaBuf = instancedArray(this.particleAlphas, "float");
    const sizeBuf = instancedArray(this.particleSizes, "float");
    this.particlePosAttr = posBuf.value;
    this.particleAlphaAttr = alphaBuf.value;
    this.particleSizeAttr = sizeBuf.value;

    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    mat.blending = THREE.AdditiveBlending;
    mat.toneMapped = false;
    mat.positionNode = posBuf.toAttribute();
    mat.scaleNode = float(sizeBuf.toAttribute());
    const d = uv().sub(0.5).length();
    const core = smoothstep(0.22, 0.02, d);
    const halo = smoothstep(0.5, 0.12, d);
    mat.colorNode = mix(this.haloColor, this.coreColor, core);
    mat.opacityNode = halo.mul(float(alphaBuf.toAttribute())).mul(this.fade);
    this.particleMaterial = mat;

    this.particles = new THREE.Sprite(mat);
    this.particles.count = 1;
    this.particles.frustumCulled = false;
    this.group.add(this.particles);
  }

  setNodes(nodes: readonly SwarmNode[]): void {
    this.nodes = nodes.slice(0, this.options.maxNodes);
  }

  setOptions(options: Partial<SwarmNetworkOptions>): void {
    this.options = { ...this.options, ...options };
    const lineColor: unknown = this.lineMaterial.colorNode;
    if (lineColor && typeof lineColor === "object" && "value" in lineColor) {
      const v = lineColor.value;
      if (v instanceof THREE.Color) {
        v.set(this.options.linkColor);
      }
    }
    const glowColor: unknown = this.glowMaterial.colorNode;
    if (glowColor && typeof glowColor === "object" && "value" in glowColor) {
      const v = glowColor.value;
      if (v instanceof THREE.Color) {
        v.set(this.options.glowColor);
      }
    }
    this.coreColor.value.set(this.options.signalCoreColor);
    this.haloColor.value.set(this.options.signalHaloColor);
  }

  get currentOptions(): Readonly<SwarmNetworkOptions> {
    return this.options;
  }

  update(_delta: number, elapsed: number): void {
    const positions = this.particlePositions;
    const alphas = this.particleAlphas;
    const sizes = this.particleSizes;
    let linkCount = 0;
    let particleCount = 0;
    const maxLinks = this.options.maxNodes * this.options.nearestLinks;

    for (let i = 0; i < this.nodes.length && linkCount < maxLinks; i += 1) {
      const a = this.nodes[i];
      if (!a) {
        continue;
      }
      const nearest: { index: number; distanceSq: number }[] = [];
      for (let j = 0; j < this.nodes.length; j += 1) {
        if (i === j) {
          continue;
        }
        const other = this.nodes[j];
        if (!other) {
          continue;
        }
        insertNearestLink(
          nearest,
          j,
          a.position.distanceToSquared(other.position),
          this.options.nearestLinks,
        );
      }

      for (let n = 0; n < nearest.length && linkCount < maxLinks; n += 1) {
        const link = nearest[n];
        const b = link ? this.nodes[link.index] : undefined;
        if (!link || !b) {
          continue;
        }
        const distance = Math.sqrt(link.distanceSq);
        const closeness = 1 / (1 + distance * 0.018);
        const phase = i * 0.137 + link.index * 0.071;

        for (let segment = 0; segment < this.options.linkSegments; segment += 1) {
          const t0 = segment / this.options.linkSegments;
          const t1 = (segment + 1) / this.options.linkSegments;
          curvedLinkPoint(
            a.position,
            b.position,
            t0,
            phase,
            curvePoint,
            this.options.curveStrength,
          );
          curvedLinkPoint(a.position, b.position, t1, phase, curveNext, this.options.curveStrength);
          const instanceIndex = linkCount * this.options.linkSegments + segment;
          setTubeSegmentInstance(
            this.lines,
            instanceIndex,
            curvePoint,
            curveNext,
            this.options.linkRadius * (0.82 + closeness * 0.32),
          );
          setTubeSegmentInstance(
            this.glowLines,
            instanceIndex,
            curvePoint,
            curveNext,
            this.options.glowRadius * (0.86 + closeness * 0.25),
          );
        }

        const raw = (elapsed * this.options.signalSpeed) / this.options.signalTravelSeconds + phase;
        const t =
          this.options.endpointPadding + pingPong(raw) * (1 - this.options.endpointPadding * 2);
        curvedLinkPoint(a.position, b.position, t, phase, signalPoint, this.options.curveStrength);

        const offset = particleCount * 3;
        positions[offset] = signalPoint.x;
        positions[offset + 1] = signalPoint.y;
        positions[offset + 2] = signalPoint.z;
        alphas[particleCount] = (0.7 + closeness * 0.28) * this.options.networkIntensity;
        sizes[particleCount] = this.options.signalSize * (0.8 + closeness * 0.7);
        particleCount += 1;
        linkCount += 1;
      }
    }

    this.lines.count = linkCount * this.options.linkSegments;
    this.glowLines.count = linkCount * this.options.linkSegments;
    this.particles.count = Math.max(1, particleCount);
    this.lines.instanceMatrix.needsUpdate = true;
    this.glowLines.instanceMatrix.needsUpdate = true;
    this.linkOpacity.value = 0.18 + this.options.networkIntensity * 0.18;
    this.glowOpacity.value = 0.025 + this.options.networkIntensity * 0.045;
    this.particlePosAttr.needsUpdate = true;
    this.particleAlphaAttr.needsUpdate = true;
    this.particleSizeAttr.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.lineGeometry.dispose();
    this.lineMaterial.dispose();
    this.glowMaterial.dispose();
    this.particleMaterial.dispose();
  }
}
