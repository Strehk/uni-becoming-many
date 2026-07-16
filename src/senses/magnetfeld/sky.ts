// ── SENSE MODULE: Magnetfeld — the sky shows the geomagnetic field ──
//
// Ported from MagnetfeldwahnehmungExperiment1 `sky.js`: nine blendable sky
// visualisations of magnetoreception (aurora compass, field-line dome, radical-pair
// bird view, colour compass, iron filings, moiré interference, plasma streams,
// polarisation lobes, bird spectrum). All modes share one adjustable field axis
// (declination + elevation) and are mixed in ONE shader via weight uniforms —
// mode changes are pure uniform writes, no recompile.
//
// Changes from the prototype: imports moved to three/webgpu + three/tsl, `time`
// replaced by `uSkyTime` (fed from the clock spine, so the sky obeys pause/seek),
// and the material gained `uVisibility` (opacity fade driven by the sense signal).
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import {
  Fn,
  abs,
  acos,
  atan,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  normalize,
  oneMinus,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { cameraPos } from "../../render/camera-pos.ts";
import {
  type ColorUniform,
  type ScalarUniform,
  colorUniform,
  scalarUniform,
} from "../shader/uniforms.ts";

const rad = (d: number): number => (d * Math.PI) / 180;
const DEG = 0.0174533; // degrees → radians inside the shader

type Vec3Node = Node<"vec3">;
type FloatNode = Node<"float">;

/** Seconds on the time spine; the sense module copies `signals.time` in each frame. */
export const uSkyTime = uniform(0);
/** Master fade of the whole sky dome (0 = invisible), eased from the sense signal. */
export const uVisibility = uniform(0);

// ── adjustable field axis + global speed ──

export const field = {
  /** Declination: rotation of the field axis around the up axis (radians). */
  decl: scalarUniform(rad(0)),
  /** Elevation of the axis above the north horizon (physically correct: negative). */
  elev: scalarUniform(rad(20)),
};

export const globalU = {
  speed: scalarUniform(1),
};

/** The nine modes, in shader mix order. */
export const MODE_KEYS = [
  "aurora",
  "lines",
  "bird",
  "spectrum",
  "filings",
  "moire",
  "plasma",
  "polar",
  "birdspec",
] as const;
export type ModeKey = (typeof MODE_KEYS)[number];

/** Mix weight per mode (0..1 each; pure uniform writes). Aurora starts on. */
export const weights: Record<ModeKey, ScalarUniform> = {
  aurora: scalarUniform(1),
  lines: scalarUniform(0),
  bird: scalarUniform(0),
  spectrum: scalarUniform(0),
  filings: scalarUniform(0),
  moire: scalarUniform(0),
  plasma: scalarUniform(0),
  polar: scalarUniform(0),
  birdspec: scalarUniform(0),
};

// ── per-mode parameters (all live uniforms; see the sense UI descriptor) ──

export const modeU = {
  aurora: {
    intensity: scalarUniform(1),
    speed: scalarUniform(1),
    breite: scalarUniform(0.5), // azimuthal extent around north
    hoehe: scalarUniform(0.95), // top edge of the curtains (elevation)
    sterne: scalarUniform(1),
    sar: scalarUniform(1), // red southern arc
    colLow: colorUniform(0x0dff73),
    colHigh: colorUniform(0x8c26e6),
  },
  lines: {
    freq: scalarUniform(18),
    pulse: scalarUniform(1),
    pole: scalarUniform(1),
    speed: scalarUniform(1),
    wobble: scalarUniform(1.4),
    dashFreq: scalarUniform(1.6),
    ringFreq: scalarUniform(20),
    colLine: colorUniform(0x4de6ff),
    colPoleN: colorUniform(0x73ffff),
    colPoleS: colorUniform(0xff4da6),
  },
  bird: {
    grain: scalarUniform(26),
    contrast: scalarUniform(0.95),
    ring: scalarUniform(0.55),
    speed: scalarUniform(1),
    driftRicht: scalarUniform(60),
    driftTempo: scalarUniform(0.4),
    driftVertikal: scalarUniform(0.25),
    stretch: scalarUniform(1),
    blobSchwelle: scalarUniform(0.42),
    sued: scalarUniform(0.55),
    breathe: scalarUniform(1),
    colMuster: colorUniform(0x0f0a38),
    colSued: colorUniform(0xf27326),
  },
  spectrum: {
    rings: scalarUniform(36),
    pole: scalarUniform(1),
    speed: scalarUniform(1),
    ringStaerke: scalarUniform(1),
    zenit: scalarUniform(1),
    bleiche: scalarUniform(0.6),
    colN: colorUniform(0x1433ff),
    colS: colorUniform(0xff520f),
  },
  filings: {
    density: scalarUniform(11),
    strength: scalarUniform(1),
    speed: scalarUniform(1),
    streck: scalarUniform(2.0),
    pole: scalarUniform(0.35),
    schwelle: scalarUniform(0.46),
    colN: colorUniform(0x081242),
    colS: colorUniform(0x731f08),
  },
  moire: {
    freq: scalarUniform(30),
    speed: scalarUniform(1),
    versatz: scalarUniform(0.06),
    kontrast: scalarUniform(1),
    grundhelligkeit: scalarUniform(1),
    colA: colorUniform(0x33e6ff),
    colB: colorUniform(0xffb833),
  },
  plasma: {
    fluss: scalarUniform(1),
    turbulenz: scalarUniform(1),
    dichte: scalarUniform(5),
    hell: scalarUniform(1.4),
    speed: scalarUniform(1),
    colA: colorUniform(0x14e6b8),
    colB: colorUniform(0xd433ff),
  },
  polar: {
    staerke: scalarUniform(1),
    groesse: scalarUniform(1.5),
    rotation: scalarUniform(0),
    tempo: scalarUniform(0.15),
    sued: scalarUniform(0.5),
    speed: scalarUniform(1),
    colA: colorUniform(0x7a29cc),
    colB: colorUniform(0xe6d24d),
  },
  birdspec: {
    grund: scalarUniform(0.22),
    polV: scalarUniform(1.2),
    polBreite: scalarUniform(2.5),
    grain: scalarUniform(30),
    contrast: scalarUniform(0.9),
    driftRicht: scalarUniform(60),
    driftTempo: scalarUniform(0.4),
    driftVertikal: scalarUniform(0.25),
    stretch: scalarUniform(1),
    schimmer: scalarUniform(0.7),
    breathe: scalarUniform(1),
    speed: scalarUniform(1),
    colN: colorUniform(0x1a0f4d),
    colS: colorUniform(0x6b1f0a),
  },
} satisfies Record<ModeKey, Record<string, ScalarUniform | ColorUniform>>;

// ── field geometry ──

const axisDir = (): Vec3Node => {
  const ce = cos(field.elev);
  return vec3(sin(field.decl).mul(ce), sin(field.elev), cos(field.decl).mul(ce).negate());
};
const northH = (): Vec3Node => vec3(sin(field.decl), 0.0, cos(field.decl).negate());
const eastH = (): Vec3Node => vec3(cos(field.decl), 0.0, sin(field.decl));

// Orthonormal basis across the field axis (azimuth coordinates around the axis).
function axisFrame(): { A: Vec3Node; e1: Vec3Node; e2: Vec3Node } {
  const A = axisDir();
  const e1 = normalize(cross(vec3(0.0, 1.0, 0.0), A));
  const e2 = cross(A, e1);
  return { A, e1, e2 };
}

function dirBits(dir: Vec3Node): { elev: FloatNode; nXZ: FloatNode; eXZ: FloatNode } {
  const elev = dir.y;
  const lenXZ = length(dir.xz).max(0.0001);
  const nXZ = dot(dir, northH()).div(lenXZ); // +1 = looking north, −1 = south
  const eXZ = abs(dot(dir, eastH())).div(lenXZ);
  return { elev, nXZ, eXZ };
}

// ── noise helpers ──

const hash3 = Fn(([p]: [Vec3Node]) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453)));

