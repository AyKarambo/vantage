/** Mental — the manual (◎) side: tilt, comms, and what it costs your winrate. */
import { h } from '../dom';
import type { BreakReminderSettings, MentalSummary } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { pct } from '../format';
import { PALETTE } from '../theme';
import { badge, card, chip, select, statBar, statBox } from '../components/primitives';
import { viewHead, type ViewContext } from './view';

export function mental(ctx: ViewContext): HTMLElement {
  const m = ctx.data.mental;
  const tiltTax = Math.round((m.winWhenCalm - m.winWhenTilted) * 100);

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
          tiltTax > 0
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

/** Real on/off + threshold editor for the break reminder — replaces the old
 *  hardcoded "on after 2 losses" line, which lied whenever the setting changed. */
function breakReminderEditor(ctx: ViewContext): HTMLElement {
  const r = ctx.data.breakReminder;

  const set = (patch: Partial<BreakReminderSettings>): void => {
    void bridge.setBreakReminder({ ...r, ...patch }).then(() => ctx.refresh());
  };

  const thresholdSelect = select(
    [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} loss${n === 1 ? '' : 'es'}` })),
    String(r.afterLosses),
    (v) => set({ afterLosses: Number(v) }),
  );
  thresholdSelect.disabled = !r.enabled;

  return h('div', { class: 'stack', style: { gap: '10px', marginTop: '12px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      chip(r.enabled ? 'Break reminder: on' : 'Break reminder: off', r.enabled,
        () => set({ enabled: !r.enabled })),
      h('span', { class: 'hint' }, 'after'),
      thresholdSelect,
    ),
  );
}

// Keep the type import meaningful for readers of the module surface.
export type { MentalSummary };
