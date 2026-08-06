// ── Becoming Many — Menu theme ───────────────────────────────────
//
// The look the audience-facing screens share, taken from the credits panel
// (src/experience/credits.ts) so the frame around the piece speaks the same
// language as its closing image:
//
//   • **Heavitas**, the credits' display face, loaded from the same public/fonts file.
//   • **Black type with a soft white halo** — the credits' `withHalo` shadow, in CSS.
//   • **The void as the ground.** `#f0f4ff` is the fogColor the world dissolves into
//     when no sense is active (src/senses/index.ts), so the menu is not a panel
//     floating over the world — it *is* the empty world, before anything is sensed.
//
// Opaque on purpose: the settings must be readable without the experience running
// behind them, and on a phone a menu drawn over a live WebGPU frame is the single
// most expensive thing on the screen.

import { asset } from "../asset-url.ts";

const STYLE_ID = "bm-menu-theme";

/** The void colour the world fades to — kept in sync with `fogColor` in senses/index.ts. */
export const VOID_COLOR = "#f0f4ff";

/** Inject the shared menu stylesheet once. Safe to call from every screen. */
export function injectMenuTheme(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const CSS = `
  @font-face {
    font-family: "Heavitas";
    src: url("${asset("fonts/Heavitas.ttf")}") format("truetype");
    font-display: swap;
  }

  .bm-menu {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    justify-items: center;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: clamp(20px, 5vh, 56px) clamp(16px, 5vw, 48px);
    /* The void, with the faintest breath of depth toward the edges. */
    background:
      radial-gradient(120% 90% at 50% 38%, #ffffff 0%, ${VOID_COLOR} 55%, #e2e8f5 100%);
    color: #05070c;
    font-family: "Heavitas", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .bm-menu[hidden] {
    display: none !important;
  }

  /* The credits' white halo behind black glyphs, as a CSS shadow. */
  .bm-menu__title,
  .bm-menu__item,
  .bm-menu__section-title {
    text-shadow: 0 0 18px rgba(255, 255, 255, 0.9), 0 0 42px rgba(255, 255, 255, 0.6);
  }

  .bm-menu__screen {
    grid-row: 2;
    width: min(680px, 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(22px, 4vh, 40px);
  }

  .bm-menu__screen--wide {
    width: min(940px, 100%);
  }

  .bm-menu__head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }

  .bm-menu__title {
    margin: 0;
    font-size: clamp(30px, 8.5vw, 68px);
    line-height: 1.02;
    letter-spacing: clamp(3px, 1.1vw, 9px);
    text-transform: uppercase;
    font-weight: 400;
  }

  .bm-menu__title--small {
    font-size: clamp(22px, 5vw, 38px);
    letter-spacing: clamp(2px, 0.6vw, 5px);
  }

  .bm-menu__lede {
    margin: 0;
    max-width: 46ch;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: clamp(12px, 1.6vw, 14px);
    line-height: 1.6;
    letter-spacing: 0.02em;
    color: rgba(5, 7, 12, 0.62);
  }

  /* ── The game-menu list ── */
  .bm-menu__list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(6px, 1.4vh, 14px);
    width: 100%;
  }

  .bm-menu__item {
    position: relative;
    appearance: none;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: clamp(15px, 2.9vw, 23px);
    letter-spacing: clamp(1.5px, 0.35vw, 3.5px);
    text-transform: uppercase;
    /* Comfortable tap target on a phone, generous rhythm on a wall screen. */
    min-height: 48px;
    padding: 10px 44px;
    cursor: pointer;
    opacity: 0.62;
    transition: opacity 160ms ease, transform 160ms ease, letter-spacing 160ms ease;
  }

  /* The marker that walks down the list, as in a game menu. */
  .bm-menu__item::before {
    content: "";
    position: absolute;
    left: 14px;
    top: 50%;
    width: 14px;
    height: 2px;
    background: currentColor;
    transform: translateY(-50%) scaleX(0);
    transform-origin: left center;
    transition: transform 160ms ease;
  }

  .bm-menu__item:hover,
  .bm-menu__item:focus-visible {
    opacity: 1;
    outline: none;
    transform: translateX(4px);
    letter-spacing: clamp(2px, 0.5vw, 4.5px);
  }

  .bm-menu__item:hover::before,
  .bm-menu__item:focus-visible::before {
    transform: translateY(-50%) scaleX(1);
  }

  .bm-menu__item--primary {
    opacity: 1;
  }

  .bm-menu__item--quiet {
    font-size: clamp(11px, 1.7vw, 13px);
    letter-spacing: 2px;
    opacity: 0.42;
  }

  .bm-menu__item[disabled] {
    opacity: 0.22;
    cursor: default;
    transform: none;
  }

  .bm-menu__item[disabled]::before {
    transform: translateY(-50%) scaleX(0);
  }

  .bm-menu__note {
    margin: 2px 0 0;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
    letter-spacing: 0.01em;
    line-height: 1.5;
    color: rgba(5, 7, 12, 0.55);
    text-align: center;
    min-height: 1.5em;
  }

  /* ── Settings ── */
  .bm-menu__sections {
    display: flex;
    flex-direction: column;
    gap: clamp(20px, 3.5vh, 34px);
    width: 100%;
  }

  .bm-menu__section-title {
    margin: 0 0 12px;
    font-size: clamp(12px, 1.8vw, 14px);
    letter-spacing: 4px;
    text-transform: uppercase;
    text-align: center;
    opacity: 0.5;
  }

  .bm-menu__choices {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .bm-menu__choice {
    appearance: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
    align-items: flex-start;
    text-align: left;
    min-height: 62px;
    padding: 12px 14px;
    border: 1px solid rgba(5, 7, 12, 0.16);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.5);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease;
  }

  .bm-menu__choice:hover,
  .bm-menu__choice:focus-visible {
    outline: none;
    border-color: rgba(5, 7, 12, 0.45);
    background: rgba(255, 255, 255, 0.85);
  }

  .bm-menu__choice[aria-pressed="true"] {
    border-color: #05070c;
    background: #05070c;
    color: ${VOID_COLOR};
  }

  .bm-menu__choice-label {
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .bm-menu__choice-note {
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.45;
    letter-spacing: 0.01em;
    opacity: 0.62;
  }

  /* ── Rows: sliders, switches, small actions ── */
  .bm-menu__rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
  }

  .bm-menu__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    min-height: 44px;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 13px;
    letter-spacing: 0.01em;
  }

  .bm-menu__row input[type="range"] {
    flex: 1;
    max-width: 260px;
    accent-color: #05070c;
    cursor: pointer;
  }

  .bm-menu__row input[type="checkbox"] {
    width: 20px;
    height: 20px;
    accent-color: #05070c;
    cursor: pointer;
  }

  .bm-menu__value {
    min-width: 4ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
  }

  .bm-menu__small {
    appearance: none;
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid rgba(5, 7, 12, 0.28);
    border-radius: 2px;
    background: none;
    color: inherit;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
    letter-spacing: 0.04em;
    cursor: pointer;
  }

  .bm-menu__small:hover {
    border-color: #05070c;
  }

  .bm-menu__status {
    min-height: 20px;
    margin: 0;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
    letter-spacing: 0.02em;
    color: rgba(5, 7, 12, 0.6);
    text-align: center;
  }

  /* ── The dramaturgy form (Ablauf) ── */
  .bm-menu__form {
    width: 100%;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 13px;
  }

  .bm-menu__duration {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  .bm-menu__schedule {
    display: grid;
    gap: 1px;
    border: 1px solid rgba(5, 7, 12, 0.14);
    background: rgba(5, 7, 12, 0.14);
  }

  .bm-menu__srow {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) 76px 104px 104px;
    gap: 10px;
    align-items: center;
    min-height: 44px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.62);
  }

  .bm-menu__srow--head {
    min-height: 34px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.55;
    background: rgba(255, 255, 255, 0.9);
  }

  .bm-menu__srow--locked {
    opacity: 0.6;
  }

  .bm-menu input[type="number"] {
    width: 88px;
    min-height: 34px;
    padding: 0 8px;
    border: 1px solid rgba(5, 7, 12, 0.22);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.75);
    color: inherit;
    font: inherit;
  }

  .bm-menu input[type="checkbox"] {
    accent-color: #05070c;
  }

  .bm-menu__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 18px;
  }

  .bm-menu__file input {
    display: none;
  }

  /* The "back to configuration" tab, shown while a test run plays. */
  .bm-menu-return {
    position: fixed;
    top: 14px;
    left: 14px;
    z-index: 59;
    min-height: 38px;
    padding: 0 16px;
    border: 1px solid rgba(5, 7, 12, 0.3);
    border-radius: 2px;
    background: rgba(240, 244, 255, 0.9);
    color: #05070c;
    font-family: "Heavitas", ui-sans-serif, system-ui, sans-serif;
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    cursor: pointer;
  }

  .bm-menu-return[hidden] {
    display: none !important;
  }

  @media (max-width: 620px) {
    /* Keep the screen centred; the rails may collapse so a tall form still fits. */
    .bm-menu {
      grid-template-rows: minmax(8px, 1fr) auto minmax(8px, 1fr);
    }

    .bm-menu__srow {
      grid-template-columns: minmax(96px, 1fr) 54px 78px 78px;
      gap: 6px;
      padding: 6px 8px;
      font-size: 12px;
    }

    .bm-menu input[type="number"] {
      width: 70px;
    }
  }
`;