const noise3 = Fn(([p]: [Vec3Node]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0)).toVar();
  const n000 = hash3(i);
  const n100 = hash3(i.add(vec3(1, 0, 0)));
  const n010 = hash3(i.add(vec3(0, 1, 0)));
  const n110 = hash3(i.add(vec3(1, 1, 0)));
  const n001 = hash3(i.add(vec3(0, 0, 1)));
  const n101 = hash3(i.add(vec3(1, 0, 1)));
  const n011 = hash3(i.add(vec3(0, 1, 1)));
  const n111 = hash3(i.add(vec3(1, 1, 1)));
  const x00 = mix(n000, n100, u.x);
  const x10 = mix(n010, n110, u.x);
  const x01 = mix(n001, n101, u.x);
  const x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
});

const fbm = Fn(([p]: [Vec3Node]) => {
  const q = p.toVar();
  const amp = float(0.5).toVar();
  const acc = float(0.0).toVar();
  for (let i = 0; i < 4; i++) {
    acc.addAssign(noise3(q).mul(amp));
    q.assign(q.mul(2.07).add(vec3(11.5, 21.7, 31.9)));
    amp.mulAssign(0.5);
  }
  return acc;
});

const stars = Fn(([d, t]: [Vec3Node, FloatNode]) => {
  const p = d.mul(150.0);
  const cell = floor(p);
  const f = fract(p);
  const h = hash3(cell);
  const core = oneMinus(smoothstep(0.0, 0.35, length(f.sub(0.5))));
  const twinkle = sin(t.mul(2.0).add(h.mul(80.0)))
    .mul(0.4)
    .add(0.8);
  return smoothstep(0.965, 1.0, h).mul(core).mul(twinkle);
});

