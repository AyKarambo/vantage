/**
 * Focus — the "work on these" hub: net-losing maps in one priority list, each
 * with a trend verdict and, when an improvement target is linked, the
 * since-flagged progress. Overview teases → Focus prioritizes → Maps stays
 * the reference table → Targets is the commitment.
 */
import { h, applyStyle } from '../dom';
import type { FocusEntry, FocusProgress, FocusTrend } from '../../../src/shared/contract';
import { pct, signed } from '../format';
import { PALETTE, wrColor } from '../theme';
import { button, card } from '../components/primitives';
import { viewHead, type ViewContext } from './view';

const TREND_META: Record<FocusTrend, { arrow: string; color: string; label: string }> = {
  improving: { arrow: '▴', color: PALETTE.win, label: 'improving lately' },
  flat: { arrow: '→', color: PALETTE.muted, label: 'holding steady' },
  declining: { arrow: '▾', color: PALETTE.loss, label: 'getting worse' },
};

export function focus(ctx: ViewContext): HTMLElement {
  const items = ctx.data.focusItems;
  const maxNet = items[0]?.net ?? 1;

  return h('div', { class: 'view' },
    viewHead('Focus', 'The maps that cost you the most points — work on these'),
    card({ title: 'Work on these', sub: 'net = losses − wins · across your maps' },
      items.length
        ? h('div', { class: 'stack', style: { gap: '14px' } }, ...items.map((e) => focusRow(ctx, e, maxNet)))
        : h('div', { class: 'empty empty--good' }, 'No maps are net-losing right now — nice. 🎯'),
    ),
    card({ variant: 'glow', title: 'Build a focus routine' },
      h('p', { class: 'hint', style: { lineHeight: '1.6', margin: '0 0 12px' } },
        'Practice your bottom three before ranked and review one replay each. Small, repeatable — that is how the deficit closes.'),
      button('Start a routine →', { variant: 'primary', onClick: () => ctx.navigate('targets') }),
    ),
  );
}

function focusRow(ctx: ViewContext, e: FocusEntry, maxNet: number): HTMLElement {
  const fill = h('span', { style: { display: 'block', height: '100%', background: PALETTE.loss, borderRadius: 'inherit' } });
  applyStyle(fill, { width: `${Math.round((e.net / maxNet) * 100)}%` });
  const name = e.key;

  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' } },
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', minWidth: '0' } },
        h('div', { class: 'row-name', style: { fontSize: '13.5px' } }, name),
        trendArrow(e.trend),
      ),
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'baseline' } },
        h('span', { class: 'is-loss mono', style: { fontSize: '13px' } }, `${signed(-e.net)} net`),
        h('span', { class: 'mono', style: { color: wrColor(e.winrate) } }, pct(e.winrate)),
        h('span', { class: 'u-dim', style: { fontSize: '11px' } }, `${e.games}g`),
        e.progress ? null : targetButton(ctx, name),
      ),
    ),
    h('div', { class: 'track track--slim' }, fill),
    e.progress ? progressLine(e.progress) : null,
  );
}

/** ▴/→/▾ verdict for entries with enough games in range; tooltip explains it. */
function trendArrow(trend?: FocusTrend): HTMLElement | null {
  if (!trend) return null;
  const meta = TREND_META[trend];
  return h('span', {
    class: 'mono',
    title: `Trend: ${meta.label} (recent games vs earlier ones in range)`,
    style: { color: meta.color, fontSize: '12px', flex: '0 0 auto' },
  }, meta.arrow);
}

/**
 * The closing-the-loop read for an entry that already has a tracked target:
 * the winrate moved since it was flagged (once both sides have enough decided
 * games), or an honest "tracking since" line while the sample is still small.
 */
function progressLine(p: FocusProgress): HTMLElement {
  const since = new Date(p.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const games = `${p.gamesSince} game${p.gamesSince === 1 ? '' : 's'} since`;
  if (p.deltaPts === undefined) {
    return h('div', { class: 'hint', style: { marginTop: '5px', fontSize: '11.5px' } },
      `◎ tracking “${p.targetName}” since ${since} · ${games}`);
  }
  const up = p.deltaPts >= 0;
  return h('div', { class: 'hint', style: { marginTop: '5px', fontSize: '11.5px' } },
    h('span', { class: `mono ${up ? 'is-win' : 'is-loss'}` },
      `${up ? '▴' : '▾'} ${Math.abs(p.deltaPts)} pts`),
    ` since you flagged it (${since}) · ${games}`,
  );
}

/** Quick-create a practice target for an entry that isn't tracked yet. */
function targetButton(ctx: ViewContext, name: string): HTMLElement {
  return h('button', {
    class: 'btn btn--ghost',
    style: { padding: '3px 8px', fontSize: '10.5px' },
    title: `Create a practice target for ${name}`,
    on: {
      click: () => ctx.navigate('targets', {
        prefillName: `Practice ${name}: warm up unranked + review one replay`,
      }),
    },
  }, '＋ target');
}
