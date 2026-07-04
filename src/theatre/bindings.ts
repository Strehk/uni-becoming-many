/**
 * Vanilla stand-in for the useful part of `@theatre/r3f`: binding a `THREE.Object3D`'s transform
 * to a Theatre object (docs §4.4). We can't use `@theatre/r3f` (React-only), so instead of
 * in-scene drag gizmos we author position/rotation as keyframable Theatre props and copy them onto
 * the object each frame — the **pull** model, which composes cleanly with a clock-driven sequence
 * and needs no teardown.
 *
 * Usage:
 *   const obj = theatre.camera.object("dolly", transformProps());
 *   // per frame, AFTER theatre.setPosition(clock.now):
 *   applyTransform(mesh, obj.value);
 */
import { types } from "@theatre/core";
import type * as THREE from "three/webgpu";

/** The shape a transform Theatre object exposes on `.value`. */
export interface TransformValue {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

/** Theatre prop shorthand for a keyframable transform. Pass to `sheet.object(key, transformProps())`. */
export function transformProps(): {
  position: ReturnType<typeof types.compound>;
  rotation: ReturnType<typeof types.compound>;
} {
  return {
    position: types.compound({ x: types.number(0), y: types.number(0), z: types.number(0) }),
    rotation: types.compound({ x: types.number(0), y: types.number(0), z: types.number(0) }),
  };
}

/** Copy an authored transform value onto a scene object. Call each frame after `setPosition`. */
export function applyTransform(object: THREE.Object3D, value: TransformValue): void {
  object.position.set(value.position.x, value.position.y, value.position.z);
  object.rotation.set(value.rotation.x, value.rotation.y, value.rotation.z);
}
