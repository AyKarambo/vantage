/** Mental — the manual (◎) side: tilt, comms, and what it costs your winrate. */
import { h } from '../dom';
import { pct } from '../format';
import { PALETTE } from '../theme';
import { badge, card, statBar, statBox } from '../components/primitives';
import { breakReminderEditor } from '../components/breakReminderEditor';
import { viewHead, type ViewContext } from './view';

/** Decided tilted games needed before the tilt-tax number is worth believing. */
const TILT_TAX_MIN_SAMPLE = 5;

export function mental(ctx: ViewContext): HTMLElement {
  const m = ctx.data.mental;
  const tiltTax = Math.round((m.winWhenCalm - m.winWhenTilted) * 100);
  const tiltSample = m.flags.tilt;

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
          // A tilt tax priced off one or two bad games would be noise dressed up
          // as coaching — hold the claim until the sample can carry it.
          tiltSample < TILT_TAX_MIN_SAMPLE
            ? `Only ${tiltSample} tilted game${tiltSample === 1 ? '' : 's'} logged in this range — not enough to price the tilt tax yet. Keep flagging games.`
            : tiltTax > 0
              ? h('span', null, 'Tilt costs you about ', h('span', { class: 'is-loss' }, `${tiltTax} points`), ' of winrate. Take the break.')
              : 'Tilt is not hurting your results right now — keep it up.'),
      ),
    ),
    card({ title: 'Flags this range', sub: 'how often each came up' },
      h('div', { class: 'grid-4', style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' } },
        statBox(String(m.flags.tilt), 'Tilt'),
        statBox(String(m.flags.toxicMates), 'Toxic mates'),
        statBox(String(m.flags.leaver), 'Leavers'),
        statBox(h('span', { class: 'is-accent' }, String(m.flags.positiveComms)), 'Positive comms'),
      ),
    ),
  );
}
