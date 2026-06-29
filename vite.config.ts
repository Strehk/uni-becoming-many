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
  },
});
