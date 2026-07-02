#!/usr/bin/env bun
/**
 * Start the becoming-many ICAROS client dev server, pointed at a given host IP.
 *
 * Usage:
 *   bun start 192.168.1.50          -> client connects to https://192.168.1.50:5183
 *   bun start 192.168.1.50:6000     -> ... :6000
 *   bun start https://host.local    -> full origin passed through
 *
 * It normalizes the argument to an https origin, exports it as `VITE_ICAROS_HOST` (read by
 * src/main.ts), and runs `bun run dev` (`vite --host`) so the dev server is reachable from
 * the headset over the LAN. The headset then opens the plain dev URL — no `?host=` needed.
 */

const arg = Bun.argv[2];
if (arg === undefined || arg.startsWith("-")) {
  console.error("Usage: bun start <host-ip>[:port]   e.g.  bun start 192.168.1.50");
  process.exit(1);
}

/** Accept a bare IP/host, `host:port`, or a full origin; normalize to an https origin. */
function toHostOrigin(value: string): string {
  if (value.includes("://")) {
    return value;
  }
  const [host, port] = value.split(":");
  return `https://${host}:${port ?? "5183"}`;
}

const hostOrigin = toHostOrigin(arg);
console.log(`▶ ICAROS host: ${hostOrigin}\n▶ starting dev server (vite --host)…\n`);

const child = Bun.spawn(["bun", "run", "dev"], {
  env: { ...process.env, VITE_ICAROS_HOST: hostOrigin },
  stdio: ["inherit", "inherit", "inherit"],
});

const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

process.exit(await child.exited);
