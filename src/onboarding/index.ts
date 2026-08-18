// ── Becoming Many — Onboarding (EXPERIMENT) ────────────────────
//
// A wordless flying lesson made of air, and a gate on the piece: the timeline does not
// start until the flier has actually flown. The opening is a white void with nothing but
// drifting motes, so the lesson borrows that very material rather than laying an overlay
// over it — dust gathers into a sign, the sign FILLS as you do the thing it asks for, and
// when it is full it bursts and lets go.
//
// It is a second, small mote field rather than a hijacking of `src/atmosphere` — the
// atmosphere belongs to the whole piece and must not grow a teaching mode. It wears the
// same sense uniforms, the same dark-fleck-in-fog colouring and the same soft round dot,
// so the two read as one air.
//
// Three things carry the interaction, and all three live in the material:
//
//   • **Fill** — every mote knows its RANK along the stroke (0 at the tail, 1 at the tip).
//     Motes below the task's progress are firm and dark, the rest stay a faint outline. So
//     the sign is always fully legible (you can see what is being asked) while the filled
//     part answers, live, "yes — what you are doing right now is working".
//   • **Pulse** — a bright wave travels along the rank while the task is open, which both
//     animates the arrow and points along it.
//   • **Burst** — on completion the motes push outward and flare, then dissolve.
//
// Progress itself is measured off the FLIGHT, not off the keys (see tasks.ts), so the same
// lesson works on the keyboard, on a phone's tilt and on the ICAROS machine.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes from
// `three/webgpu`. No GLSL.