// ── mode 1: aurora compass ──
const auroraSky = Fn(([dir]: [Vec3Node]) => {
  const U = modeU.aurora;
  const t = uSkyTime.mul(globalU.speed).mul(U.speed);
  const { elev, nXZ } = dirBits(dir);

  const base = mix(
    vec3(0.07, 0.1, 0.2),
    vec3(0.005, 0.008, 0.03),
    smoothstep(0.0, 0.6, elev),
  ).toVar();

  const starI = stars(dir, t)
    .mul(smoothstep(0.02, 0.2, elev))
    .mul(U.sterne);
  base.addAssign(vec3(starI));

  // Aurora: north only, vertical curtains.
  const nn = smoothstep(float(0.55).sub(U.breite.mul(1.4)), 0.55, nXZ);
  const hb = smoothstep(0.02, 0.18, elev).mul(oneMinus(smoothstep(0.3, U.hoehe, elev)));
  const rays = fbm(vec3(dir.x.mul(7.0), t.mul(0.1), dir.z.mul(7.0)));
  const curt = fbm(vec3(dir.x.mul(3.0), elev.mul(2.5).sub(t.mul(0.12)), dir.z.mul(3.0)));
  const rayI = pow(smoothstep(0.35, 0.85, rays), 2.0).mul(2.4);
  const A = rayI
    .mul(hb)
    .mul(nn)
    .mul(smoothstep(0.25, 0.75, curt).mul(1.5).add(0.3))
    .mul(U.intensity);
  const aurCol = mix(U.colLow, U.colHigh, smoothstep(0.05, 0.75, elev));
  base.addAssign(aurCol.mul(A));

  // South: faint red SAR arc.
  const ss = smoothstep(0.15, 0.75, nXZ.negate());
  const sband = smoothstep(0.03, 0.15, elev).mul(oneMinus(smoothstep(0.18, 0.5, elev)));
  const sdrift = fbm(vec3(dir.x.mul(4.0), t.mul(0.05), dir.z.mul(4.0)))
    .mul(0.8)
    .add(0.2);
  base.addAssign(
    vec3(0.8, 0.1, 0.25).mul(ss).mul(sband).mul(sdrift).mul(0.5).mul(U.sar).mul(U.intensity),
  );

  // Horizon shimmer.
  base.addAssign(
    vec3(0.5, 0.6, 0.8)
      .mul(oneMinus(smoothstep(0.0, 0.18, abs(elev))))
      .mul(0.25),
  );
  return base;
});

