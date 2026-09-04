/**
 * Shared data shape and empty-state helper used across multiple chart
 * factories in this module.
 */
import { PALETTE } from '../../theme';
import { svgRoot, svgText } from '../svg';

/** A single labelled winrate/volume sample, plotted by {@link lineChart} and {@link horizontalBars}. */
export interface WrPoint {
  label: string;
  winrate: number;
  games: number;
}

/** Small "not enough data" placeholder chart shown in place of an empty series. */
export function emptyChart(): SVGElement {
  const s = svgRoot(240, 60);
  s.appendChild(svgText(12, 34, 'Not enough data yet.', { anchor: 'start', fill: PALETTE.muted, size: 12 }));
  return s;
}

/**
 * Trailing mean over up to the last `window` values, aligned index-for-index
 * with the input — the smoother overlay {@link ratingChart} and
 * {@link lineChart} both draw on top of their raw per-bucket series so a noisy
 * day-to-day (or week-to-week) line still reads as a trend.
 */
export function rollingMean(values: readonly number[], window: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, v) => a + v, 0) / slice.length;
  });
}
