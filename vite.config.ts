import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
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