// ── mode 2: field-line dome ──
const fieldlineSky = Fn(([dir]: [Vec3Node]) => {
  const U = modeU.lines;
  const t = uSkyTime.mul(globalU.speed).mul(U.speed);
  const { elev } = dirBits(dir);

  const base = mix(
    vec3(0.05, 0.06, 0.16),
    vec3(0.01, 0.01, 0.06),
    smoothstep(0.0, 0.7, elev),
  ).toVar();
  base.addAssign(
    vec3(
      stars(dir, t)
        .mul(0.7)
        .mul(smoothstep(0.02, 0.2, elev)),
    ),
  );

  // Realistic dipole field lines: a magnetic dipole has NO azimuthal component,
  // so its field lines lie entirely in meridian planes around the field axis and
  // all converge on the two magnetic poles. We draw them as lines of constant
  // azimuth φ around the axis — curved arcs on the dome that crowd together at the
  // poles — faded to a glow right at each pole (× sinθ) where φ collapses to a point.
  const frame = axisFrame();
  const cosT = clamp(dot(dir, frame.A), -1.0, 1.0);
  const theta = acos(cosT); // colatitude: 0 at the north pole, π at the south pole
  const phi = atan(dot(dir, frame.e2), dot(dir, frame.e1)); // azimuth around the axis
  // Wobble follows the line along its meridian (fades at the poles) so the arcs
  // ripple like iron filings without tearing at the seam.
  const wob = fbm(dir.mul(2.5)).sub(0.5).mul(U.wobble).mul(0.4).mul(sin(theta));
  const merid = abs(sin(phi.mul(U.freq.mul(0.5)).add(wob)));
  const lines = pow(oneMinus(merid), 24.0).mul(sin(theta));

  // Energy pulses travel along the arcs (by colatitude θ) toward the north pole.
  const dash = pow(fract(theta.mul(U.dashFreq).add(t.mul(0.45))), 6.0);
  const vis = smoothstep(-0.05, 0.1, elev);
  base.addAssign(U.colLine.mul(lines).mul(dash.mul(2.2).mul(U.pulse).add(0.25)).mul(vis));

  // Pole points: north glaring, south as counter-pole (mirrored horizontally).
  const An = axisDir();
  const As = vec3(An.x.negate(), An.y, An.z.negate());
  base.addAssign(
    U.colPoleN
      .mul(pow(max(dot(dir, An), 0.0), 200.0))
      .mul(2.2)
      .mul(U.pole),
  );
  base.addAssign(
    U.colPoleS
      .mul(pow(max(dot(dir, As), 0.0), 120.0))
      .mul(1.4)
      .mul(U.pole),
  );

  // Rings pulsing outward around the north pole.
  const angN = acos(clamp(dot(dir, An), -1.0, 1.0));
  const ring = pow(abs(sin(angN.mul(U.ringFreq).sub(t.mul(0.8)))), 30.0).mul(exp(angN.mul(-2.4)));
  base.addAssign(vec3(0.2, 0.7, 1.0).mul(ring).mul(0.5).mul(U.pole));
  return base;
});

// ── mode 3: bird view (radical pair) ──
const birdSky = Fn(([dir]: [Vec3Node]) => {
  const U = modeU.bird;
  const t = uSkyTime.mul(globalU.speed).mul(U.speed);
  const { elev } = dirBits(dir);

  const base = mix(
    vec3(0.98, 0.98, 1.0),
    vec3(0.55, 0.68, 0.92),
    smoothstep(0.0, 0.75, elev),
  ).toVar();

  const Axis = axisDir();
  const al = dot(dir, Axis);

  // Noise drift: direction in degrees (0 = north, 90 = east), tempo + vertical part.
  const dRad = U.driftRicht.mul(DEG);
  const drift = vec3(sin(dRad), U.driftVertikal, cos(dRad).negate()).mul(t.mul(U.driftTempo));

  // Anisotropy: stretch/squash noise along the field axis.
  const pAniso = dir.add(Axis.mul(dot(dir, Axis)).mul(U.stretch.sub(1.0)));

  // Grainy radical-pair pattern, breathing slowly.
  const breathe = sin(t.mul(0.5)).mul(0.04).mul(U.breathe);
  const blob = smoothstep(U.blobSchwelle, U.blobSchwelle.add(0.46), al.add(breathe));
  const grain = fbm(pAniso.mul(U.grain).add(drift));
  const patt = blob.mul(smoothstep(0.34, 0.66, grain));
  base.assign(mix(base, U.colMuster, patt.mul(U.contrast)));

  // Iridescent ring (interference).
  const ringM = smoothstep(0.18, 0.4, al).mul(oneMinus(smoothstep(0.52, 0.78, al)));
  const ph = al.mul(34.0).sub(t.mul(1.2));
  const irid = vec3(
    sin(ph).mul(0.5).add(0.5),
    sin(ph.add(2.09)).mul(0.5).add(0.5),
    sin(ph.add(4.18)).mul(0.5).add(0.5),
  );
  base.assign(mix(base, irid, ringM.mul(U.ring)));

  // South: warm counter-spot on the anti-axis.
  const south = smoothstep(0.45, 0.9, al.negate());
  const sGrain = smoothstep(0.3, 0.7, fbm(dir.mul(18.0).sub(vec3(0.0, 0.0, t.mul(0.2)))));
  base.assign(mix(base, U.colSued, south.mul(sGrain).mul(U.sued)));

  // Fade the horizon to white.
  base.assign(mix(base, vec3(0.97, 0.97, 1.0), oneMinus(smoothstep(0.0, 0.1, abs(elev))).mul(0.7)));
  return base;
});

