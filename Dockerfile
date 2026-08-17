# syntax=docker/dockerfile:1

# ── Build ────────────────────────────────────────────────────────────────────
# Bun, because the repo pins its dependency graph in bun.lock. The build itself
# is `tsc && vite build` (see package.json); vite-plugin-mkcert is `apply:"serve"`
# and therefore never touches the production build.
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# public/ ships ~13 MB of .glb/.mp3 that vite copies into dist/ verbatim.
COPY . .
RUN bun run build

# ── Runtime ──────────────────────────────────────────────────────────────────
# Bun rather than nginx: this image now also runs the M5 bridge (bridge/serve.ts),
# which serves the built files *and* owns the two WebSocket endpoints. Bun runs the
# TypeScript sources directly, so there is no second build step for the server half.
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# `ws` is the only runtime dependency the bridge needs; everything else in the
# graph is build-time only.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=build /app/dist ./dist
COPY bridge ./bridge
COPY src/m5 ./src/m5

# Calibration, axis map and the pairing token live here. Mount a volume on it, or a
# redeploy loses the rig's calibration and the controller's configured token.
ENV M5_STATE_DIR=/data
ENV PORT=8080
ENV M5_DEVICE_PORT=5184
VOLUME /data

# 8080: the experience + the browser control stream (TLS terminated by the proxy in
# front). 5184: the plain-ws endpoint the M5 dials — its firmware cannot do wss://,
# so this port must be reachable from the controller's LAN.
EXPOSE 8080 5184

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["bun", "bridge/serve.ts"]
