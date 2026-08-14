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
import type { PlacementRunSummary, Role } from '../../../src/shared/contract';
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

/**
 * Raise {@link openPlacementComplete} for a track whose run has played out its ten
 * matches but has no confirmed rank yet — the single trigger every caller shares.
 *
 * This exists because the prompt used to be bolted onto exactly one code path (the
 * manual log form's save, gated on a locally counted `counted + 1 >= target`), so a
 * run that reached ten any other way — reviewing an auto-tracked match, backdating a
 * start, an edit that pulled a tenth match in — sat at `Placements 10/10` forever
 * with nothing asking for the rank. Callers no longer decide *whether* a run is
 * finished; they say "something changed on this track" and this asks the store.
 *
 * Reads `getPlacements()` fresh rather than a view snapshot — the same trap commit
 * `4729f0d` already fixed once: the summary a caller is holding predates the write
 * that just completed the run.
 *
 * Opens AT MOST ONE dialog, preferring the track just played, so several finished
 * tracks can never stack modals (and it composes with the season-reset offer's
 * one-at-a-time rule). Resolves to whether one was shown, so callers that chain
 * something afterwards can tell "asked" from "nothing to ask".
 */
export async function maybeConfirmPlacementRank(opts: {
  /** The track just played, preferred over any other awaiting run. */
  account?: string;
  role?: Role;
  /** Runs after a successful confirm, once the dialog has already closed. */
  onDone: () => void;
}): Promise<boolean> {
  const { account, role, onDone } = opts;
  let awaiting: PlacementRunSummary[];
  try {
    awaiting = (await bridge.getPlacements()).filter((p) => p.awaitingRank);
  } catch {
    // A failed read must not break the caller's own save/close flow — the run
    // stays awaiting and every surface still shows its "confirm your rank" call
    // to action, so nothing is lost but this one prompt.
    return false;
  }
  if (!awaiting.length) return false;
  const run =
    awaiting.find((p) => p.account === account && p.role === role) ?? awaiting[0];
  openPlacementComplete({
    account: run.account,
    role: run.role,
    ...(run.latestPrediction ? { suggestion: run.latestPrediction } : {}),
    onDone,
  });
  return true;
}
