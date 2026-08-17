/**
 * Static file serving for the production container — the part that used to be nginx.
 *
 * The rules here are a direct port of `docker/nginx.conf` and each one earns its place:
 *
 *   · `.glb` needs an explicit MIME type; the stock table predates glTF and would hand three.js
 *     `application/octet-stream`.
 *   · `/assets/` is Vite's hashed output, so it is immutable for a year.
 *   · The unhashed payloads copied from `public/` (~13 MB of .glb and .mp3) get a day of cache
 *     with revalidation — long enough to survive a reload, short enough to redeploy.
 *   · Everything else is `no-cache`, and there is deliberately **no SPA fallback**: this app has
 *     three real entry points and a typo'd path should 404 rather than silently boot the world.
 *   · Compression covers text only. `.glb` and `.mp3` are already-compressed containers, so
 *     gzipping them just burns CPU.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createGzip } from "node:zlib";

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  // Without these three, three.js' loaders get application/octet-stream.
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
};

/** Only these compress well enough to be worth the CPU. */
const COMPRESSIBLE = new Set([
  "text/html; charset=utf-8",
  "text/javascript; charset=utf-8",
  "text/css; charset=utf-8",
  "application/json; charset=utf-8",
  "image/svg+xml",
  "model/gltf+json",
  "text/plain; charset=utf-8",
]);

const COMPRESS_MIN_BYTES = 1024;

/** Unhashed assets copied verbatim from `public/`. */
const REVALIDATED_EXTENSIONS = new Set([
  ".glb",
  ".gltf",
  ".mp3",
  ".ogg",
  ".wav",
  ".ttf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

export type StaticHandler = (request: IncomingMessage, response: ServerResponse) => void;

export function createStaticHandler(rootDir: string): StaticHandler {
  const root = resolve(rootDir);

  return (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "text/plain; charset=utf-8", "Method not allowed\n");
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (pathname === "/healthz") {
      send(response, 200, "text/plain; charset=utf-8", "ok\n");
      return;
    }

    const filePath = resolveFile(root, pathname);
    if (filePath === null) {
      send(response, 404, "text/plain; charset=utf-8", "Not found\n");
      return;
    }

    const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    response.setHeader("content-type", contentType);
    response.setHeader("cache-control", readCacheControl(pathname, filePath));

    if (request.method === "HEAD") {
      response.writeHead(200);
      response.end();
      return;
    }

    const size = statSync(filePath).size;
    const acceptsGzip = String(request.headers["accept-encoding"] ?? "").includes("gzip");
    const compress = acceptsGzip && size >= COMPRESS_MIN_BYTES && COMPRESSIBLE.has(contentType);

    if (compress) {
      response.setHeader("content-encoding", "gzip");
      response.setHeader("vary", "accept-encoding");
      response.writeHead(200);
      createReadStream(filePath).pipe(createGzip()).pipe(response);
      return;
    }

    // A known length lets the browser show real progress on the multi-megabyte payloads.
    response.setHeader("content-length", String(size));
    response.writeHead(200);
    createReadStream(filePath).pipe(response);
  };
}

/**
 * Map a URL path onto a file inside `root`, or null if there is none. Directory paths resolve to
 * their `index.html`, matching nginx's `index` directive.
 */
function resolveFile(root: string, pathname: string): string | null {
  const decoded = safeDecode(pathname);
  if (decoded === null) {
    return null;
  }

  // `normalize` collapses `..` segments; the prefix check then rejects anything that still
  // climbed out of the root (an absolute or oddly-encoded path).
  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const index = join(candidate, "index.html");
    return existsSync(index) ? index : null;
  }
  return existsSync(candidate) ? candidate : null;
}

function readCacheControl(pathname: string, filePath: string): string {
  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  if (REVALIDATED_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return "public, max-age=86400, must-revalidate";
  }
  return "no-cache";
}

function safeDecode(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}
