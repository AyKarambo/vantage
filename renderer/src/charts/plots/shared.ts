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
