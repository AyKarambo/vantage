import { h, render } from '../../dom';
import type { AccountSummary, RankSummary, Role } from '../../../../src/shared/contract';
import { bridge } from '../../bridge';
import { button, card, pill, select } from '../../components/primitives';
import { openModal } from '../../components/overlay';
import { rankLabel, roleLabel } from '../../format';
import { TIERS } from '../../../../src/core/rank';
import { store } from '../../store';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'tank', label: 'Tank' }, { value: 'damage', label: 'Damage' },
  { value: 'support', label: 'Support' }, { value: 'openQ', label: 'Open Queue' },
];
const DIVISIONS = [5, 4, 3, 2, 1];

/**
 * Accounts manager — create/edit/delete the accounts you log matches against
 * (a battleTag → label mapping) and, per account, view and set the per-role rank
 * anchors the calculated-rank engine tracks from.
 */
export function accountsCard(): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '12px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));

  const reload = (): void => {
    void Promise.all([bridge.listAccounts(), bridge.getRanks()]).then(([accounts, ranks]) => paint(accounts, ranks));
  };

  function paint(accounts: AccountSummary[], ranks: RankSummary[]): void {
    render(body,
      accounts.length
        ? h('div', { class: 'stack', style: { gap: '10px' } }, ...accounts.map((a) => accountRow(a, ranks.filter((r) => r.account === a.label))))
        : h('div', { class: 'hint' }, 'No accounts yet — add one below so you can pick it when logging a match.'),
      addForm(),
    );
  }

  function accountRow(a: AccountSummary, accRanks: RankSummary[]): HTMLElement {
    const row = h('div', { class: 'account-row' });
    const view = (): void => {
      render(row,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('div', { style: { flex: '1', minWidth: '0' } },
            h('div', { style: { fontSize: '13px', fontWeight: '600' } }, a.label),
            h('div', { class: 'u-dim mono', style: { fontSize: '11px' } }, a.battleTag),
          ),
          button('Edit', { variant: 'ghost', onClick: edit }),
          button('Delete', { variant: 'ghost', onClick: () => void bridge.deleteAccount(a.battleTag).then(reload) }),
        ),
        ranksLine(a.label, accRanks),
      );
    };
    const edit = (): void => {
      const bt = h('input', { class: 'vt-input', type: 'text', value: a.battleTag }) as HTMLInputElement;
      const lb = h('input', { class: 'vt-input', type: 'text', value: a.label }) as HTMLInputElement;
      render(row,
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' } },
          labelled('BattleTag', bt), labelled('Display name', lb),
          button('Save', { variant: 'primary', onClick: () => {
            const battleTag = bt.value.trim(); if (!battleTag) return;
            void bridge.saveAccount({ battleTag, label: lb.value.trim() || battleTag, previousBattleTag: a.battleTag }).then(reload);
          } }),
          button('Cancel', { variant: 'ghost', onClick: view }),
        ),
      );
    };
    view();
    return row;
  }

  function ranksLine(account: string, accRanks: RankSummary[]): HTMLElement {
    const pills = accRanks.map((r) => pill(
      `${roleLabel(r.role)}: ${r.needsReanchor ? `${rankLabel(r.tier, r.division)} · set %` : `${rankLabel(r.tier, r.division)} · ${Math.round(r.progressPct)}%`}${r.protected ? ' 🛡' : ''}`,
      'accent',
    ));
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px' } },
      ...(pills.length ? pills : [h('span', { class: 'hint' }, 'No rank set yet')]),
      button('Set rank', { variant: 'ghost', onClick: () => openSetRank(account, accRanks, reload) }),
    );
  }

  function addForm(): HTMLElement {
    const bt = h('input', { class: 'vt-input', type: 'text', placeholder: 'BattleTag, e.g. You#1234' }) as HTMLInputElement;
    const lb = h('input', { class: 'vt-input', type: 'text', placeholder: 'Display name (optional)' }) as HTMLInputElement;
    return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '12px' } },
      labelled('BattleTag', bt), labelled('Display name', lb),
      button('Add account', { variant: 'soft', onClick: () => {
        const battleTag = bt.value.trim(); if (!battleTag) return;
        void bridge.saveAccount({ battleTag, label: lb.value.trim() || battleTag }).then(reload);
      } }),
    );
  }

  reload();
  return card({ title: 'Accounts', sub: 'used when logging a match; rank is tracked per role, per account' }, body);
}

/** A small label-over-control wrapper for the account inline forms. */
function labelled(label: string, control: Node): HTMLElement {
  return h('div', { style: { minWidth: '160px' } }, h('div', { class: 'field-label' }, label), control);
}

/** Modal to set/replace the one-time rank anchor for a role on an account. */
function openSetRank(account: string, ranks: RankSummary[], onDone: () => void): void {
  openModal((close) => {
    const state = { role: 'damage' as Role, tier: 'Gold', division: 3, pct: '' };
    const seed = (role: Role): void => {
      const ex = ranks.find((r) => r.role === role);
      state.role = role;
      if (ex) {
        state.tier = ex.tier;
        state.division = ex.division;
        state.pct = ex.needsReanchor ? '' : String(Math.round(ex.progressPct));
      }
    };
    seed(state.role);

    const host = h('div', { class: 'stack', style: { gap: '10px' } });
    const paint = (): void => {
      render(host,
        labelled('Role', select(ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })), state.role, (v) => { seed(v as Role); paint(); })),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          labelled('Tier', select(TIERS.map((t) => ({ value: t, label: t })), state.tier, (v) => (state.tier = v))),
          labelled('Division', select(DIVISIONS.map((d) => ({ value: String(d), label: `Div ${d}` })), String(state.division), (v) => (state.division = Number(v)))),
          labelled('% into division', numField(state.pct, (v) => (state.pct = v))),
        ),
      );
    };
    paint();

    return h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '440px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, `Set rank — ${account}`),
      h('div', { class: 'hint' }, 'Set your current rank once; logged competitive matches move it from here. Editing re-anchors from the value you enter. A negative % means you’re in rank protection.'),
      host,
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Save', { variant: 'primary', onClick: () => {
          void bridge.setRankAnchor({ account, role: state.role, tier: state.tier, division: state.division, progressPct: Number(state.pct) || 0 })
            // onDone reloads the accounts card; store.refresh re-fetches the dashboard
            // snapshot so the always-visible sidebar chip + Overview Rank KPI update live.
            .then(() => { close(); onDone(); void store.refresh(); });
        } }),
        button('Cancel', { variant: 'ghost', onClick: close }),
      ),
    );
  });
}

function numField(value: string, onChange: (v: string) => void): HTMLInputElement {
  return h('input', {
    class: 'vt-input mono', type: 'number', step: '1', value, placeholder: '0–100, or -19 if protected',
    on: { input: (e) => onChange((e.target as HTMLInputElement).value) },
  }) as HTMLInputElement;
}
