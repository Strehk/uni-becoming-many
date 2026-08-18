// ── Becoming Many — Onboarding (EXPERIMENT) ────────────────────
//
// A wordless flight lesson made of air. The piece opens in a white void with nothing but
// drifting motes, and this borrows that same material to say "steer right", "climb",
// "fly through here" — dust gathers into a sign, holds, and lets go again. No labels, no
// overlay, nothing that reads as UI: the emptiness stays the emptiness.
//
// It is a SECOND, small mote field rather than a hijacking of `src/atmosphere` — the
// atmosphere belongs to the whole piece and must not grow a teaching mode. This field
// wears the same look (the sense `KitUniforms`, the same dark-fleck-in-fog colouring, the
// same soft round dot) so the two read as one air.
//
// Three concepts are on offer, because the right answer here is a question of taste and
// wants to be flown, not argued (the start menu picks one):
//
//   • `zeichen` — signs form in front of you: → ← ↑ ↓ and a ring. The most explicit.
//   • `strom`   — no glyph at all; the dust simply STREAMS the way you should go, and you
//                 read the direction off the motion the way you read wind off a field.
//   • `tor`     — world-fixed rings hang ahead; flying through one dissolves it and the
//                 next appears. The lesson is the doing.
//
// Shape → motes: `shapes.ts` samples strokes into points; the material blends each mote
// between its resting place in the cloud and its point on the sign, staggered per mote so
// the sign gathers and dissolves rather than snapping.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes from
// `three/webgpu`. No GLSL.

