/**
 * Credits / thank-you screen — the end-of-piece panel, shown in both desktop and VR.
 *
 * A single canvas-textured plane serves both presentations (one code path, per the design):
 *   - **Desktop**: the panel follows the camera each frame — a head-locked billboard held a few
 *     metres ahead at eye level, upright and facing the viewer, so it stays centred and readable
 *     while the flight continues underneath.
 *   - **VR**: the panel is *world-locked*. On the rising edge (the first frame its opacity clears
 *     zero) it snaps into world space a few metres in front of the player's current gaze, facing
 *     them, and then stays fixed — the player can look around it ("fixed in space before the
 *     player"). It re-anchors next time it appears.
 *
 * Visibility + fade are authored on the Theatre timeline (`credits.opacity`, 0..1) and read into
 * {@link Credits.update} each frame — the one authored input. The panel's own alpha (the rounded
 * card shape drawn on a transparent canvas) is multiplied by that master fade, so keyframing the
 * envelope up/down is all it takes to bring the screen in and dismiss it.
 *
 * TSL/WebGPU per AGENT.md: node material from `three/webgpu`, the fade uniform + texture sample
 * from `three/tsl`. No GLSL.
 */
import { texture as textureNode, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

/**
 * The credits content. **Placeholder — edit the title and lines below with the real credits.**
 * A blank string renders as vertical spacing between blocks.
 */
export const CREDITS_CONTENT: { title: string; lines: string[] } = {
  title: "BECOMING MANY",
  lines: [
    "Thank you for playing!",
    "",
    "A Project By",
    "Erasmus Schmidt (KD)",
    "Eddie Huesmann (KD)",
    "Tade Strehk (IKG)",
    "",
    "Made with three.js · WebGPU",
  ],
};

/** Metres the panel sits in front of the viewer. */
const DISTANCE = 3.2;
/** Canvas resolution (high-DPI for crisp text on the plane); the plane keeps this aspect ratio. */
const CANVAS_W = 2048;
const CANVAS_H = 1280;
/** Panel width in world units; height derives from the canvas aspect so the texture never stretches. */
const PANEL_W = 3.4;
const PANEL_H = (PANEL_W * CANVAS_H) / CANVAS_W;

export interface CreditsOptions {
  scene: THREE.Scene;
  /** The presenting camera (VR reads the headset pose through it; desktop reads the rig). */
  camera: THREE.Camera;
  /** The renderer, for the `xr.isPresenting` check that switches world-lock vs billboard. */
  renderer: THREE.WebGPURenderer;
}

export interface Credits {
  /**
   * Drive the panel from the authored opacity (0..1). Hidden at ~0; otherwise faded to `opacity`
   * and positioned per the desktop/VR rules above. Call every frame after the camera pose is current.
   */
  update(opacity: number): void;
  dispose(): void;
}

export function createCredits(options: CreditsOptions): Credits {
  const { scene, camera, renderer } = options;

  const canvasTexture = drawCreditsTexture(CREDITS_CONTENT);

  const uOpacity = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial();
  const sample = textureNode(canvasTexture);
  material.colorNode = sample; // rgb from the drawn card
  material.opacityNode = sample.a.mul(uOpacity); // card shape × authored fade
  material.transparent = true;
  material.depthWrite = false; // translucent overlay — don't occlude via depth
  material.side = THREE.DoubleSide;
  material.toneMapped = false;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), material);
  mesh.name = "credits-panel";
  mesh.frustumCulled = false; // it lives right in front of the camera; never cull it
  mesh.renderOrder = 999; // draw after the world so alpha blends over it
  mesh.visible = false;
  scene.add(mesh);

  // Scratch — reused each frame, never allocated in the hot path.
  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const lastForward = new THREE.Vector3(0, 0, -1);
  const target = new THREE.Vector3();

  /** Place the panel a fixed distance ahead at eye level, upright, facing the viewer. */
  function placeInFront(): void {
    camera.getWorldPosition(camPos);
    camera.getWorldQuaternion(camQuat);
    // Yaw-only forward: flatten the view direction so the panel sits ahead at eye height and stays
    // upright even if the viewer is looking up or down when it appears.
    forward.set(0, 0, -1).applyQuaternion(camQuat);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) {
      forward.copy(lastForward); // looking near-straight up/down: keep the last good heading
    } else {
      forward.normalize();
    }
    lastForward.copy(forward);

    mesh.position.copy(camPos).addScaledVector(forward, DISTANCE);
    mesh.position.y = camPos.y; // eye level
    target.set(camPos.x, mesh.position.y, camPos.z);
    mesh.lookAt(target); // +Z (the plane's face) toward the viewer, kept vertical
  }

  // True once the VR panel has been anchored for the current appearance; reset when it hides.
  let anchored = false;

  function update(opacity: number): void {
    if (opacity <= 0.001) {
      mesh.visible = false;
      uOpacity.value = 0;
      anchored = false;
      return;
    }
    mesh.visible = true;
    uOpacity.value = Math.min(1, opacity);

    if (renderer.xr.isPresenting) {
      // VR: world-lock. Anchor once on the rising edge, then leave it fixed in space.
      if (!anchored) {
        placeInFront();
        anchored = true;
      }
    } else {
      // Desktop: follow the camera every frame (head-locked billboard).
      placeInFront();
      anchored = false;
    }
  }

  function dispose(): void {
    scene.remove(mesh);
    mesh.geometry.dispose();
    material.dispose();
    canvasTexture.dispose();
  }

  return { update, dispose };
}

/** Render the credits content onto a transparent canvas as a rounded card, return it as a texture. */
function drawCreditsTexture(content: { title: string; lines: string[] }): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("[credits] 2D canvas context unavailable");
  }

  // Rounded translucent card, inset from the canvas edge so the plane has a soft margin.
  const margin = 40;
  const radius = 56;
  const x = margin;
  const y = margin;
  const w = CANVAS_W - margin * 2;
  const h = CANVAS_H - margin * 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fillStyle = "rgba(8, 11, 16, 0.78)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontStack = "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif";

  // Title.
  ctx.fillStyle = "#f4f6f8";
  ctx.font = `650 128px ${fontStack}`;
  const titleY = CANVAS_H * 0.24;
  ctx.fillText(content.title, CANVAS_W / 2, titleY);

  // Accent rule under the title.
  ctx.strokeStyle = "#d9f99d";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 160, titleY + 96);
  ctx.lineTo(CANVAS_W / 2 + 160, titleY + 96);
  ctx.stroke();

  // Credit lines, evenly spaced through the lower portion of the card.
  const lineHeight = 66;
  const blockTop = CANVAS_H * 0.42;
  ctx.font = `400 52px ${fontStack}`;
  content.lines.forEach((line, i) => {
    ctx.fillStyle = "#cbd5df";
    ctx.fillText(line, CANVAS_W / 2, blockTop + i * lineHeight);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
