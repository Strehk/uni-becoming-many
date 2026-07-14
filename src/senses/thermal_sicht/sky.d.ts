import type { Color, Scene } from "three/webgpu";

export interface ThermalSky {
  update(dt: number): void;
  dispose(): void;
}

export function createThermalSky(scene: Scene, atmosphereColor: Color): ThermalSky;
