/**
 * The placement-completion dialog: at match 10 of a placement run, Overwatch
 * reveals the real rank — this asks the player to confirm exactly what it
 * showed, rather than letting the run's last prediction silently become fact.
 * A prediction is a guess (see srControls.placementPicker); the number this
 * dialog writes is not, so it gets its own explicit, confirmable step.
 *
 * Dismissing it (Cancel / Escape / backdrop click, all via openModal's shared
 * dismissal) writes nothing at all — the run stays open exactly as it was,
 * so the player can come back and finish it later from the placements
 * tracker instead of having a guess promoted for them.
 */
import { h } from '../dom';
import type { Role } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { button } from '../components/primitives';
import { openModal } from '../components/overlay';
import { placementPicker } from '../components/srControls';
import { field, optionalLabel } from '../components/formField';
import { roleLabel } from '../format';

export function openPlacementComplete(opts: {
  account: string;
  role: Role;
  /** The run's latest prediction, prefilled as the starting guess — the player corrects it to what the game actually showed. */
  suggestion?: { tier: string; division: number };
  /** Runs after a successful confirm, once the dialog has already closed — the caller refreshes. */
  onDone: () => void;
}): void {
  const { account, role, suggestion, onDone } = opts;

  openModal((close) => {
    const state = {
      tier: suggestion?.tier ?? 'Gold',
      division: suggestion?.division ?? 3,
      // Blank, not '0': straight out of placements the game usually shows no
      // percentage at all, so leaving this untouched must omit `progressPct`
      // entirely rather than write a 0 that looks like a real reading.
      pct: '',
    };

    // No re-render needed: unlike accounts.ts's openSetRank (which re-seeds
    // per role), nothing else here changes tier/division out from under the
    // picker, so it's built once.
    const picker = placementPicker({
      tier: state.tier,
      division: state.division,
      onTier: (v) => (state.tier = v),
      onDivision: (v) => (state.division = v),
    });

    const pctInput = h('input', {
      class: 'vt-input mono', type: 'number', step: '1', value: state.pct,
      placeholder: 'usually blank or 0',
      on: { input: (e) => (state.pct = (e.target as HTMLInputElement).value) },
    }) as HTMLInputElement;

    const confirm = (): void => {
      const pct = state.pct.trim();
      void bridge.completePlacementRun({
        account, role, tier: state.tier, division: state.division,
        ...(pct !== '' ? { progressPct: Number(pct) } : {}),
      }).then(() => { close(); onDone(); });
    };

    return h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '440px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } },
        `Placements complete — ${roleLabel(role)} on ${account}`),
      h('div', { class: 'hint' },
        'Overwatch just revealed your real rank for this run — enter exactly what it showed you, not another ' +
        'prediction. Dismissing this writes nothing; the run stays open and you can finish it later.'),
      field('Revealed rank', picker),
      field(optionalLabel('% into division', '— optional, straight out of placements it’s usually 0 or blank'), pctInput),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Confirm', { variant: 'primary', onClick: confirm }),
        button('Cancel', { variant: 'ghost', onClick: close }),
      ),
    );
  });
}
