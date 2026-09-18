/**
 * The ▴/→/▾ recent-vs-earlier verdict glyph, shared by every surface that
 * renders a {@link FocusTrend} — Focus's map rows and the Heroes table's
 * Trend column (H6). One definition keeps the arrow, colour and tooltip
 * wording from drifting between the two.
 */
import { h } from '../dom';
import type { FocusTrend } from '../../../src/shared/contract';
import { PALETTE } from '../theme';
import { infoTip } from './infoTip';

export const TREND_META: Record<FocusTrend, { arrow: string; color: string; label: string }> = {
  improving: { arrow: '▴', color: PALETTE.win, label: 'improving lately' },
  flat: { arrow: '→', color: PALETTE.muted, label: 'holding steady' },
  declining: { arrow: '▾', color: PALETTE.loss, label: 'getting worse' },
};

/** ▴/→/▾ verdict for entries with enough games in range; tooltip explains it. */
export function trendArrow(trend?: FocusTrend): HTMLElement | null {
  if (!trend) return null;
  const meta = TREND_META[trend];
  // K8: a bare `title` on a 12px glyph was the only explanation of what the
  // arrow means — invisible to keyboard users, and a ~1s hover away from
  // everyone else.
  return h('span', { style: { display: 'inline-flex', alignItems: 'baseline', flex: '0 0 auto' } },
    h('span', { class: 'mono', style: { color: meta.color, fontSize: '12px' } }, meta.arrow),
    infoTip(`Trend: ${meta.label} (recent games vs earlier ones in range).`, { label: `Trend: ${meta.label}` }),
  );
}
