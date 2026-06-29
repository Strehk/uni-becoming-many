import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  // HTTPS by default in dev via locally-trusted mkcert certificates.
  plugins: [mkcert()],
  server: {
    https: true,
  },
});
