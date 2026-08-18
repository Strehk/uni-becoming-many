// ── Becoming Many — Onboarding (EXPERIMENT) ────────────────────
//
// A wordless flying lesson made of air, and a gate on the piece: the timeline does not start
// until the flier has actually flown. The opening is a white void with nothing but drifting
// motes, so the lesson borrows that very material rather than laying an overlay over it.
//
// The life of one mote, which is the whole idea:
//
//   1. It hangs in the air, an ordinary speck like the atmosphere's.
//   2. A task begins: it is drawn out of the air into the sign, growing as it goes, and it
//      breathes there on two mismatched rates — a sign made of air, never a decal.
//   3. The task is flown, and the sign is eaten away ACROSS its width from the side you are
//      flying away from. When the front passes this mote, it is RELEASED.
//   4. Released, it simply stops — keeping the world position it had at that instant and
//      shrinking back to a speck. The flier passes it like any other dust.
//   5. The next task gathers it back out of the air.
//
// That is why positions are computed on the CPU and uploaded as WORLD coordinates: a released
// mote must stay where it was while the sign itself keeps riding in front of the eye, and
// remembering a per-mote position across frames in the shader would mean a compute pass for
// 260 points the CPU can place for free.
//
// Progress is measured off the FLIGHT, not off the keys (see tasks.ts), so the same lesson
// works on the keyboard, on a phone's tilt and on the ICAROS machine.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes from
// `three/webgpu`. No GLSL.

