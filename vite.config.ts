import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

// The config runs in Node; @types/node is not a dependency of this project, so the
// one variable the CI build sets is declared locally instead.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  // Deployment base. GitHub Pages serves the fork from a project sub-path, so the
  // CI build passes BASE_PATH=/becoming-many-prototyp-alpha/; dev and any root
  // deployment stay on "/". Everything under public/ goes through `asset()`
  // (src/asset-url.ts) so both resolve — never hard-code a leading "/" URL.
  base: process.env["BASE_PATH"] ?? "/",
  // HTTPS by default in dev via locally-trusted mkcert certificates.
  plugins: [mkcert()],
  server: {
    https: true,
  },
  // WebGPU already requires a modern browser; target esnext so top-level await
  // (used in src/main.ts to await the async WebGPU init) survives the build.
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        // The experience itself + the vendored synth (loaded as an iframe overlay
        // in-app, or opened directly on a phone — see docs/MASTERPLAN.md §3G).
        main: "index.html",
        synth: "synth.html",
      },
    },
  },
});
