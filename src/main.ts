import { createRenderer } from "./renderer/index.ts";
import { createSenses } from "./senses/index.ts";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app mount point not found");
}

// `createRenderer` is async — WebGPU must finish `init()` before the first frame.
const renderer = await createRenderer();
app.append(renderer.canvas);
document.body.append(renderer.vrButton); // "Enter VR" overlay
renderer.start();

createSenses(renderer.canvas);
