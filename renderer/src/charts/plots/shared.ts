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
  /** Trailing rolling winrate (C6), precomputed in core (`rollingWinrate`) — calendar-true, unlike a naive last-N-points mean. */
  rolling?: number;
  /**
   * Extra small badges {@link horizontalBars} renders on their own line under
   * the bar (H4 — Maps' per-row trend/rating/target/pool-status reads). The
   * caller builds whatever nodes it wants; this module stays data-shape-
   * agnostic about what they mean.
   */
  meta?: Node[];
}

/** Small "not enough data" placeholder chart shown in place of an empty series. */
export function emptyChart(): SVGElement {
  const s = svgRoot(240, 60);
  s.appendChild(svgText(12, 34, 'Not enough data yet.', { anchor: 'start', fill: PALETTE.muted, size: 12 }));
  return s;
}