// ── mode 4: compass spectrum ──
const compassSky = Fn(([dir]: [Vec3Node]) => {
  const U = modeU.spectrum;
  const t = uSkyTime.mul(globalU.speed).mul(U.speed);
  const { elev, nXZ, eXZ } = dirBits(dir);

  const c = mix(U.colS, U.colN, smoothstep(-0.9, 0.9, nXZ)).toVar();

  // Bleach east/west to neutral.
  c.assign(mix(c, vec3(0.9, 0.91, 0.95), pow(eXZ, 4.0).mul(U.bleiche)));

  // Darken the zenith for depth.
  c.assign(
    mix(c, c.mul(0.22).add(vec3(0.01, 0.01, 0.06)), smoothstep(0.2, 0.85, elev).mul(U.zenit)),
  );

  const An = axisDir();
  const As = vec3(An.x.negate(), An.y, An.z.negate());

  // Rings: fast outward at the north pole, slow inward at the south pole.
  const angN = acos(clamp(dot(dir, An), -1.0, 1.0));
  const ringsN = pow(
    sin(angN.mul(U.rings).sub(t.mul(2.2)))
      .mul(0.5)
      .add(0.5),
    12.0,
  ).mul(exp(angN.mul(-1.1)));
  const angS = acos(clamp(dot(dir, As), -1.0, 1.0));
  const ringsS = pow(
    sin(angS.mul(U.rings).mul(0.66).add(t.mul(1.4)))
      .mul(0.5)
      .add(0.5),
    10.0,
  ).mul(exp(angS.mul(-1.3)));
  c.addAssign(vec3(0.5, 0.8, 1.5).mul(ringsN).mul(1.6).mul(U.ringStaerke));
  c.addAssign(vec3(1.4, 0.55, 0.25).mul(ringsS).mul(1.1).mul(U.ringStaerke));

  // Pole glow.
  c.addAssign(
    vec3(0.6, 0.8, 1.4)
      .mul(pow(max(dot(dir, An), 0.0), 30.0))
      .mul(1.5)
      .mul(U.pole),
  );
  c.addAssign(
    vec3(1.4, 0.7, 0.3)
      .mul(pow(max(dot(dir, As), 0.0), 30.0))
      .mul(1.2)
      .mul(U.pole),
  );

  // Brighten the horizon.
  c.assign(mix(c, vec3(0.96, 0.94, 0.95), oneMinus(smoothstep(0.0, 0.1, abs(elev))).mul(0.35)));
  return c;
});

// ── mode 5: iron-filings sky ──
const filingsSky = Fn(([dir]: [Vec3Node]) => {
  const U = modeU.filings;
  const t = uSkyTime.mul(globalU.speed).mul(U.speed);
  const { elev, nXZ } = dirBits(dir);

  const base = mix(
    vec3(0.96, 0.96, 0.98),
    vec3(0.62, 0.66, 0.78),
    smoothstep(0.0, 0.8, elev),
  ).toVar();

  // Filaments radial toward the magnetic north pole (like iron filings).
  const { A: An, e1, e2 } = axisFrame();
  const az = atan(dot(dir, e2), dot(dir, e1));
  const angN = acos(clamp(dot(dir, An), -1.0, 1.0));
  const p = vec3(
    sin(az).mul(U.density),
    cos(az).mul(U.density),
    angN.mul(U.streck).sub(t.mul(0.22)),
  );
  const fil = pow(smoothstep(U.schwelle, U.schwelle.add(0.26), fbm(p)), 1.3);
  const side = nXZ.mul(0.5).add(0.5);
  const filCol = mix(U.colS, U.colN, side);
  const strength = abs(nXZ).mul(0.55).add(0.45);
  base.assign(mix(base, filCol, clamp(fil.mul(strength).mul(U.strength), 0.0, 1.0)));

  // Suction glow right at the pole.
  base.addAssign(
    vec3(0.9, 0.95, 1.3)
      .mul(pow(max(dot(dir, An), 0.0), 90.0))
      .mul(U.pole),
  );
  return base;
});

