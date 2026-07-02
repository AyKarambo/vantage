/**
 * Chart palette. SVG fills need literal colours, so the values that also live
 * as CSS custom properties are mirrored here in one place. Keep this in sync
 * with styles/tokens.css.
 */
export const PALETTE = {
  win: '#57a684',
  winText: '#8fe0b8',
  loss: '#d1685f',
  lossText: '#d18a84',
  mid: '#d6a24f',
  accent: '#7c6cf5',
  accentBright: '#8878ff',
  accentText: '#d7d2ff',
  grid: 'rgba(255,255,255,0.07)',
  track: 'rgba(255,255,255,0.06)',
  muted: '#8a8a98',
  dim: '#6a6a78',
  text: '#e7e7ee',
} as const;

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
 * scatter: anchored so ~39% is red and ~60% is green.
 */
export function wrHue(winrate: number): number {
  const p = winrate * 100;
  const t = Math.max(0, Math.min(1, (p - 38) / 22));
  return Math.round(6 + t * (148 - 6));
}

export function wrHsl(winrate: number, sat = 56, light = 58, alpha = 1): string {
  const h = wrHue(winrate);
  return alpha >= 1 ? `hsl(${h} ${sat}% ${light}%)` : `hsl(${h} ${sat}% ${light}% / ${alpha})`;
}
