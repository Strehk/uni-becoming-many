import {
  abs,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  length,
  max,
  min,
  mix,
  oneMinus,
  positionView,
  pow,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { cameraPos } from "../../render/camera-pos.ts";
import type { ShaderSense } from "../shader/sense-types.ts";
import type { SenseSurface } from "../shader/surface.ts";
import { colorUniform, scalarUniform } from "../shader/uniforms.ts";

const PALETTE_STEP = 1 / 7;

const REFERENCE = {
  c0: "#000000",
  c1: "#6516a8",
  c2: "#061c5c",
  c3: "#00c8c8",
  c4: "#20d75a",
  c5: "#ffe000",
  c6: "#ff2600",
  c7: "#ffffff",
};

const IRON = {
  c0: "#000000",
  c1: "#3d0b66",
  c2: "#03143d",
  c3: "#087f8c",
  c4: "#189c43",
  c5: "#f6c90e",
  c6: "#d72600",
  c7: "#ffffff",
};

type ColorNode = Node<"vec3"> | Node<"color">;

function paletteColor(t: Node<"float">, colors: readonly ColorNode[]): Node<"vec3"> {
  const first = colors[0];
  if (!first) {
    return vec3(0);
  }
  let color: Node<"vec3"> | Node<"color"> = first;
  for (let index = 1; index < colors.length; index++) {
    const next = colors[index];
    if (next) {
      color = mix(color, next, smoothstep((index - 1) * PALETTE_STEP, index * PALETTE_STEP, t));
    }
  }
  return color.rgb;
}

/** Project an object's stable world-space centre and radius through the current eye.
 * cameraViewMatrix/cameraProjectionMatrix are multiview-aware in three r185, so the
 * radial gradient is evaluated independently for both WebXR eyes. */
function projectedCenterWarmth(surface: SenseSurface, falloff: Node<"float">): Node<"float"> {
  const centerView = cameraViewMatrix.mul(vec4(surface.thermalCenter, 1));
  const centerClip = cameraProjectionMatrix.mul(centerView);
  const centerNdc = centerClip.xy.div(centerClip.w);
  const radius = max(surface.thermalRadius, 0.001);

  const xClip = cameraProjectionMatrix.mul(centerView.add(vec4(radius, 0, 0, 0)));
  const yClip = cameraProjectionMatrix.mul(centerView.add(vec4(0, radius, 0, 0)));
  const radiusNdc = vec2(
    max(abs(xClip.x.div(xClip.w).sub(centerNdc.x)), 0.0001),
    max(abs(yClip.y.div(yClip.w).sub(centerNdc.y)), 0.0001),
  );
  const fragmentClip = cameraProjectionMatrix.mul(vec4(positionView, 1));
  const fragmentNdc = fragmentClip.xy.div(fragmentClip.w);
  const offset = fragmentNdc.sub(centerNdc);
  const radialDistance = length(vec2(offset.x.div(radiusNdc.x), offset.y.div(radiusNdc.y)));
  const radial = oneMinus(clamp(radialDistance, 0, 1));
  return pow(radial, max(falloff, 0.01));
}

export function createThermalSicht(): ShaderSense {
  const thresholdCold = scalarUniform(0.08);
  const thresholdWarm = scalarUniform(0.88);
  const gamma = scalarUniform(0.9);
  const saturation = scalarUniform(1.2);
  const environmentBrightness = scalarUniform(0.72);
  const birdHeat = scalarUniform(0.98);
  const birdGlow = scalarUniform(0.9);
  const animalVariation = scalarUniform(0.03);
  const treeHeat = scalarUniform(0.42);
  const treeGlow = scalarUniform(0.14);
  const natureVariation = scalarUniform(0.025);
  const distanceCooling = scalarUniform(0.05);
  const groundHeat = scalarUniform(0.2);
  const grassHeat = scalarUniform(0.3);
  const waterHeat = scalarUniform(0.03);
  const centerWarmth = scalarUniform(1);
  const centerFalloff = scalarUniform(1.6);
  const bloom = scalarUniform(0.25);
  const c0 = colorUniform(REFERENCE.c0);
  const c1 = colorUniform(REFERENCE.c1);
  const c2 = colorUniform(REFERENCE.c2);
  const c3 = colorUniform(REFERENCE.c3);
  const c4 = colorUniform(REFERENCE.c4);
  const c5 = colorUniform(REFERENCE.c5);
  const c6 = colorUniform(REFERENCE.c6);
  const c7 = colorUniform(REFERENCE.c7);
  const range = scalarUniform(70);

  return {
    key: "infrarot",
    label: "Infrarot · Thermalsicht",
    description:
      "False-Color-Thermalsicht mit stabiler Objektwärme, radial wärmeren Körperzentren und leichter Distanzabkühlung für lebende Organismen.",
    enabled: scalarUniform(0),
    opacity: scalarUniform(1),
    range,
    rangeSoft: scalarUniform(80),
    blendMode: "normal",
    params: {
      thresholdCold,
      thresholdWarm,
      gamma,
      saturation,
      environmentBrightness,
      birdHeat,
      birdGlow,
      animalVariation,
      treeHeat,
      treeGlow,
      natureVariation,
      distanceCooling,
      groundHeat,
      grassHeat,
      waterHeat,
      centerWarmth,
      centerFalloff,
      bloom,
      c0,
      c1,
      c2,
      c3,
      c4,
      c5,
      c6,
      c7,
    },
    ui: [
      {
        key: "thresholdCold",
        label: "Farbschwelle kalt",
        type: "range",
        min: 0,
        max: 0.8,
        step: 0.01,
      },
      {
        key: "thresholdWarm",
        label: "Farbschwelle warm",
        type: "range",
        min: 0.2,
        max: 1,
        step: 0.01,
      },
      { key: "gamma", label: "Kontrast / Gamma", type: "range", min: 0.2, max: 3, step: 0.05 },
      { key: "saturation", label: "Sättigung", type: "range", min: 0, max: 2, step: 0.05 },
      {
        key: "environmentBrightness",
        label: "Umgebungshelligkeit",
        type: "range",
        min: 0,
        max: 1.5,
        step: 0.05,
      },
      { key: "birdHeat", label: "Vögel · Wärme", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "birdGlow", label: "Vögel · Leuchtstärke", type: "range", min: 0, max: 3, step: 0.05 },
      {
        key: "animalVariation",
        label: "Tiervariation",
        type: "range",
        min: 0,
        max: 0.2,
        step: 0.005,
        digits: 3,
      },
      { key: "treeHeat", label: "Bäume · Wärme", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "treeGlow", label: "Bäume · Leuchtstärke", type: "range", min: 0, max: 2, step: 0.05 },
      {
        key: "natureVariation",
        label: "Naturvariation",
        type: "range",
        min: 0,
        max: 0.2,
        step: 0.005,
        digits: 3,
      },
      {
        key: "distanceCooling",
        label: "Distanzabkühlung",
        type: "range",
        min: 0,
        max: 0.3,
        step: 0.005,
        digits: 3,
      },
      { key: "groundHeat", label: "Boden · Wärme", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "grassHeat", label: "Gras · Wärme", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "waterHeat", label: "Wasser · Wärme", type: "range", min: 0, max: 1, step: 0.01 },
      {
        key: "centerWarmth",
        label: "Objektzentrum · Farbstufen",
        type: "range",
        min: 0,
        max: 2,
        step: 0.1,
      },
      {
        key: "centerFalloff",
        label: "Objektzentrum · Randbreite",
        type: "range",
        min: 0.2,
        max: 5,
        step: 0.1,
      },
      { key: "bloom", label: "Shader-Bloom", type: "range", min: 0, max: 2, step: 0.05 },
      {
        label: "Palette",
        type: "presets",
        options: [
          { label: "Referenz", values: REFERENCE },
          { label: "Iron", values: IRON },
        ],
      },
      { key: "c0", label: "Farbe 1 · Schwarz", type: "color" },
      { key: "c1", label: "Farbe 2 · Lila", type: "color" },
      { key: "c2", label: "Farbe 3 · Dunkelblau", type: "color" },
      { key: "c3", label: "Farbe 4 · Türkis", type: "color" },
      { key: "c4", label: "Farbe 5 · Grün", type: "color" },
      { key: "c5", label: "Farbe 6 · Gelb", type: "color" },
      { key: "c6", label: "Farbe 7 · Rot", type: "color" },
      { key: "c7", label: "Farbe 8 · Weiß", type: "color" },
    ],

    build(surface) {
      const bird = clamp(surface.thermalBird, 0, 1);
      const tree = clamp(surface.thermalTree, 0, 1);
      const grass = clamp(surface.thermalGrass, 0, 1);
      const water = clamp(surface.thermalWater, 0, 1);
      const explicitGround = clamp(surface.thermalGround, 0, 1);
      const classified = clamp(bird.add(tree).add(grass).add(water).add(explicitGround), 0, 1);
      const ground = max(explicitGround, oneMinus(classified));
      const weight = max(bird.add(tree).add(grass).add(water).add(ground), 1);
      const baseHeat = bird
        .mul(birdHeat)
        .add(tree.mul(treeHeat))
        .add(grass.mul(grassHeat))
        .add(water.mul(waterHeat))
        .add(ground.mul(groundHeat))
        .div(weight);

      const animalShift = surface.thermalObjectVariation.mul(animalVariation).mul(bird);
      const natureMembership = clamp(tree.add(grass), 0, 1);
      const natureShift = surface.thermalObjectVariation.mul(natureVariation).mul(natureMembership);
      const rawHeat = baseHeat.add(animalShift).add(natureShift);
      const warmThreshold = max(thresholdWarm, thresholdCold.add(0.001));
      const mapped = pow(
        clamp(smoothstep(thresholdCold, warmThreshold, rawHeat), 0, 1),
        max(gamma, 0.001),
      );

      const objectMask = clamp(bird.add(tree), 0, 1);
      const radial = projectedCenterWarmth(surface, centerFalloff);
      const paletteStep = clamp(centerWarmth.mul(PALETTE_STEP), 0, 1);
      const edgeT = min(mapped, oneMinus(paletteStep));
      const objectT = edgeT.add(radial.mul(paletteStep));
      const centeredPosition = mix(mapped, objectT, objectMask);

      const living = clamp(bird.add(tree).add(grass), 0, 1);
      const objectDistance = cameraPos.distance(surface.thermalCenter);
      const cooling = smoothstep(range.mul(0.15), max(range, 0.001), objectDistance)
        .mul(distanceCooling)
        .mul(living);
      const palettePosition = clamp(centeredPosition.sub(cooling), 0, 1);

      const palette = paletteColor(palettePosition, [c0, c1, c2, c3, c4, c5, c6, c7]);
      const luma = dot(palette, vec3(0.299, 0.587, 0.114));
      const saturated = mix(vec3(luma), palette, saturation);
      const coldBandWidth = max(warmThreshold.sub(thresholdCold).mul(PALETTE_STEP), 0.001);
      const coldVisibility = smoothstep(thresholdCold, thresholdCold.add(coldBandWidth), rawHeat);
      const hotGlow = pow(palettePosition, 3).mul(coldVisibility);
      const categoryGlow = bird.mul(birdGlow).add(tree.mul(treeGlow));
      const gain = float(1).add(hotGlow.mul(bloom.add(categoryGlow)));
      return max(saturated, 0).mul(environmentBrightness).mul(gain).mul(coldVisibility);
    },
  };
}