// ── mode 6: moiré interference ──
const moireSky = Fn(([dir]: [Vec3Node]) => {
  const U = modeU.moire;
  const t = uSkyTime.mul(globalU.speed).mul(U.speed);
  const { elev, nXZ } = dirBits(dir);

  // Dusk sky as the stage.
  const base = mix(vec3(0.13, 0.09, 0.22), vec3(0.03, 0.02, 0.09), smoothstep(0.0, 0.7, elev))
    .mul(U.grundhelligkeit)
    .toVar();
  base.addAssign(
    vec3(
      stars(dir, t)
        .mul(0.5)
        .mul(smoothstep(0.05, 0.25, elev)),
    ),
  );

  // Two wave systems around slightly tilted axes.
  const A1 = axisDir();
  const A2 = normalize(A1.add(vec3(0.0, U.versatz, 0.0)));
  const angA = acos(clamp(dot(dir, A1), -1.0, 1.0));
  const angB = acos(clamp(dot(dir, A2), -1.0, 1.0));
  const m = sin(angA.mul(U.freq).sub(t.mul(0.6))).mul(sin(angB.mul(U.freq).add(t.mul(0.4))));
  const mm = pow(m.mul(0.5).add(0.5), 3.0).mul(U.kontrast);

  // North = cool, south = warm.
  const mCol = mix(U.colB, U.colA, smoothstep(-0.8, 0.8, nXZ));
  base.addAssign(mCol.mul(mm));

  // Pole glow as the anchor point.
  base.addAssign(U.colA.mul(pow(max(dot(dir, A1), 0.0), 80.0)).mul(1.2));

  base.addAssign(
    vec3(0.35, 0.25, 0.5)
      .mul(oneMinus(smoothstep(0.0, 0.15, abs(elev))))
      .mul(0.3),
  );
  return base;
});

// ── mode 7: plasma streams ──
const plasmaSky = Fn(([dir]: [Vec3Node]) => {
  const U = modeU.plasma;
  const t = uSkyTime.mul(globalU.speed).mul(U.speed);
  const { elev } = dirBits(dir);

  const base = mix(
    vec3(0.02, 0.06, 0.09),
    vec3(0.005, 0.01, 0.03),
    smoothstep(0.0, 0.7, elev),
  ).toVar();
  base.addAssign(
    vec3(
      stars(dir, t)
        .mul(0.6)
        .mul(smoothstep(0.05, 0.25, elev)),
    ),
  );

  // Streams flow along the field-axis meridians toward the pole.
  const { A: An, e1, e2 } = axisFrame();
  const az = atan(dot(dir, e2), dot(dir, e1));
  const angN = acos(clamp(dot(dir, An), -1.0, 1.0));

  const warp = fbm(dir.mul(3.0).add(vec3(t.mul(0.05))))
    .sub(0.5)
    .mul(U.turbulenz)
    .mul(2.0);
  const v = fbm(
    vec3(
      sin(az).mul(U.dichte),
      cos(az).mul(U.dichte),
      angN.mul(4.0).sub(t.mul(U.fluss).mul(0.6)).add(warp),
    ),
  );
  const streak = pow(smoothstep(0.38, 0.8, v), 1.5);

  // The colour field wanders slowly through the streams.
  const cSel = fbm(dir.mul(2.0).add(vec3(0.0, t.mul(0.06), 0.0)));
  const pCol = mix(U.colA, U.colB, smoothstep(0.3, 0.7, cSel));

  // Brighter toward the pole (funnel effect).
  const funnel = exp(angN.mul(-0.5)).mul(1.1).add(0.25);
  base.addAssign(pCol.mul(streak).mul(funnel).mul(U.hell));

  // Pole eye.
  base.addAssign(
    vec3(1.0)
      .mul(pow(max(dot(dir, An), 0.0), 150.0))
      .mul(1.5),
  );
  return base;
});

