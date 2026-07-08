/** Mental — the manual (◎) side: tilt, comms, and what it costs your winrate. */
import { h } from '../dom';
import type { MatchFlagKey } from '../../../src/shared/contract';
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

/** Decided tilted games needed before the tilt-tax number is worth believing. */
const TILT_TAX_MIN_SAMPLE = 5;

export function mental(ctx: ViewContext): HTMLElement {
  const m = ctx.data.mental;
  const tiltTax = Math.round((m.winWhenCalm - m.winWhenTilted) * 100);
  // Gate on decided samples on BOTH sides — `flags.tilt` includes draws (which
  // don't feed winWhenTilted), and an empty calm side prices the tax off a 0/0
  // sentinel winrate just as badly as a thin tilted side does.
  const thinSide = m.tiltedDecided < TILT_TAX_MIN_SAMPLE
    ? { label: 'tilted', n: m.tiltedDecided }
    : m.calmDecided < TILT_TAX_MIN_SAMPLE
      ? { label: 'calm', n: m.calmDecided }
      : null;

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
      card({ title: 'Tilt tax', sub: 'winrate, calm vs tilted' },
        h('div', { class: 'grid-2', style: { gap: '8px' } },
          statBox(h('span', { class: 'is-win' }, pct(m.winWhenCalm)), 'When calm'),
          statBox(h('span', { class: 'is-loss' }, pct(m.winWhenTilted)), 'When tilted'),
        ),
        h('div', { class: 'hint', style: { marginTop: '12px', lineHeight: '1.5' } },
          // A tilt tax priced off one or two decided games (on either side of
          // the split) would be noise dressed up as coaching — hold the claim
          // until both samples can carry it.
          thinSide
            ? `Only ${thinSide.n} decided ${thinSide.label} game${thinSide.n === 1 ? '' : 's'} in this range — not enough to price the tilt tax yet. Keep flagging games.`
            : tiltTax > 0
              ? h('span', null, 'Tilt costs you about ', h('span', { class: 'is-loss' }, `${tiltTax} points`), ' of winrate. Take the break.')
              : 'Tilt is not hurting your results right now — keep it up.'),
      ),
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
