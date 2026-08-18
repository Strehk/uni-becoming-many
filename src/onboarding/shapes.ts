// ── Becoming Many — Onboarding shapes ──────────────────────────
//
// The point clouds the guiding motes settle into. Every shape is authored as a set of
// STROKES (segments and arcs) in a normalised local frame — +x right, +y up, z toward the
// viewer — and then sampled into `count` points, distributed by stroke length so a long
// shaft gets as many motes per metre as a short arrow head.
//
// Two deliberate choices keep it in the piece's register rather than turning it into UI:
//   • a little jitter on every point, so the sign reads as *settled dust* rather than a
//     printed glyph, and
//   • sampling ALL motes onto the shape (wrapping around it), so nothing is left parked
//     off to the side where it would read as a second, meaningless cloud.
//
// PURE DATA — no three, no DOM. The particle field (index.ts) owns everything visual.

/** The vocabulary of signs. `none` is the resting cloud — no shape at all. */
export type ShapeId =
  | "none"
  | "arrow-right"
  | "arrow-left"
  | "arrow-up"
  | "arrow-down"
  | "ring"
  | "arc-right"
  | "arc-left";

/** A straight stroke from a to b, in normalised units. */
type Segment = { readonly kind: "line"; ax: number; ay: number; bx: number; by: number };
/** A circular stroke, angles in radians (0 = +x, counter-clockwise). */
type Arc = { readonly kind: "arc"; radius: number; from: number; to: number };
type Stroke = Segment | Arc;

const TAU = Math.PI * 2;

/** An arrow along +x: shaft plus two barbs. Rotated per direction by `rotate`. */
const ARROW: readonly Stroke[] = [
  { kind: "line", ax: -0.85, ay: 0, bx: 0.55, by: 0 },
  { kind: "line", ax: 0.55, ay: 0, bx: 0.1, by: 0.42 },
  { kind: "line", ax: 0.55, ay: 0, bx: 0.1, by: -0.42 },
];

const RING: readonly Stroke[] = [{ kind: "arc", radius: 0.8, from: 0, to: TAU }];

/** A quarter-turn banking hint: a curve that leans off to one side. */
const ARC_RIGHT: readonly Stroke[] = [
  { kind: "arc", radius: 1.1, from: Math.PI * 0.85, to: Math.PI * 1.6 },
];

/** Rotate a stroke set by `angle` (radians, counter-clockwise). */
function rotate(strokes: readonly Stroke[], angle: number): Stroke[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return strokes.map((s) =>
    s.kind === "line"
      ? {
          kind: "line" as const,
          ax: s.ax * cos - s.ay * sin,
          ay: s.ax * sin + s.ay * cos,
          bx: s.bx * cos - s.by * sin,
          by: s.bx * sin + s.by * cos,
        }
      : { kind: "arc" as const, radius: s.radius, from: s.from + angle, to: s.to + angle },
  );
}

function mirrorX(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map((s) =>
    s.kind === "line"
      ? { kind: "line" as const, ax: -s.ax, ay: s.ay, bx: -s.bx, by: s.by }
      : { kind: "arc" as const, radius: s.radius, from: Math.PI - s.from, to: Math.PI - s.to },
  );
}

function strokesFor(id: ShapeId): readonly Stroke[] {
  switch (id) {
    case "arrow-right":
      return ARROW;
    case "arrow-left":
      return rotate(ARROW, Math.PI);
    case "arrow-up":
      return rotate(ARROW, Math.PI * 0.5);
    case "arrow-down":
      return rotate(ARROW, Math.PI * 1.5);
    case "ring":
      return RING;
    case "arc-right":
      return ARC_RIGHT;
    case "arc-left":
      return mirrorX(ARC_RIGHT);
    case "none":
      return [];
  }
}

function strokeLength(s: Stroke): number {
  return s.kind === "line"
    ? Math.hypot(s.bx - s.ax, s.by - s.ay)
    : s.radius * Math.abs(s.to - s.from);
}

/** Point at parameter `t` (0..1) along a stroke. */
function pointAt(s: Stroke, t: number, out: { x: number; y: number }): void {
  if (s.kind === "line") {
    out.x = s.ax + (s.bx - s.ax) * t;
    out.y = s.ay + (s.by - s.ay) * t;
    return;
  }
  const angle = s.from + (s.to - s.from) * t;
  out.x = Math.cos(angle) * s.radius;
  out.y = Math.sin(angle) * s.radius;
}

/**
 * Write `count` points of `id` into `out` (xyz per point, metres) at the given `scale`.
 * `jitter` softens the stroke into settled dust; `depth` gives the sign a little
 * thickness so it does not read as a decal when the view drifts off axis.
 *
 * Returns false for `none` (and leaves `out` untouched) — the caller then simply lets
 * the cloud rest.
 */
export function fillShape(
  id: ShapeId,
  out: Float32Array,
  count: number,
  scale: number,
  jitter = 0.07,
  depth = 0.1,
): boolean {
  const strokes = strokesFor(id);
  if (strokes.length === 0) {
    return false;
  }
  const lengths = strokes.map(strokeLength);
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return false;
  }

  const p = { x: 0, y: 0 };
  let stroke = 0;
  let walked = 0; // length already covered by finished strokes
  for (let i = 0; i < count; i++) {
    // Walk the strokes in order, at even arc length — with a wrap so every mote lands
    // on the shape even when there are more motes than the shape "needs".
    const along = ((i + 0.5) / count) * total;
    while (stroke < strokes.length - 1 && along > walked + (lengths[stroke] ?? 0)) {
      walked += lengths[stroke] ?? 0;
      stroke++;
    }
    const current = strokes[stroke];
    const length = lengths[stroke] ?? 1;
    if (!current) continue;
    pointAt(current, length > 0 ? Math.min(1, (along - walked) / length) : 0, p);

    out[i * 3 + 0] = (p.x + (Math.random() - 0.5) * jitter) * scale;
    out[i * 3 + 1] = (p.y + (Math.random() - 0.5) * jitter) * scale;
    out[i * 3 + 2] = (Math.random() - 0.5) * depth * scale;
  }
  return true;
}
