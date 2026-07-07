import { prefs } from './prefs';
import {
  WINRATE_SCHEMES,
  resolveWinrateScheme,
  type SchemePalette,
  type WinrateScheme,
} from './winrateScheme';

/** The win/mid/loss subset of {@link PALETTE} for a given scheme. */
const schemeColors = (s: SchemePalette) =>
  ({ win: s.win, winText: s.winText, loss: s.loss, lossText: s.lossText, mid: s.mid });

/**
 * Chart palette. SVG fills need literal colours, so the win/mid/loss values that
 * also live as CSS custom properties are mirrored here in one place, driven by the
 * active winrate scheme (seeded to the `aurora` default; the persisted choice is
 * applied at bundle load below). Keep the per-scheme values in sync with
 * ./winrateScheme.ts and styles/tokens.css (the `html[data-wr="…"]` blocks).
 */
export const PALETTE = {
  ...schemeColors(WINRATE_SCHEMES.aurora),
  /** Informational cyan — states that are neither good nor alarming (e.g. rusty). */
  info: '#5bc0de',
  accent: '#7c6cf5',
  accentBright: '#8878ff',
  accentText: '#d7d2ff',
  grid: 'rgba(255,255,255,0.07)',
  track: 'rgba(255,255,255,0.06)',
  muted: '#8a8a98',
  dim: '#6a6a78',
  text: '#e7e7ee',
};

let activeScheme: WinrateScheme = 'aurora';

/** The active winrate colour scheme. */
export const getWinrateScheme = (): WinrateScheme => activeScheme;

/**
 * Apply a winrate scheme everywhere: the JS chart `PALETTE` here plus the CSS
 * custom properties via the `data-wr` attribute on `<html>`. Persists the choice;
 * callers re-render afterwards.
 */
export function setWinrateScheme(scheme: WinrateScheme): void {
  activeScheme = scheme;
  Object.assign(PALETTE, schemeColors(WINRATE_SCHEMES[scheme]));
  document.documentElement.setAttribute('data-wr', scheme);
  prefs.set('winrateScheme', scheme);
}

// Resolve + apply the persisted scheme at bundle load, before the first render —
// migrating the legacy colorblind boolean and retiring its key on the way.
{
  const { scheme, migratedFromColorblind } = resolveWinrateScheme(
    prefs.get('winrateScheme'),
    prefs.get('colorblind'),
  );
  setWinrateScheme(scheme);
  if (migratedFromColorblind) prefs.remove('colorblind');
}

/**
 * Per-game-mode dot colours for the scatter — distinct hues, deliberately kept
 * off the win-green / loss-red used for winrate so the two encodings don't clash.
 * Drawn from the same {@link CATEGORICAL} "aurora dusk" band so they sit with the
 * rest of the design rather than reading as a separate, louder rainbow.
 */
export const MODE_COLORS: Record<string, string> = {
  Control: '#d1b375', // amber
  Hybrid: '#759dd1', // periwinkle
  Escort: '#8575d1', // violet
  Push: '#75c8d1', // teal
  Flashpoint: '#d1759a', // rose
  Clash: '#75d1af', // sage
  Unknown: '#807c8d', // slate
};

/** modeColor('Hybrid') → '#759dd1'; unknown modes fall back to the slate swatch. */
export const modeColor = (mode: string): string => MODE_COLORS[mode] ?? MODE_COLORS.Unknown;

/**
 * Categorical colours for per-map series (donut slices, scatter dots). Tuned as
 * one cohesive "aurora dusk" set — every hue shares the same restrained
 * saturation/lightness (HSL ~50%/64%) so it reads as a family with the aurora
 * accent and muted win/loss/mid tones, instead of the fully-saturated rainbow
 * that looked out of place against the rest of the UI. Ordered so the first,
 * most-used slices stay maximally distinct (violet · sage · amber · periwinkle …).
 */
export const CATEGORICAL = [
  '#8575d1', '#75d1af', '#d1b375', '#759dd1', '#d1759a', '#75c8d1',
  '#d18875', '#a975d1', '#75d182', '#d1c875', '#d175d1',
] as const;

/** Muted slate for a grouped "Other" slice — recedes behind the coloured ones. */
export const OTHER_COLOR = '#5c576b';

/** Categorical winrate colour (bars, pills, text states). */
export function wrColor(winrate: number): string {
  if (winrate >= 0.55) return PALETTE.win;
  if (winrate <= 0.45) return PALETTE.loss;
  return PALETTE.mid;
}

/**
 * Continuous winrate → hue, losing → winning, delegated to the active scheme's
 * ramp. Anchored so ~39% sits at the loss end and ~60% at the win end. Aurora and
 * Teal & coral ramp warm → teal-green; Colorblind ramps orange → blue with a
 * deliberate break at 50% (never through green) for readability.
 */
export function wrHue(winrate: number): number {
  const p = winrate * 100;
  const t = Math.max(0, Math.min(1, (p - 38) / 22));
  return Math.round(WINRATE_SCHEMES[activeScheme].hue(t));
}

/** wrHsl(0.6) → "hsl(162 56% 58%)" (Aurora); renders {@link wrHue} as a CSS colour, optionally with alpha. */
export function wrHsl(winrate: number, sat = 56, light = 58, alpha = 1): string {
  const h = wrHue(winrate);
  return alpha >= 1 ? `hsl(${h} ${sat}% ${light}%)` : `hsl(${h} ${sat}% ${light}% / ${alpha})`;
}
