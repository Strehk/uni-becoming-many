/// <reference types="vite/client" />

// Typed client env vars (see src/main.ts). Declaring `VITE_ICAROS_HOST` as a real property
// — rather than reading it off vite/client's `[key: string]: any` index signature — keeps
// dot access allowed under `noPropertyAccessFromIndexSignature` and gives it a real type.
interface ImportMetaEnv {
  /** Default ICAROS host origin, baked in by `bun start <ip>` (scripts/start.ts). */
  readonly VITE_ICAROS_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
