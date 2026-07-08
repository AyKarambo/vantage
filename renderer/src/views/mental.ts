/** Mental — the manual (◎) side: tilt, comms, and what it costs your winrate. */
import { h } from '../dom';
import type { MatchFlagKey, RatedSide, WinrateSide } from '../../../src/shared/contract';
import { COST_MIN_SAMPLE } from '../../../src/core/mentalAnalytics';
import { pct } from '../format';
import { PALETTE } from '../theme';
import { badge, card, statBar, statBox } from '../components/primitives';
import { breakReminderEditor } from '../components/breakReminderEditor';
import { viewHead, type ViewContext } from './view';

/** Human labels matching the drill-down chip on Matches. */
const FLAG_LABELS: Record<MatchFlagKey, string> = {
  tilt: 'tilt',
  toxicMates: 'toxic mates',
  leaver: 'leaver',
  positiveComms: 'positive comms',
  abusive: 'abusive comms',
};

export function mental(ctx: ViewContext): HTMLElement {
  const m = ctx.data.mental;

  return h('div', { class: 'view' },
    viewHead('Mental', 'The signals the game never reports — logged by you, ◎ manual'),
    h('div', { class: 'grid-2' },
      card({ title: 'State', actions: badge('◎ manual', 'manual') },
        h('div', { class: 'stack', style: { gap: '11px', marginTop: '4px' } },
          statBar({ label: 'Calm', frac: m.calm / 100, color: PALETTE.win, valueText: String(m.calm) }),
          statBar({ label: 'Tilted', frac: m.tilted / 100, color: PALETTE.loss, valueText: String(m.tilted) }),
        ),
        breakReminderEditor(ctx),
      ),
      costsCard(ctx),
    ),
    card({ title: 'Flags this range', sub: 'how often each came up' },
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px' } },
        flagBox(ctx, m.flags.tilt, 'Tilt', 'tilt'),
        flagBox(ctx, m.flags.toxicMates, 'Toxic mates', 'toxicMates'),
        // The my-team/enemy split is aggregated separately on the payload; the
        // drill-down stays combined ('leaver') until MatchFlagKey is widened
        // (explicitly deferred — see spec #76).
        flagBox(ctx, m.flags.leaverMyTeam, 'Leaver — my team', 'leaver', 'is-loss'),
        flagBox(ctx, m.flags.leaverEnemyTeam, 'Leaver — enemy', 'leaver', 'is-win'),
        flagBox(ctx, m.flags.positiveComms, 'Positive comms', 'positiveComms', 'is-accent'),
        flagBox(ctx, m.flags.abusive, 'Abusive comms', 'abusive', 'is-loss'),
      ),
    ),
  );
}

// ---- "What it costs you" ----------------------------------------------------

/**
 * The generalized tilt tax (spec #76): one row per mental axis, each priced in
 * winrate points only when BOTH sides carry at least COST_MIN_SAMPLE decided
 * (or rated) games — a delta off a thin or 0/0 sample would be noise dressed
 * up as coaching.
 */
function costsCard(ctx: ViewContext): HTMLElement {
  const c = ctx.data.mentalCosts;
  return card({ title: 'What it costs you', sub: 'winrate by mental state, sample-gated' },
    h('div', { class: 'stack', style: { gap: '11px', marginTop: '4px' } },
      taxRow('Tilt tax', c.tilt.calm, 'calm', c.tilt.tilted, 'tilted'),
      taxRow('Comms tax', c.comms.positive, 'positive', c.comms.abusive, 'abusive'),
      taxRow('Toxic mates', c.toxic.without, 'without', c.toxic.with, 'with'),
      leaverRow(c.leaver),
      perfRow(c.performance),
    ),
  );
}

/** Label + right-aligned verdict on one line, a dim detail line under it. */
function costRow(label: string, verdict: Node | string, detail: string): HTMLElement {
  return h('div', null,
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' } },
      h('span', { style: { fontSize: '12.5px' } }, label),
      h('span', { class: 'mono', style: { fontSize: '12px' } }, verdict),
    ),
    h('div', { class: 'hint', style: { marginTop: '2px' } }, detail),
  );
}

