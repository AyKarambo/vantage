/**
 * Cheater compensation (#341) — the quick dialog for a rank change that is not a
 * match: when Overwatch bans a cheater from one of your games it refunds the %
 * you lost, and Vantage computes rank as anchor + per-match ±%, so the refund
 * has to be entered. It is rare, so it lives behind Settings › Accounts ›
 * Manage ranks… (one action per role row) and the command palette — but once
 * open it takes seconds: the amount has focus, Enter saves, the date is now.
 *
 * The dialog also lists the account's recent adjustments so a typo can be
 * removed (undoable from the toast).
 */
import { h, render } from '../dom';
import type { RankAdjustment, RankSummary, Role } from '../../../src/shared/contract';
import { MAX_ADJUSTMENT_PCT } from '../../../src/core/rank/adjustments';
import { bridge } from '../bridge';
import { button, segmented } from '../components/primitives';
import { openModal } from '../components/overlay';
import { infoTip } from '../components/infoTip';
import { toast } from '../components/toast';
import { signed, toDatetimeLocal } from '../format';
import { ROLE_ORDER } from '../roleStatus';
import { store } from '../store';

const ROLE_NAME: Readonly<Record<Role, string>> = { tank: 'Tank', damage: 'Damage', support: 'Support', openQ: 'Open Queue' };
/** How many of the account's adjustments the dialog lists. */
const RECENT = 5;

export interface RankAdjustmentDialogOpts {
  /** Pre-selected account; when absent (palette) the first anchored account is used. */
  account?: string;
  /** Keep the account fixed (opened from that account's manage-ranks modal) instead of offering a picker. */
  lockAccount?: boolean;
  /** Pre-selected role; falls back to the account's first anchored role. */
  role?: Role;
  /** A write landed — refresh whatever the caller shows. The dashboard store is refreshed regardless. */
  onChange?: () => void;
  /** The dialog closed (saved, cancelled or dismissed) — e.g. reopen the manage-ranks modal. */
  onReturn?: () => void;
}

/** The toast line for one adjustment, e.g. "Rank +18% for Damage on Karambo". */
export function adjustmentToastText(a: Pick<RankAdjustment, 'account' | 'role' | 'deltaPct'>): string {
  return `Rank ${signed(a.deltaPct)}% for ${ROLE_NAME[a.role]} on ${a.account}`;
}

/** Remove an adjustment, with an Undo toast that puts it back under its own id. */
export function removeAdjustmentWithUndo(id: string, onChange: () => void): Promise<void> {
  return bridge.removeRankAdjustment(id).then(({ adjustment }) => {
    onChange();
    void store.refresh();
    if (!adjustment) return;
    toast(`Removed: ${adjustmentToastText(adjustment)}`, {
      action: {
        label: 'Undo',
        run: () => void bridge.restoreRankAdjustment(adjustment).then(() => { onChange(); void store.refresh(); }),
      },
    });
  });
}