// ── mode 8: polarisation (Haidinger's brush) ──
const polarSky = Fn(([dir]: [Vec3Node]) => {
  const U = modeU.polar;
  const t = uSkyTime.mul(globalU.speed).mul(U.speed);
  const { elev } = dirBits(dir);

  const base = mix(
    vec3(0.97, 0.97, 1.0),
    vec3(0.62, 0.72, 0.92),
    smoothstep(0.0, 0.8, elev),
  ).toVar();

  const { A: An, e1, e2 } = axisFrame();
  const az = atan(dot(dir, e2), dot(dir, e1));
  const angN = acos(clamp(dot(dir, An), -1.0, 1.0));
  const rot = U.rotation.mul(DEG).add(t.mul(U.tempo));

  // Double lobes: violet where sin(2az) > 0, yellow where < 0 — around the north point.
  const lobes = sin(az.mul(2.0).add(rot));
  const fallN = exp(angN.div(U.groesse).mul(-1.6));
  const vio = smoothstep(0.0, 0.55, lobes).mul(fallN);
  const yel = smoothstep(0.0, 0.55, lobes.negate()).mul(fallN);
  base.assign(mix(base, U.colA, vio.mul(U.staerke).min(1.0)));
  base.assign(mix(base, U.colB, yel.mul(U.staerke).min(1.0)));

  // Anti-axis (south): mirrored, weaker lobes with swapped colours.
  const angS = acos(clamp(dot(dir, An.negate()), -1.0, 1.0));
  const fallS = exp(angS.div(U.groesse).mul(-1.6));
  base.assign(
    mix(base, U.colB, smoothstep(0.0, 0.55, lobes).mul(fallS).mul(U.staerke).mul(U.sued).min(1.0)),
  );
  base.assign(
    mix(
      base,
      U.colA,
      smoothstep(0.0, 0.55, lobes.negate()).mul(fallS).mul(U.staerke).mul(U.sued).min(1.0),
    ),
  );

  // Fine interference ringlets in the centre.
  const ringlets = pow(abs(sin(angN.mul(40.0).sub(t.mul(0.5)))), 20.0).mul(exp(angN.mul(-3.0)));
  base.addAssign(vec3(1.0, 0.95, 0.8).mul(ringlets).mul(0.5));

  base.assign(mix(base, vec3(0.97, 0.97, 1.0), oneMinus(smoothstep(0.0, 0.1, abs(elev))).mul(0.7)));
  return base;
});

// ── mode 9: bird spectrum ──
// Like the bird view, but the noise covers the WHOLE skybox and condenses axially
// at both magnetic poles (radical-pair style): cool pattern at the north pole,
// warm at the south pole, neutral and quiet in between.
const birdSpectrumSky = Fn(([dir]: [Vec3Node]) => {
  const U = modeU.birdspec;
  const t = uSkyTime.mul(globalU.speed).mul(U.speed);
  const { elev } = dirBits(dir);

  const base = mix(
    vec3(0.98, 0.98, 1.0),
    vec3(0.55, 0.68, 0.92),
    smoothstep(0.0, 0.75, elev),
  ).toVar();

  const Axis = axisDir();
  const al = dot(dir, Axis); // signed: +1 north pole, −1 south pole
  const axial = abs(al); // axial pole proximity (both poles alike)

  // Pole zones: 0 at the "equator" ring, 1 at the poles; breathes slightly.
  const breathe = sin(t.mul(0.5)).mul(0.05).mul(U.breathe);
  const poleZone = pow(clamp(axial.add(breathe), 0.0, 1.0), U.polBreite);

  // Noise drift + anisotropy as in the bird view.
  const dRad = U.driftRicht.mul(DEG);
  const drift = vec3(sin(dRad), U.driftVertikal, cos(dRad).negate()).mul(t.mul(U.driftTempo));
  const pAniso = dir.add(Axis.mul(dot(dir, Axis)).mul(U.stretch.sub(1.0)));

  const g1 = fbm(pAniso.mul(U.grain).add(drift));
  const grain = smoothstep(0.34, 0.66, g1);

  // Intensity: base noise everywhere, amplified at the poles.
  const inten = clamp(U.grund.add(poleZone.mul(U.polV)), 0.0, 1.2);
  const patt = grain.mul(inten).mul(U.contrast);

  // Colour: neutral at the equator, cool at the north, warm at the south pole.
  const colPole = mix(U.colS, U.colN, smoothstep(-0.6, 0.6, al));
  const colGrain = mix(vec3(0.45, 0.47, 0.55), colPole, smoothstep(0.15, 0.75, axial));
  base.assign(mix(base, colGrain, clamp(patt, 0.0, 1.0)));

  // Iridescent shimmer, only in the pole zones.
  const ph = g1.mul(25.0).sub(t.mul(1.4));
  const irid = vec3(
    sin(ph).mul(0.5).add(0.5),
    sin(ph.add(2.09)).mul(0.5).add(0.5),
    sin(ph.add(4.18)).mul(0.5).add(0.5),
  );
  base.addAssign(irid.mul(grain).mul(poleZone).mul(U.schimmer).mul(0.6));

  // Fade the horizon to white.
  base.assign(mix(base, vec3(0.97, 0.97, 1.0), oneMinus(smoothstep(0.0, 0.1, abs(elev))).mul(0.6)));
  return base;
});