import {
  attribute,
  float,
  fract,
  hash,
  instanceIndex,
  mix,
  positionView,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";
import type { OnboardingConcept } from "./concepts.ts";
import { fillShape } from "./shapes.ts";
import { type FlightSample, TASKS, type TaskDef, gateProgress, taskGain } from "./tasks.ts";

export type { OnboardingConcept } from "./concepts.ts";

/** Motes in the guiding field. Enough to draw a legible sign, still one cheap draw call. */
const COUNT = 900;
/** Radius of the resting cloud the motes drift in before they gather (m). */
const CLOUD_RADIUS = 3.2;
/** How far ahead the signs hang (m), and how big they are. */
const SIGN_DISTANCE = 9;
const SIGN_SCALE = 2.0;
/** Inside this distance a gate counts as flown through (m). */
const GATE_PASSED = 6;
/** Mote radius (m), matching the atmosphere's speck size. */
const MOTE_RADIUS = 0.075;
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

type Phase = "gather" | "work" | "success" | "release" | "gap" | "done";

export function createOnboarding(opts: CreateOnboardingOptions): Onboarding {
  const group = new THREE.Group();
  group.name = "onboarding-guide";
  opts.scene.add(group);

  // ── geometry: a quad per mote, its resting place, its point on the sign, its rank ──
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

  const rest = new Float32Array(COUNT * 3);
  const ranks = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const dir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ).normalize();
    const r = CLOUD_RADIUS * Math.cbrt(Math.random());
    rest[i * 3 + 0] = dir.x * r;
    rest[i * 3 + 1] = dir.y * r * 0.7;
    rest[i * 3 + 2] = dir.z * r;
    ranks[i] = (i + 0.5) / COUNT; // `fillShape` walks the strokes in index order
  }
  geometry.setAttribute("guideRest", new THREE.InstancedBufferAttribute(rest, 3));
  geometry.setAttribute("guideRank", new THREE.InstancedBufferAttribute(ranks, 1));

  const targets = new Float32Array(COUNT * 3);
  const targetAttr = new THREE.InstancedBufferAttribute(targets, 3);
  targetAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("guideTarget", targetAttr);
  geometry.instanceCount = COUNT;

  // ── uniforms ──
  const uForm = uniform(0); // cloud → sign
  const uProgress = uniform(0); // how much of the sign is filled in
  const uSuccess = uniform(0); // the completion burst
  const uFade = uniform(0);
  const uClock = uniform(0);

  // ── material ──
  const material = new THREE.SpriteNodeMaterial();
  // Opaque pass with alpha test, exactly like the atmosphere: the WebGPU WebXR path does
  // not present the transparent pass, so a blended field would vanish in the headset.
  material.transparent = false;
  material.depthWrite = true;
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  material.sizeAttenuation = true;

  const restPos = attribute<"vec3">("guideRest", "vec3");
  const target = attribute<"vec3">("guideTarget", "vec3");
  const rank = attribute<"float">("guideRank", "float");

  // Per-mote stagger, so the sign gathers and dissolves like settling dust.
  const stagger = hash(instanceIndex);
  const gathered = smoothstep(stagger.mul(0.4), stagger.mul(0.4).add(0.6), uForm);

  // Filled = this mote's stretch of the stroke has been earned. Soft edge, so the fill
  // creeps along the arrow instead of stepping.
  const filled = smoothstep(rank.sub(0.05), rank.add(0.02), uProgress);

  // A bright wave running tail → tip while the task is open: it animates the arrow and
  // says which way it points.
  const wave = fract(rank.sub(uClock.mul(0.35)))
    .oneMinus()
    .pow(6.0);

  const phase = stagger.mul(TAU);
  const drift = vec3(
    sin(uClock.mul(0.5).add(phase)),
    sin(uClock.mul(0.35).add(phase.mul(1.7))),
    sin(uClock.mul(0.42).add(phase.mul(2.3))),
  ).mul(0.35);

  // On success every mote pushes outward from the sign's middle — the sign blows apart
  // rather than merely fading, so completion is unmistakable.
  const burst = target.normalize().mul(uSuccess.mul(2.4));
  material.positionNode = mix(restPos.add(drift), target.add(burst), gathered);

  // Earned stroke vs. outline is carried by SIZE, not by opacity. The field renders in the
  // opaque pass with `alphaTest` (the atmosphere's VR-safe setup), which discards anything
  // under half alpha — a "faint" mote would not be faint there, it would be gone. So an
  // unearned mote is a fine speck, an earned one a fat one, and the stroke visibly thickens
  // along its length as the task is flown.
  const signSize = mix(float(0.5), float(1.5), filled).add(wave.mul(0.45));
  material.scaleNode = float(MOTE_RADIUS)
    .mul(hash(instanceIndex.add(101)).mul(0.5).add(0.75))
    .mul(mix(float(0.45), signSize, gathered))
    .mul(uSuccess.mul(0.6).add(1.0));

  // Look: the atmosphere's dark fleck wearing the sense fog, so the guide is the same air.
  const dist = positionView.z.negate();
  const fogT = dist
    .sub(opts.uniforms.fogNear)
    .div(opts.uniforms.fogFar.sub(opts.uniforms.fogNear))
    .clamp(0.0, 1.0);
  material.colorNode = mix(vec3(0.0, 0.0, 0.0), opts.uniforms.fogColor, fogT);

  const r = uv().sub(0.5).length().mul(2.0);
  const disc = smoothstep(float(1.0), float(0.0), r);
  // Opacity only carries the round dot and the field's own fade — every other distinction
  // lives in the size above, for the alphaTest reason given there.
  material.opacityNode = disc.mul(0.95).mul(uFade);

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

  const task = (): TaskDef | undefined => TASKS[index];

  const startTask = (sample: FlightSample): void => {
    const current = task();
    phaseName = current ? "gather" : "done";
    elapsed = 0;
    progress = 0;
    uProgress.value = 0;
    uSuccess.value = 0;
    gatePlanted = false;
    earned = 0;
    Object.assign(lastSample, sample);
    if (!current) return;
    const scale = current.kind === "gate" ? (current.radius ?? 6) : SIGN_SCALE;
    fillShape(current.shape, targets, COUNT, scale);
    targetAttr.needsUpdate = true;
  };

  const restart = (sample: FlightSample): void => {
    index = 0;
    completed = false;
    startTask(sample);
  };

  /** Signs ride in front of the eye; gates are planted once and then stand in the world. */
  const place = (current: TaskDef | undefined): void => {
    opts.camera.getWorldPosition(camPos);
    opts.camera.getWorldQuaternion(camQuat);
    forward.set(0, 0, -1).applyQuaternion(camQuat);

    if (current?.kind === "gate") {
      if (!gatePlanted) {
        // Plant it along the HEADING, level with the flier — not along the gaze. The gaze
        // may still be tilted from the climb task that just ended, which would hang the ring
        // above or below the path and make it unreachable without anyone understanding why.
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        gatePos.copy(camPos).addScaledVector(forward, current.distance ?? 70);
        gateStartDistance = Math.max(1, camPos.distanceTo(gatePos));
        gatePlanted = true;
      }
      group.position.copy(gatePos);
      group.quaternion.copy(camQuat); // face the flier, so it stays a ring to aim at
      return;
    }
    group.position.copy(camPos).addScaledVector(forward, SIGN_DISTANCE);
    group.quaternion.copy(camQuat);
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
      uClock.value = clock;

      const current = task();
      place(current);
      if (phaseName === "done" || !current) {
        uForm.value = 0;
        return;
      }
      elapsed += dtSeconds;

      switch (phaseName) {
        case "gather": {
          uForm.value = Math.min(1, elapsed / 1.0);
          // Nothing counts until the ask is legible — the flier cannot answer a question
          // they have not been shown yet.
          Object.assign(lastSample, sample);
          if (elapsed >= 1.0) {
            phaseName = "work";
            elapsed = 0;
          }
          break;
        }
        case "work": {
          uForm.value = 1;
          // The demo staging runs itself, so the look can be judged without flying.
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
            // Wrong-way flying gives ground back; standing still simply holds. The task
            // waits — it is a lesson, not a timed exam.
            const gain = taskGain(current, lastSample, sample);
            earned = Math.max(0, earned + gain);
            progress = Math.min(1, earned / current.amount);
          }
          Object.assign(lastSample, sample);
          uProgress.value = progress;
          if (DEBUG) {
            debugTimer += dtSeconds;
            if (debugTimer > 0.5) {
              debugTimer = 0;
              console.log(
                `[onboarding] ${current.id} y=${sample.y.toFixed(1)} earned=${earned.toFixed(2)}/${current.amount.toFixed(2)} p=${progress.toFixed(2)}`,
              );
            }
          }
          if (progress >= 1) {
            phaseName = "success";
            elapsed = 0;
          }
          break;
        }
        case "success": {
          uProgress.value = 1;
          uSuccess.value = Math.min(1, elapsed / 0.35);
          if (elapsed >= 0.55) {
            phaseName = "release";
            elapsed = 0;
          }
          break;
        }
        case "release": {
          uSuccess.value = 1;
          uForm.value = Math.max(0, 1 - elapsed / 0.8);
          if (elapsed >= 0.8) {
            phaseName = "gap";
            elapsed = 0;
          }
          break;
        }
        case "gap": {
          uForm.value = 0;
          uSuccess.value = 0;
          if (elapsed >= 0.7) {
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
    },

    dispose(): void {
      group.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
