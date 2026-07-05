import { prefs } from './prefs';

/**
 * Chart palette. SVG fills need literal colours, so the values that also live
 * as CSS custom properties are mirrored here in one place. Keep this in sync
 * with styles/tokens.css (the colorblind variants live under `html[data-cvd]`).
 */
const DEFAULT_WIN_LOSS = { win: '#57a684', winText: '#8fe0b8', loss: '#d1685f', lossText: '#d18a84' };
/** Colorblind-safe alternative: blue (win) / orange (loss) instead of green/red. */
const CVD_WIN_LOSS = { win: '#4f8fd6', winText: '#9cc3ec', loss: '#d68a3a', lossText: '#e0ac72' };

export const PALETTE = {
  ...DEFAULT_WIN_LOSS,
  mid: '#d6a24f',
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

let cvd = false;

/** Whether the colorblind-safe palette is active. */
export const isColorblind = (): boolean => cvd;

/**
 * Swap win/loss colours everywhere: the JS chart palette here plus the CSS
 * custom properties via `html[data-cvd]`. Callers re-render afterwards.
 */
export function setColorblind(on: boolean): void {
  cvd = on;
  Object.assign(PALETTE, on ? CVD_WIN_LOSS : DEFAULT_WIN_LOSS);
  document.documentElement.toggleAttribute('data-cvd', on);
  prefs.set('colorblind', on);
}

// Apply the persisted preference at bundle load, before the first render.
if (prefs.get('colorblind')) setColorblind(true);

/**
 * Per-game-mode dot colours for the scatter — distinct hues, deliberately kept
 * off the win-green / loss-red used for winrate so the two encodings don't clash.
 */
export const MODE_COLORS: Record<string, string> = {
  Control: '#e0b878', // amber
  Hybrid: '#6fa8ff', // blue
  Escort: '#9a8bff', // purple
  Push: '#4fc4b0', // teal
  Flashpoint: '#e58bb0', // pink
  Clash: '#5bc0de', // cyan
  Unknown: '#8a8a98', // grey
};

/** modeColor('Hybrid') → '#6fa8ff'; unknown modes fall back to the grey swatch. */
export const modeColor = (mode: string): string => MODE_COLORS[mode] ?? MODE_COLORS.Unknown;

/** Distinct categorical colours for per-map series (donut slices, etc.). */
export const CATEGORICAL = [
  '#7c6cf5', '#57c091', '#e0b878', '#6fa8ff', '#e58bb0', '#5bc0de',
  '#d18a84', '#a78bfa', '#4fc4b0', '#c9a05f', '#7f8fa6',
] as const;

/** Muted grey for a grouped "Other" slice. */
export const OTHER_COLOR = '#4a4a55';

/** Categorical winrate colour (bars, pills, text states). */
export function wrColor(winrate: number): string {
  if (winrate >= 0.55) return PALETTE.win;
  if (winrate <= 0.45) return PALETTE.loss;
  return PALETTE.mid;
}

/**
 * Continuous winrate → hue, red (losing) → green (winning). Mirrors the Vantage
 * scatter: anchored so ~39% is red and ~60% is green. In colorblind mode the
 * ramp becomes orange → blue with a deliberate break at 50% for readability.
 */
export function wrHue(winrate: number): number {
  const p = winrate * 100;
  const t = Math.max(0, Math.min(1, (p - 38) / 22));
  if (cvd) return t < 0.5 ? Math.round(28 + t * 24) : Math.round(200 + (t - 0.5) * 30);
  return Math.round(6 + t * (148 - 6));
}

/** wrHsl(0.6) → "hsl(94 56% 58%)"; renders {@link wrHue} as a CSS colour, optionally with alpha. */
export function wrHsl(winrate: number, sat = 56, light = 58, alpha = 1): string {
  const h = wrHue(winrate);
  return alpha >= 1 ? `hsl(${h} ${sat}% ${light}%)` : `hsl(${h} ${sat}% ${light}% / ${alpha})`;
}
