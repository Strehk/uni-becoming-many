import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";
import { m5Bridge } from "./bridge/vite-plugin.ts";

// The config runs in Node; @types/node is not a dependency of this project, so the
// one variable the CI build sets is declared locally instead.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  // Deployment base. GitHub Pages serves the fork from a project sub-path, so the
  // CI build passes BASE_PATH=/becoming-many-beta/; dev and any root
  // deployment stay on "/". Everything under public/ goes through `asset()`
  // (src/asset-url.ts) so both resolve — never hard-code a leading "/" URL.
  base: process.env["BASE_PATH"] ?? "/",
  // HTTPS by default in dev via locally-trusted mkcert certificates. The plugin turns HTTPS on
  // by itself (it only bails on an explicit `server.https: false`) and then overwrites
  // `server.https` with the generated cert/key — so there is nothing to set here. Vite 6 types
  // `server.https` as `https.ServerOptions`, where the old `https: true` no longer compiles.
  // `m5Bridge` runs the controller bridge inside this dev server: the browser control stream
  // rides the same HTTPS origin as the page (so the headset trusts one certificate, not two),
  // while the M5 gets its own plain-HTTP listener because its firmware refuses `wss://`.
  plugins: [mkcert(), m5Bridge()],
  // WebGPU already requires a modern browser; target esnext so top-level await
  // (used in src/main.ts to await the async WebGPU init) survives the build.
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        // The experience itself + the vendored synth (loaded as an iframe overlay
        // in-app, or opened directly on a phone — see docs/MASTERPLAN.md §3G) +
        // the USB pairing page for the M5 controller.
        main: "index.html",
        synth: "synth.html",
        pair: "pair.html",
      },
    },
  },
});
