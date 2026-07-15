---
name: verify
description: Build, launch and drive Becoming Many (WebGPU three.js world) to verify changes at the running app.
---

# Verify — Becoming Many

## Launch

```bash
bun run dev          # vite --host, HTTPS. Picks the next free port (5173/5174/5175…)
                     # — read the actual URL from the vite banner.
```

## Drive (headless Chromium with WebGPU)

Playwright browsers are cached at `~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/...`; `playwright-core` is a devDependency. A working driver lives at `scripts/verify-nature.ts` — copy its pattern:

- Launch args: `--enable-unsafe-webgpu --use-angle=metal`, `ignoreHTTPSErrors: true` (dev server is HTTPS with a self-signed cert). Check the actual `chromium-*` cache dir before hardcoding the executablePath version.
- Click **"Experience starten"** on the start menu, wait ~2 s, then press **Enter** (start gate: "Enter drücken … um zu beginnen"), then wait ~6 s for renderer init + chunk streaming + flora GLBs.
- **Senses** (world is a white void until one is active): there are NO digit-key shortcuts — senses are Theatre-timeline-driven. Drive the dev-console Sinne panel instead; its DOM exists even with the drawer closed, so use `page.evaluate` with plain `.click()`: click the "Manuell" button (flips `senseAuthority` so the timeline stops overwriting), then the sense card's "Solo" button (`details.sc-card` containing e.g. "Infrarot"). Param sliders (`.sc-row` with `.sc-label` text like "Sichtweite") apply on an `input` event — useful to widen a sense's perception bubble beyond its authored range.
- **Flight** is auto-forward (glider): W/S pitch up/down, A/D turn. To inspect ground cover, dive with S ~1 s and shoot fast; the glider recovers altitude.
- Capture `page.on("console")` — regressions show as `[life]`/shader errors. Pre-existing noise to ignore: ICAROS websocket refusals, `[audio] failed to load` placeholders, `[WFC] contradiction` warnings, Tone.js suspended-AudioContext spam.

## Gotchas

- No X/display tricks needed on this Mac; headless WebGPU works via Metal.
- Ports 5173/5174 are often taken by other running dev servers — never assume the default port.
- Flora only renders with an active sense; screenshots without one show the white void.
