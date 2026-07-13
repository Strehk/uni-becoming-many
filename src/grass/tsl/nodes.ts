// ── Becoming Many — Grass TSL Node Type Aliases ────────────────
//
// The typed-node aliases the grass TSL helpers annotate their params with, so the
// port stays clean under the repo's `noExplicitAny` gate. Fluent node methods
// (`.mul`, `.add`, `.shiftRight`, …) live on these generic `Node<...>` types, not on
// the bare `Node` — see the terrain/senses code and the port memory.

import type { Node } from "three/webgpu";

export type FloatNode = Node<"float">;
export type IntNode = Node<"int">;
export type UintNode = Node<"uint">;
export type Vec2Node = Node<"vec2">;
export type Vec3Node = Node<"vec3">;
export type Vec4Node = Node<"vec4">;