/** Open the cheater-compensation dialog. */
export function openRankAdjustment(opts: RankAdjustmentDialogOpts = {}): void {
  let returned = false;
  const back = (): void => {
    if (returned) return;
    returned = true;
    opts.onReturn?.();
  };
  const changed = (): void => { opts.onChange?.(); void store.refresh(); };

  openModal((close) => {
    const state = {
      account: opts.account ?? '',
      role: opts.role ?? ('damage' as Role),
      at: Date.now(),
    };
    let ranks: RankSummary[] = [];
    let adjustments: RankAdjustment[] = [];

    const amount = h('input', {
      class: 'vt-input mono', type: 'number', step: '1', min: '1', max: String(MAX_ADJUSTMENT_PCT),
      placeholder: 'e.g. 18', 'aria-label': 'Rank % refunded', inputmode: 'numeric',
    }) as HTMLInputElement;
    const when = h('input', {
      class: 'vt-input', type: 'datetime-local', max: toDatetimeLocal(Date.now()), value: toDatetimeLocal(state.at),
      'aria-label': 'When it was refunded',
    }) as HTMLInputElement;
    when.addEventListener('change', () => {
      const ms = new Date(when.value).getTime();
      if (!Number.isNaN(ms)) state.at = Math.min(ms, Date.now());
    });
    const error = h('div', { class: 'hint rank-adj-error', role: 'alert' });
    const trackHost = h('div', { class: 'stack', style: { gap: '10px' } });
    const listHost = h('div', { class: 'stack rank-adj-list', style: { gap: '4px' } });

    const save = (): void => {
      const deltaPct = Math.round(Number(amount.value));
      if (!amount.value.trim() || !Number.isFinite(deltaPct) || deltaPct === 0) {
        error.textContent = 'Enter the % the game gave back, e.g. 18.';
        amount.focus();
        return;
      }
      if (!ranks.some((r) => r.account === state.account && r.role === state.role)) {
        error.textContent = `Set a rank for ${ROLE_NAME[state.role]} first — the refund moves it from there.`;
        return;
      }
      void bridge.addRankAdjustment({
        account: state.account, role: state.role, deltaPct, reason: 'cheater-compensation', at: state.at,
      }).then(({ adjustment }) => {
        close();
        changed();
        back();
        if (!adjustment) return;
        toast(adjustmentToastText(adjustment), {
          action: { label: 'Undo', run: () => void removeAdjustmentWithUndo(adjustment.id, () => opts.onChange?.()) },
        });
      }, (err: unknown) => {
        error.textContent = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not save.';
      });
    };
    amount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
    });
    when.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
    });

    const anchoredAccounts = (): string[] => [...new Set(ranks.map((r) => r.account))];
    const anchoredRoles = (account: string): Role[] =>
      ROLE_ORDER.filter((role) => ranks.some((r) => r.account === account && r.role === role));

    const paintList = (): void => {
      const mine = adjustments.filter((a) => a.account === state.account).slice(0, RECENT);
      render(listHost,
        h('div', { class: 'field-label' }, 'Recent adjustments'),
        ...(mine.length
          ? mine.map((a) => h('div', { class: 'rank-adj-row' },
              h('span', { class: 'u-dim' }, shortDate(a.at)),
              h('span', null, ROLE_NAME[a.role]),
              h('span', { class: 'mono' }, `${signed(a.deltaPct)}%`),
              button('Remove', {
                variant: 'ghost',
                title: 'Undo this adjustment — you can bring it back from the toast.',
                // Runs after the remove AND after an Undo, so this list follows both.
                onClick: () => void removeAdjustmentWithUndo(a.id, () => { opts.onChange?.(); void reloadList(); }),
              }),
            ))
          : [h('div', { class: 'hint u-dim' }, 'None yet on this account.')]),
      );
    };
    const reloadList = (): Promise<void> => bridge.listRankAdjustments().then((list) => { adjustments = list; paintList(); });

    const paintTrack = (): void => {
      const accounts = anchoredAccounts();
      if (!accounts.length) {
        render(trackHost, h('div', { class: 'hint' }, 'No rank set yet — set one under Settings › Accounts › Manage ranks… first.'));
        return;
      }
      if (!accounts.includes(state.account)) state.account = accounts[0];
      const roles = anchoredRoles(state.account);
      if (!roles.includes(state.role)) state.role = roles[0];
      render(trackHost,
        opts.lockAccount
          ? null
          : field('Account', h('select', {
              class: 'vt-select',
              on: { change: (e) => { state.account = (e.target as HTMLSelectElement).value; paintTrack(); paintList(); } },
            }, ...accounts.map((acc) => h('option', { value: acc, selected: acc === state.account }, acc)))),
        field(opts.lockAccount ? `Role — ${state.account}` : 'Role', segmented<Role>({
          options: roles.map((role) => ({ value: role, label: ROLE_NAME[role] })),
          value: state.role,
          onChange: (role) => { state.role = role; error.textContent = ''; },
        })),
      );
    };

    void Promise.all([bridge.getRanks(), bridge.listRankAdjustments()]).then(([r, list]) => {
      ranks = r;
      adjustments = list;
      paintTrack();
      paintList();
      amount.focus();
    }, () => render(trackHost, h('div', { class: 'hint' }, 'Could not read your ranks. Close and try again.')));

    // The overlay focuses its first control in a microtask queued before this
    // body was built; this one runs after it, so the amount wins.
    queueMicrotask(() => amount.focus());

    return h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '420px', maxWidth: '92vw' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        h('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Cheater compensation'),
        infoTip(
          'When Overwatch bans a cheater from one of your matches, it gives back the rank % you lost. '
          + 'Enter that amount here: it moves your computed rank like a match ±% would (including promotions and '
          + 'rank protection) but never counts as a game, win or loss.',
          { label: 'What is cheater compensation?' },
        ),
      ),
      h('div', { class: 'hint' }, 'Enter the % the game gave back — Enter saves.'),
      trackHost,
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        field('+% refunded', amount),
        field('When', when),
      ),
      error,
      h('div', { style: { display: 'flex', gap: '10px' } },
        button('Save', { variant: 'primary', onClick: save }),
        button('Cancel', { variant: 'ghost', onClick: () => { close(); back(); } }),
      ),
      listHost,
    );
  }, { onDismiss: back, panelClass: 'modal-card--rank-adj' });
}

/** "Nov 5, 2026" — compact enough for a list row. */
function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function field(label: string, control: Node): HTMLElement {
  return h('div', { class: 'acct-form-field' }, h('div', { class: 'field-label' }, label), control);
}
