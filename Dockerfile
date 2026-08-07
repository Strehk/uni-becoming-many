# syntax=docker/dockerfile:1

# ── Build ────────────────────────────────────────────────────────────────────
# Bun, because the repo pins its dependency graph in bun.lock. The build itself
# is `tsc && vite build` (see package.json); vite-plugin-mkcert is `apply:"serve"`
# and therefore never touches the production build.
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Vite inlines `import.meta.env.*` at build time, so the ICAROS host has to be
# baked in here — the nginx stage serves finished files and can't inject it.
# Same mechanism scripts/start.ts uses in dev: a VITE_-prefixed process env.
# See .env.example; leaving it unset keeps main.ts' https://localhost:5183 default,
# and `?host=…` overrides it per-visit in the browser either way.
ARG VITE_ICAROS_HOST

# public/ ships ~13 MB of .glb/.mp3 that vite copies into dist/ verbatim.
COPY . .

# The `unset` matters: an empty build arg makes vite inline `""`, and main.ts'
# `?? "https://localhost:5183"` does not treat "" as absent — the host would end up
# blank. Unsetting restores `void 0` so the fallback fires. CI passes the arg
# unconditionally from a repo variable that is usually undefined, so this is the
# normal path, not an edge case.
RUN if [ -z "$VITE_ICAROS_HOST" ]; then unset VITE_ICAROS_HOST; fi; \
    bun run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