import { attribute, float, mix, positionView, smoothstep, uniform, uv, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";
import type { OnboardingConcept } from "./concepts.ts";
import { fillShape } from "./shapes.ts";
import { type FlightSample, TASKS, type TaskDef, gateProgress, taskGain } from "./tasks.ts";

export type { OnboardingConcept } from "./concepts.ts";

/** Motes in the guiding field. Few and fat reads as air; many and fine reads as print. */
const COUNT = 260;
/** How far ahead the signs hang (m), and how big they are. */
const SIGN_DISTANCE = 9;
const SIGN_SCALE = 2.0;
/** Inside this distance a gate counts as flown through (m). */
const GATE_PASSED = 6;
/** Radius of a mote in the sign (m) and once released back into the air (m). */
const MOTE_RADIUS = 0.13;
const DUST_RADIUS = 0.05;
/** How far a mote in the sign breathes (m). */
const WOBBLE = 0.19;
const TAU = 6.2831853;

export interface CreateOnboardingOptions {
  scene: THREE.Scene;
  /** The live sense uniforms — the same set terrain, flora and dust wear. */
  uniforms: KitUniforms;
  /** The presenting camera; signs are placed relative to where it looks. */
  camera: THREE.Camera;
  concept?: OnboardingConcept;
  /** Called once when the last task is done — the host starts the piece here. */
  onComplete?: () => void;
}

export interface Onboarding {
  readonly group: THREE.Group;
  /** The task now running, for a host that wants to show its hint. */
  readonly currentHint: string;
  /** 0..1 through the whole lesson. */
  readonly overallProgress: number;
  setConcept(concept: OnboardingConcept): void;
  /** Arm the lesson from the top (or fade it away). */
  setActive(active: boolean): void;
  /** Advance one frame. `sample` is where the flier is now. */
  update(dtSeconds: number, sample: FlightSample): void;
  dispose(): void;
}

type Phase = "gather" | "work" | "release" | "gap" | "done";

export function createOnboarding(opts: CreateOnboardingOptions): Onboarding {
  const group = new THREE.Group();
  group.name = "onboarding-guide";
  opts.scene.add(group);

  // ── geometry ──
  const base = new THREE.PlaneGeometry(1, 1);
  const position = base.getAttribute("position");
  const uvAttr = base.getAttribute("uv");
  if (!base.index || !position || !uvAttr) {
    throw new Error("[onboarding] PlaneGeometry is missing position/uv/index");
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", position);
  geometry.setAttribute("uv", uvAttr);

  const positions = new Float32Array(COUNT * 3); // world space, CPU-written (see header)
  const positionAttr = new THREE.InstancedBufferAttribute(positions, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("guidePos", positionAttr);

  const sizes = new Float32Array(COUNT);
  const sizeAttr = new THREE.InstancedBufferAttribute(sizes, 1);
  sizeAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("guideSize", sizeAttr);
  geometry.instanceCount = COUNT;

  /** The sign's points in its own frame (+x right, +y up), rewritten per task. */
  const targets = new Float32Array(COUNT * 3);
  /** Where each mote sits along the dissolve axis, 0 (last to go) … 1 (first to go). */
  const along = new Float32Array(COUNT);
  /** Motes that have been given up and now hang still in the world. */
  const released = new Uint8Array(COUNT);
  /** A released mote's world position — also where a gathering mote starts from. */
  const free = new Float32Array(COUNT * 3);
  /** Per-mote size jitter and phase, so the stroke is not made of identical dots. */
  const jitter = new Float32Array(COUNT);
  const stagger = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    jitter[i] = 0.8 + Math.random() * 0.45;
    stagger[i] = Math.random();
  }

  // ── material: it only reads the two CPU-written attributes ──
  const uFade = uniform(0); // the field's own presence

  const material = new THREE.SpriteNodeMaterial();
  // Opaque pass with alpha test, exactly like the atmosphere: the WebGPU WebXR path does not
  // present the transparent pass, so a blended field would vanish in the headset.
  material.transparent = false;
  material.depthWrite = true;
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  material.sizeAttenuation = true;

  material.positionNode = attribute<"vec3">("guidePos", "vec3");
  material.scaleNode = attribute<"float">("guideSize", "float");

  // Look: the atmosphere's dark fleck wearing the sense fog, so the guide is the same air.
  const dist = positionView.z.negate();
  const fogT = dist
    .sub(opts.uniforms.fogNear)
    .div(opts.uniforms.fogFar.sub(opts.uniforms.fogNear))
    .clamp(0.0, 1.0);
  material.colorNode = mix(vec3(0.0, 0.0, 0.0), opts.uniforms.fogColor, fogT);

  const r = uv().sub(0.5).length().mul(2.0);
  // Released motes stay where they were let go, so the flier eventually passes right through
  // them — without the atmosphere's near fade they would smear across the whole view a metre
  // from the eye. Same numbers as the dust, so the two behave alike up close.
  const nearFade = smoothstep(float(1.5), float(6.0), dist);
  material.opacityNode = smoothstep(float(1.0), float(0.0), r).mul(nearFade).mul(0.95).mul(uFade);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  group.add(mesh);

  // ── lesson state ──
  let concept: OnboardingConcept = opts.concept ?? "tutorial";
  let index = 0;
  let phaseName: Phase = "gather";
  let elapsed = 0;
  let active = false;
  let fade = 0;
  let clock = 0;
  let progress = 0;
  let completed = false;
  const DEBUG = new URLSearchParams(window.location.search).get("onboardingDebug") === "1";
  let debugTimer = 0;

  /** Last frame's sample; turning and climbing are accumulated from frame to frame. */
  const lastSample: FlightSample = { x: 0, y: 0, z: 0, yaw: 0 };
  /** How much of the asked-for motion has been made, in the task's own unit. */
  let earned = 0;

  const gatePos = new THREE.Vector3();
  let gateStartDistance = 1;
  let gatePlanted = false;

  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  const task = (): TaskDef | undefined => TASKS[index];

  const startTask = (sample: FlightSample): void => {
    const current = task();
    phaseName = current ? "gather" : "done";
    elapsed = 0;
    progress = 0;
    earned = 0;
    gatePlanted = false;
    released.fill(0); // whatever is hanging in the air is gathered back up
    Object.assign(lastSample, sample);
    if (!current) return;

    const scale = current.kind === "gate" ? (current.radius ?? 6) : SIGN_SCALE;
    fillShape(current.shape, targets, COUNT, scale);

    // Measure the shape along the dissolve axis, so the front can walk across it in a straight
    // sweep no matter how the strokes happen to be laid out.
    const [ax, ay] = current.dissolveFrom;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < COUNT; i++) {
      const p = (targets[i * 3] ?? 0) * ax + (targets[i * 3 + 1] ?? 0) * ay;
      if (p < min) min = p;
      if (p > max) max = p;
    }
    const range = Math.max(1e-3, max - min);
    for (let i = 0; i < COUNT; i++) {
      const p = (targets[i * 3] ?? 0) * ax + (targets[i * 3 + 1] ?? 0) * ay;
      along[i] = ax === 0 && ay === 0 ? 0 : (p - min) / range;
    }
  };

  const restart = (sample: FlightSample): void => {
    index = 0;
    completed = false;
    startTask(sample);
  };

  /** Signs ride in front of the eye; gates are planted once and then stand in the world. */
  const placeAnchor = (current: TaskDef | undefined): void => {
    opts.camera.getWorldPosition(camPos);
    opts.camera.getWorldQuaternion(camQuat);
    forward.set(0, 0, -1).applyQuaternion(camQuat);
    right.set(1, 0, 0).applyQuaternion(camQuat);
    up.set(0, 1, 0).applyQuaternion(camQuat);

    if (current?.kind === "gate") {
      if (!gatePlanted) {
        // Plant it along the HEADING, level with the flier — not along the gaze. The gaze may
        // still be tilted from the climb task that just ended, which would hang the ring above
        // or below the path and make it unreachable without anyone understanding why.
        scratch.copy(forward);
        scratch.y = 0;
        if (scratch.lengthSq() < 1e-6) scratch.set(0, 0, -1);
        scratch.normalize();
        gatePos.copy(camPos).addScaledVector(scratch, current.distance ?? 70);
        gateStartDistance = Math.max(1, camPos.distanceTo(gatePos));
        gatePlanted = true;
      }
      anchor.copy(gatePos);
      return;
    }
    anchor.copy(camPos).addScaledVector(forward, SIGN_DISTANCE);
  };

  /** Place every mote for this frame — see the life-of-a-mote note in the header. */
  const placeMotes = (formMix: number): void => {
    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      const own = stagger[i] ?? 0;
      const gathered = Math.max(0, Math.min(1, (formMix - own * 0.4) / 0.6));

      // The front walks across the sign as the task is flown; whoever it passes lets go.
      if (released[i] === 0 && progress > 0 && 1 - (along[i] ?? 0) < progress) {
        released[i] = 1;
        free[i3] = positions[i3] ?? 0;
        free[i3 + 1] = positions[i3 + 1] ?? 0;
        free[i3 + 2] = positions[i3 + 2] ?? 0;
      }

      if (released[i] === 1) {
        // Stopped: it keeps its world place and is a speck again. The flier passes it.
        positions[i3] = free[i3] ?? 0;
        positions[i3 + 1] = free[i3 + 1] ?? 0;
        positions[i3 + 2] = free[i3 + 2] ?? 0;
        sizes[i] = DUST_RADIUS * (jitter[i] ?? 1);
        continue;
      }

      // Two mismatched rates per axis: the motes never fall into a common rhythm, so the sign
      // keeps breathing instead of pulsing.
      const phase = own * TAU;
      const wobbleX = Math.sin(clock * 0.41 + phase) + 0.4 * Math.sin(clock * 0.97 + phase * 2.3);
      const wobbleY = Math.sin(clock * 0.33 + phase * 1.4) + 0.4 * Math.sin(clock * 0.79 + phase);
      const wobbleZ = Math.sin(clock * 0.27 + phase * 2.1);

      scratch
        .copy(anchor)
        .addScaledVector(right, (targets[i3] ?? 0) + wobbleX * WOBBLE)
        .addScaledVector(up, (targets[i3 + 1] ?? 0) + wobbleY * WOBBLE)
        .addScaledVector(forward, (targets[i3 + 2] ?? 0) + wobbleZ * WOBBLE);

      // Gathering: out of wherever it was left hanging, into the sign.
      const fx = free[i3] ?? scratch.x;
      const fy = free[i3 + 1] ?? scratch.y;
      const fz = free[i3 + 2] ?? scratch.z;
      positions[i3] = fx + (scratch.x - fx) * gathered;
      positions[i3 + 1] = fy + (scratch.y - fy) * gathered;
      positions[i3 + 2] = fz + (scratch.z - fz) * gathered;
      sizes[i] = (DUST_RADIUS + (MOTE_RADIUS - DUST_RADIUS) * gathered) * (jitter[i] ?? 1);
    }
    positionAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  };

  return {
    group,

    get currentHint(): string {
      return task()?.hint ?? "";
    },

    get overallProgress(): number {
      return TASKS.length === 0 ? 1 : Math.min(1, (index + progress) / TASKS.length);
    },

    setConcept(next: OnboardingConcept): void {
      concept = next;
    },

    setActive(next: boolean): void {
      active = next;
      if (next) restart({ x: 0, y: 0, z: 0, yaw: 0 });
    },

    update(dtSeconds: number, sample: FlightSample): void {
      const targetFade = active && phaseName !== "done" ? 1 : 0;
      fade += (targetFade - fade) * Math.min(1, dtSeconds / 0.5);
      uFade.value = fade;
      if (!active && fade < 0.002) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      clock += dtSeconds;

      const current = task();
      placeAnchor(current);
      if (phaseName === "done" || !current) {
        placeMotes(0);
        return;
      }
      elapsed += dtSeconds;

      switch (phaseName) {
        case "gather": {
          // Nothing counts until the ask is legible — the flier cannot answer a question they
          // have not been shown yet.
          Object.assign(lastSample, sample);
          if (elapsed >= 1.2) {
            phaseName = "work";
            elapsed = 0;
          }
          break;
        }
        case "work": {
          if (concept === "demo") {
            progress = Math.min(1, progress + dtSeconds / 2.5);
          } else if (current.kind === "gate") {
            progress = gateProgress(sample, {
              x: gatePos.x,
              y: gatePos.y,
              z: gatePos.z,
              startDistance: gateStartDistance,
            });
            // Flown THROUGH, not merely approached — that is what finishes a gate.
            if (camPos.distanceTo(gatePos) < GATE_PASSED) progress = 1;
          } else {
            // Wrong-way flying gives ground back; standing still simply holds. The task waits.
            const gain = taskGain(current, lastSample, sample);
            earned = Math.max(0, earned + gain);
            progress = Math.min(1, earned / current.amount);
          }
          Object.assign(lastSample, sample);
          if (DEBUG) {
            debugTimer += dtSeconds;
            if (debugTimer > 0.5) {
              debugTimer = 0;
              console.log(
                `[onboarding] ${current.id} earned=${earned.toFixed(2)}/${current.amount.toFixed(2)} p=${progress.toFixed(2)}`,
              );
            }
          }
          // The sign has been eaten away entirely — nothing left to dissolve, so move on.
          if (progress >= 1) {
            phaseName = "release";
            elapsed = 0;
          }
          break;
        }
        case "release": {
          // A held beat with the last motes hanging where they were let go, then on.
          if (elapsed >= 0.6) {
            phaseName = "gap";
            elapsed = 0;
          }
          break;
        }
        case "gap": {
          if (elapsed >= 0.5) {
            index++;
            if (index >= TASKS.length) {
              phaseName = "done";
              if (!completed) {
                completed = true;
                if (DEBUG) console.log("[onboarding] fertig — das Stueck beginnt");
                opts.onComplete?.(); // the lesson is over — the piece may begin
              }
            } else {
              startTask(sample);
            }
          }
          break;
        }
      }

      // Gates never dissolve, so their motes stay gathered; a sign fades its remaining motes
      // back into the air over the gap.
      const gathering = phaseName === "gather" ? Math.min(1, elapsed / 1.2) : 1;
      const letting = phaseName === "gap" ? Math.max(0, 1 - elapsed / 0.5) : gathering;
      placeMotes(letting);
    },

    dispose(): void {
      group.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
