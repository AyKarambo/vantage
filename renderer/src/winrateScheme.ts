/**
 * Winrate colour schemes — the single, DOM-free source of truth for how the
 * win / mid / loss language is coloured. A scheme is applied two ways in lockstep
 * (see {@link ./theme}): CSS custom properties via the `data-wr` attribute on
 * `<html>`, and the JS `PALETTE` mirror used by SVG charts.
 *
 * This module imports nothing from the DOM or prefs so it stays unit-testable and
 * usable from the browser preview. `theme.ts` consumes it to apply a scheme;
 * `prefs.ts` imports only the {@link WinrateScheme} type.
 *
 * The colour values here MUST stay in sync with `styles/tokens.css` (the `:root`
 * defaults = `aurora`, and the `html[data-wr="…"]` override blocks).
 */

/** The selectable winrate colour schemes. `aurora` is the default. */
export type WinrateScheme = 'aurora' | 'teal-coral' | 'colorblind';

/** The scheme used when nothing is stored and there is no legacy pref to migrate. */
export const WINRATE_SCHEME_DEFAULT: WinrateScheme = 'aurora';

/**
 * The JS mirror of a scheme's winrate colours. Mirrors the CSS token family so
 * SVG charts (which need literal fills) match the CSS-driven surfaces.
 */
export interface SchemePalette {
  /** `--win` */
  win: string;
  /** `--win-text` */
  winText: string;
  /** `--loss` */
  loss: string;
  /** `--loss-text` */
  lossText: string;
  /** `--mid` */
  mid: string;
  /**
   * Continuous winrate ramp: a normalised position `t ∈ [0,1]` (loss → win) mapped
   * to a CSS hue in degrees. Per-scheme so each ramp matches its discrete buckets;
   * colourblind keeps a non-linear orange→blue split that never enters the green band.
   */
  hue(t: number): number;
}

/** Linear hue ramp from `lossHue` (t=0) to `winHue` (t=1). */
const linearHue = (lossHue: number, winHue: number) => (t: number): number =>
  lossHue + t * (winHue - lossHue);

/**
 * Every scheme's colours + ramp. Values are derived from the approved spec's
 * anchors at a consistent, restrained saturation/lightness so the win/mid/loss
 * trio sits with the aurora palette instead of reading as a traffic light.
 */
export const WINRATE_SCHEMES: Record<WinrateScheme, SchemePalette> = {
  // Teal-green win · muted-bronze mid · dusty-rose loss — the aurora default.
  aurora: {
    win: '#65bda6', winText: '#98ddca',
    loss: '#ca777f', lossText: '#dca3a8',
    mid: '#bca976',
    hue: linearHue(8, 162),
  },
  // Teal win · neutral-sand mid · coral loss — furthest from a stoplight.
  'teal-coral': {
    win: '#63b6ad', winText: '#98d7d1',
    loss: '#d1887b', lossText: '#e2b0a7',
    mid: '#b4a27e',
    hue: linearHue(11, 176),
  },
  // Blue / orange, colourblind-safe. Mid stays amber (it never clashes with a
  // blue↔orange axis). The ramp deliberately jumps orange→blue, skipping green.
  colorblind: {
    win: '#4f8fd6', winText: '#9cc3ec',
    loss: '#d68a3a', lossText: '#e0ac72',
    mid: '#d6a24f',
    hue: (t: number): number => (t < 0.5 ? 28 + t * 24 : 200 + (t - 0.5) * 30),
  },
};

/** Ordered options for the Settings picker — labels live here so the UI stays dumb. */
export const WINRATE_SCHEME_OPTIONS: ReadonlyArray<{ value: WinrateScheme; label: string }> = [
  { value: 'aurora', label: 'Aurora' },
  { value: 'teal-coral', label: 'Teal & coral' },
  { value: 'colorblind', label: 'Colorblind' },
];

const isWinrateScheme = (v: unknown): v is WinrateScheme =>
  v === 'aurora' || v === 'teal-coral' || v === 'colorblind';

/**
 * Pick the active scheme from stored prefs, migrating the legacy colourblind
 * boolean. A valid stored scheme wins; otherwise a legacy `colorblind === true`
 * maps to the `colorblind` scheme (and is flagged so the caller can retire the old
 * key); anything else falls back to {@link WINRATE_SCHEME_DEFAULT}.
 *
 * @param stored           the value of `prefs.get('winrateScheme')`
 * @param legacyColorblind the value of the deprecated `prefs.get('colorblind')`
 */
export function resolveWinrateScheme(
  stored: unknown,
  legacyColorblind: unknown,
): { scheme: WinrateScheme; migratedFromColorblind: boolean } {
  if (isWinrateScheme(stored)) return { scheme: stored, migratedFromColorblind: false };
  if (legacyColorblind === true) return { scheme: 'colorblind', migratedFromColorblind: true };
  return { scheme: WINRATE_SCHEME_DEFAULT, migratedFromColorblind: false };
}