/** The signed cost verdict: winning `cost` points less reads as a red −N pts. */
function costVerdict(cost: number, unit = ' pts'): Node | string {
  if (cost > 0) return h('span', { class: 'is-loss' }, `−${cost}${unit}`);
  if (cost < 0) return h('span', { class: 'is-win' }, `+${-cost}${unit}`);
  return 'even';
}

/** A two-sided winrate split row (good side vs bad side), gated on both samples. */
function taxRow(label: string, good: WinrateSide, goodLabel: string, bad: WinrateSide, badLabel: string): HTMLElement {
  if (good.decided < COST_MIN_SAMPLE || bad.decided < COST_MIN_SAMPLE) {
    return costRow(label,
      h('span', { class: 'u-dim' }, 'needs data'),
      `${good.decided}/${COST_MIN_SAMPLE} ${goodLabel} · ${bad.decided}/${COST_MIN_SAMPLE} ${badLabel} decided games`);
  }
  const cost = Math.round((good.winrate - bad.winrate) * 100);
  return costRow(label, costVerdict(cost),
    `${pct(good.winrate)} ${goodLabel} · ${pct(bad.winrate)} ${badLabel}`);
}

/**
 * The three-way leaver swing: the verdict prices a my-team leaver against
 * leaver-free games; the enemy side is reported separately (its swing should
 * be positive — a my-team cost must never hide behind it).
 */
function leaverRow(l: { none: WinrateSide; myTeam: WinrateSide; enemy: WinrateSide }): HTMLElement {
  const side = (s: WinrateSide): string => (s.decided >= COST_MIN_SAMPLE ? pct(s.winrate) : `— (${s.decided}g)`);
  const detail = `${side(l.myTeam)} my team · ${side(l.none)} none · ${side(l.enemy)} enemy`;
  if (l.myTeam.decided < COST_MIN_SAMPLE || l.none.decided < COST_MIN_SAMPLE) {
    return costRow('Leaver swing', h('span', { class: 'u-dim' }, 'needs data'), detail);
  }
  const cost = Math.round((l.none.winrate - l.myTeam.winrate) * 100);
  return costRow('Leaver swing', costVerdict(cost), detail);
}

/** The performance drop when tilted (0–100 self-rating), gated on rated games. */
function perfRow(p: { calm: RatedSide; tilted: RatedSide }): HTMLElement {
  if (p.calm.rated < COST_MIN_SAMPLE || p.tilted.rated < COST_MIN_SAMPLE || p.calm.avg === null || p.tilted.avg === null) {
    return costRow('Performance when tilted',
      h('span', { class: 'u-dim' }, 'needs data'),
      `${p.calm.rated}/${COST_MIN_SAMPLE} calm · ${p.tilted.rated}/${COST_MIN_SAMPLE} tilted rated games`);
  }
  const drop = Math.round(p.calm.avg - p.tilted.avg);
  return costRow('Performance when tilted', costVerdict(drop, ''),
    `self-rating ${p.calm.avg} calm · ${p.tilted.avg} tilted`);
}

/** A "Flags this range" stat box; clickable when its count is non-zero, opening
 *  Matches scoped to that flag. Zero counts stay plain (nothing to drill into). */
function flagBox(ctx: ViewContext, count: number, label: string, flag: MatchFlagKey, valueClass?: string): HTMLElement {
  const value = valueClass ? h('span', { class: valueClass }, String(count)) : String(count);
  if (count <= 0) return statBox(value, label);
  return h('button', {
    class: 'inline-link',
    style: { display: 'block', width: '100%', textAlign: 'left' },
    title: `Show the ${FLAG_LABELS[flag]}-flagged games`,
    on: { click: () => ctx.navigate('matches', { flag }) },
  }, statBox(value, label));
}
