import { createRenderer } from "./renderer/index.ts";
import { createSenses } from "./senses/index.ts";
import { generateTerrain } from "./terrain-generator/index.ts";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app mount point not found");
}

const renderer = createRenderer();
app.append(renderer.canvas);

const terrain = generateTerrain(96, 96);
renderer.render(terrain);

createSenses(renderer.canvas);
