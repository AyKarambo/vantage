import { prefs } from './prefs';

export type Density = 'comfortable' | 'compact';

export const DENSITY_OPTIONS: ReadonlyArray<{ value: Density; label: string }> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

let activeDensity: Density = 'comfortable';

/** The active list density. */
export const getDensity = (): Density => activeDensity;

/**
 * Apply a density everywhere: the `data-density` attribute on `<html>`, which
 * `styles/app.css`/`components.css` key their compact overrides off — same
 * idiom as `theme.ts`'s `setWinrateScheme`/`data-wr`. Persists the choice;
 * callers re-render afterwards (nothing here needs a JS-side re-render itself,
 * since every effect is pure CSS).
 */
export function setDensity(density: Density): void {
  activeDensity = density;
  document.documentElement.setAttribute('data-density', density);
  prefs.set('density', density);
}

// Apply the persisted density at bundle load, before the first render — same
// timing as theme.ts's winrate-scheme resolution.
setDensity(prefs.get('density') ?? 'comfortable');
