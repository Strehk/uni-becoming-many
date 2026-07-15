import { Color } from "three/webgpu";
import { signals } from "../../signals/index.ts";

const TARGET_COLOR = new Color(0x030817);
const MIX_STRENGTH = 0.95;
const FADE_SPEED = 5;

/** Mix the current atmosphere background toward a cold thermal sky without
 * replacing sky domes, dust, grain, or any other scene effect. */
export function createThermalSky(scene, atmosphereColor) {
  const displayColor = new Color().copy(atmosphereColor);
  let fade = 0;
  scene.background = displayColor;

  return {
    update(dt) {
      const target = Math.min(1, Math.max(0, signals.sense.infrarot.peek()));
      const eased = 1 - Math.exp(-Math.max(0, dt) * FADE_SPEED);
      fade += (target - fade) * eased;
      displayColor.copy(atmosphereColor).lerp(TARGET_COLOR, fade * MIX_STRENGTH);
    },
    dispose() {
      if (scene.background === displayColor) {
        scene.background = atmosphereColor;
      }
    },
  };
}