// ── combined material ──

/**
 * The dome material: all nine modes mixed via their weight uniforms, faded as a
 * whole through {@link uVisibility}. View direction comes from the fragment's
 * world position relative to the dome centre (the dome follows the player).
 */
export function createSkyMaterial(): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  mat.transparent = true;
  mat.fog = false;
  const dir = normalize(positionWorld.sub(cameraPos));
  mat.colorNode = auroraSky(dir)
    .mul(weights.aurora)
    .add(fieldlineSky(dir).mul(weights.lines))
    .add(birdSky(dir).mul(weights.bird))
    .add(compassSky(dir).mul(weights.spectrum))
    .add(filingsSky(dir).mul(weights.filings))
    .add(moireSky(dir).mul(weights.moire))
    .add(plasmaSky(dir).mul(weights.plasma))
    .add(polarSky(dir).mul(weights.polar))
    .add(birdSpectrumSky(dir).mul(weights.birdspec));
  mat.opacityNode = uVisibility;
  return mat;
}

/** Display metadata per mode (name + one-liner, from the prototype). */
export const MODES: readonly { key: ModeKey; name: string; desc: string }[] = [
  {
    key: "aurora",
    name: "1 · Aurora-Kompass",
    desc: "Polarlicht-Vorhänge tanzen nur am Nordhimmel — nach Süden bleibt ein blasser roter SAR-Bogen unter Sternen.",
  },
  {
    key: "lines",
    name: "2 · Feldlinien-Dom",
    desc: "Leuchtende Feldlinien spannen sich von Süd nach Nord; Energiepulse wandern zum grellen Nordpol-Punkt.",
  },
  {
    key: "bird",
    name: "3 · Vogelblick",
    desc: "Radikalpaar-Sehen wie bei Zugvögeln: körniges Interferenzmuster verdichtet sich beim Blick nach Norden.",
  },
  {
    key: "spectrum",
    name: "4 · Kompass-Spektrum",
    desc: "Der Himmel als Farbkompass: kaltes Blau im Norden, glühendes Orange im Süden, pulsierende Ringe um beide Pole.",
  },
  {
    key: "filings",
    name: "5 · Eisenspäne-Himmel",
    desc: "Filamente laufen radial auf den Nordpol zu — stahlblau nach Norden, rostrot nach Süden.",
  },
  {
    key: "moire",
    name: "6 · Moiré-Interferenz",
    desc: "Zwei gegeneinander gekippte Wellensysteme überlagern sich zu wandernden Schwebungsmustern.",
  },
  {
    key: "plasma",
    name: "7 · Plasma-Strom",
    desc: "Leuchtende Plasmaströme fließen entlang der Feldmeridiane und bündeln sich am Nordpol.",
  },
  {
    key: "polar",
    name: "8 · Polarisation",
    desc: "Haidinger-Büschel: violett-gelbe Doppellappen rotieren um den magnetischen Nordpunkt.",
  },
  {
    key: "birdspec",
    name: "9 · Vogelspektrum",
    desc: "Radikalpaar-Rauschen über dem ganzen Himmel, verdichtet an beiden magnetischen Polen.",
  },
];