import {
  attribute,
  float,
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
import { type ShapeId, fillShape } from "./shapes.ts";

export type { OnboardingConcept } from "./concepts.ts";

/** Motes in the guiding field. Enough to draw a legible sign, still one cheap draw call. */
const COUNT = 900;
/** Radius of the resting cloud the motes drift in before they gather (m). */
const CLOUD_RADIUS = 3.2;
/** How far ahead the signs hang (m). */
const SIGN_DISTANCE = 7;
/** Sign size (m) — the arrow spans roughly twice this. */
const SIGN_SCALE = 1.6;
/** Where a gate is planted ahead of the player (m), and how near counts as "through". */
const GATE_DISTANCE = 26;
const GATE_SCALE = 3.4;
const GATE_PASSED = 5;
/** Mote radius (m), matching the atmosphere's speck size. */
const MOTE_RADIUS = 0.075;
const TAU = 6.2831853;

export interface CreateOnboardingOptions {
  scene: THREE.Scene;
  /** The live sense uniforms — the same set terrain, flora and dust wear. */
  uniforms: KitUniforms;
  /** The presenting camera; the signs are placed relative to where it looks. */
  camera: THREE.Camera;
  concept?: OnboardingConcept;
}

export interface Onboarding {
  readonly group: THREE.Group;
  /** Switch staging and start it from the top. */
  setConcept(concept: OnboardingConcept): void;
  /** Run the lesson from the beginning (also re-arms after it has finished). */
  restart(): void;
  /** Fade the whole field out and stop stepping (the lesson is over / never asked for). */
  setActive(active: boolean): void;
  update(dtSeconds: number): void;
  dispose(): void;
}

/** One beat of a lesson. */
interface Beat {
  readonly shape: ShapeId;
  /** Seconds to gather, to hold, to let go. */
  readonly gather: number;
  readonly hold: number;
  readonly release: number;
  /** Direction the stream flows in, for the `strom` concept (local x/y). */
  readonly flow?: readonly [number, number];
}

const SIGN_BEATS: readonly Beat[] = [
  { shape: "arrow-right", gather: 1.1, hold: 1.4, release: 0.9 },
  { shape: "arrow-left", gather: 1.1, hold: 1.4, release: 0.9 },
  { shape: "arrow-up", gather: 1.1, hold: 1.4, release: 0.9 },
  { shape: "arrow-down", gather: 1.1, hold: 1.4, release: 0.9 },
  { shape: "ring", gather: 1.3, hold: 1.8, release: 1.2 },
];

const FLOW_BEATS: readonly Beat[] = [
  { shape: "arc-right", gather: 1.2, hold: 2.2, release: 1.0, flow: [1, 0] },
  { shape: "arc-left", gather: 1.2, hold: 2.2, release: 1.0, flow: [-1, 0] },
  { shape: "arrow-up", gather: 1.2, hold: 2.0, release: 1.0, flow: [0, 1] },
  { shape: "arrow-down", gather: 1.2, hold: 2.0, release: 1.0, flow: [0, -1] },
];

const GATE_BEATS: readonly Beat[] = [
  { shape: "ring", gather: 1.4, hold: 999, release: 1.0 },
  { shape: "ring", gather: 1.4, hold: 999, release: 1.0 },
  { shape: "ring", gather: 1.4, hold: 999, release: 1.0 },
];

function beatsFor(concept: OnboardingConcept): readonly Beat[] {
  if (concept === "strom") return FLOW_BEATS;
  if (concept === "tor") return GATE_BEATS;
  return SIGN_BEATS;
}

export function createOnboarding(opts: CreateOnboardingOptions): Onboarding {
  const group = new THREE.Group();
  group.name = "onboarding-guide";
  opts.scene.add(group);

  // ── geometry: a quad per mote, plus its resting place and its point on the sign ──
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

  // Resting places: a soft ball of dust around the anchor, denser toward the middle.
  const rest = new Float32Array(COUNT * 3);
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
  }
  geometry.setAttribute("guideRest", new THREE.InstancedBufferAttribute(rest, 3));

  const targets = new Float32Array(COUNT * 3);
  const targetAttr = new THREE.InstancedBufferAttribute(targets, 3);
  targetAttr.setUsage(THREE.DynamicDrawUsage); // rewritten on every shape change
  geometry.setAttribute("guideTarget", targetAttr);
  geometry.instanceCount = COUNT;

  // ── uniforms ──
  const uForm = uniform(0); // 0 = resting cloud, 1 = fully gathered
  const uFade = uniform(0); // whole-field presence
  const uClock = uniform(0);
  const uFlow = uniform(new THREE.Vector3(0, 0, 0)); // streaming direction (concept "strom")
  const uFlowMix = uniform(0);

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

  // Per-mote stagger: each one starts gathering at its own moment, so the sign assembles
  // and dissolves like settling dust instead of snapping into place.
  const stagger = hash(instanceIndex);
  const local = smoothstep(stagger.mul(0.45), stagger.mul(0.45).add(0.55), uForm);

  // Resting drift — the same slow breathing the atmosphere motes have.
  const phase = stagger.mul(TAU);
  const drift = vec3(
    sin(uClock.mul(0.5).add(phase)),
    sin(uClock.mul(0.35).add(phase.mul(1.7))),
    sin(uClock.mul(0.42).add(phase.mul(2.3))),
  ).mul(0.35);

  // Streaming: while gathered, the motes travel along the flow direction and wrap, so the
  // sign reads as a current rather than a picture. `uFlowMix` gates it per concept.
  const travel = uClock.mul(0.9).add(stagger.mul(3.0)).mod(3.0).sub(1.5);
  const streamed = target.add(uFlow.mul(travel).mul(uFlowMix));

  material.positionNode = mix(restPos.add(drift), streamed, local);
  material.scaleNode = float(MOTE_RADIUS).mul(hash(instanceIndex.add(101)).mul(0.5).add(0.75));

  // Look: the atmosphere's dark fleck wearing the sense fog, so the guide is made of the
  // same air as everything else. Resting motes stay faint; gathered ones firm up.
  // Depth comes from view space (like the mosquito sprites) — the mote's own distance,
  // live, without needing a world position the node graph cannot see.
  const dist = positionView.z.negate();
  const fogT = dist
    .sub(opts.uniforms.fogNear)
    .div(opts.uniforms.fogFar.sub(opts.uniforms.fogNear))
    .clamp(0.0, 1.0);
  material.colorNode = mix(vec3(0.0, 0.0, 0.0), opts.uniforms.fogColor, fogT);

  const r = uv().sub(0.5).length().mul(2.0);
  const disc = smoothstep(float(1.0), float(0.0), r);
  material.opacityNode = disc.mul(mix(float(0.1), float(1.0), local)).mul(uFade);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  group.add(mesh);

  // ── state ──
  let concept: OnboardingConcept = opts.concept ?? "zeichen";
  let beats = beatsFor(concept);
  let index = 0;
  let phaseName: "gather" | "hold" | "release" | "gap" | "done" = "gather";
  let elapsed = 0;
  let active = false;
  let fade = 0;
  let clock = 0;
  /** World placement for the gate concept — set once when the beat starts. */
  const gateAnchor = new THREE.Vector3();
  let gatePlanted = false;

  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const forward = new THREE.Vector3();

  const applyShape = (beat: Beat): void => {
    const scale = concept === "tor" ? GATE_SCALE : SIGN_SCALE;
    fillShape(beat.shape, targets, COUNT, scale);
    targetAttr.needsUpdate = true;
    uFlow.value.set(beat.flow?.[0] ?? 0, beat.flow?.[1] ?? 0, 0);
    uFlowMix.value = concept === "strom" && beat.flow ? 1 : 0;
  };

  const startBeat = (): void => {
    const beat = beats[index];
    if (!beat) {
      phaseName = "done";
      return;
    }
    phaseName = "gather";
    elapsed = 0;
    gatePlanted = false;
    applyShape(beat);
  };

  const restart = (): void => {
    index = 0;
    startBeat();
  };
  restart();

  /** Place the field: signs ride in front of the eye, gates stand still in the world. */
  const place = (): void => {
    opts.camera.getWorldPosition(camPos);
    opts.camera.getWorldQuaternion(camQuat);
    forward.set(0, 0, -1).applyQuaternion(camQuat);

    if (concept === "tor") {
      if (!gatePlanted) {
        gateAnchor.copy(camPos).addScaledVector(forward, GATE_DISTANCE);
        gatePlanted = true;
      }
      group.position.copy(gateAnchor);
      // Face the player, so the ring is always a ring to fly through rather than an ellipse.
      group.quaternion.copy(camQuat);
      return;
    }
    group.position.copy(camPos).addScaledVector(forward, SIGN_DISTANCE);
    group.quaternion.copy(camQuat);
  };

  return {
    group,

    setConcept(next: OnboardingConcept): void {
      concept = next;
      beats = beatsFor(next);
      restart();
    },

    restart,

    setActive(next: boolean): void {
      active = next;
      if (next) restart();
    },

    update(dtSeconds: number): void {
      // Ease the field in and out, so switching it off never snaps.
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
      place();

      if (phaseName === "done") {
        uForm.value = 0;
        return;
      }
      const beat = beats[index];
      if (!beat) return;
      elapsed += dtSeconds;

      // A gate is held not by a timer but by the flight: it dissolves once you are through.
      if (concept === "tor" && phaseName === "hold") {
        const reached = camPos.distanceTo(gateAnchor) < GATE_PASSED;
        if (reached) {
          phaseName = "release";
          elapsed = 0;
        }
      }

      switch (phaseName) {
        case "gather":
          uForm.value = Math.min(1, elapsed / beat.gather);
          if (elapsed >= beat.gather) {
            phaseName = "hold";
            elapsed = 0;
          }
          break;
        case "hold":
          uForm.value = 1;
          if (elapsed >= beat.hold) {
            phaseName = "release";
            elapsed = 0;
          }
          break;
        case "release":
          uForm.value = Math.max(0, 1 - elapsed / beat.release);
          if (elapsed >= beat.release) {
            phaseName = "gap";
            elapsed = 0;
          }
          break;
        case "gap":
          uForm.value = 0;
          if (elapsed >= 0.6) {
            index++;
            if (index >= beats.length) {
              phaseName = "done";
            } else {
              startBeat();
            }
          }
          break;
      }
    },

    dispose(): void {
      group.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
