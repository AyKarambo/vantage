/**
 * Settings — the app-behavior home: break reminder (canonical editor, Mental
 * keeps its inline copy), window behavior (close-to-tray, run at login),
 * appearance (colorblind palette), and diagnostics (log level + viewer).
 */
import { h, render } from '../dom';
import type { AccountSummary, AppUiSettings, RankSummary, Role } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { button, card, chip, pill, select } from '../components/primitives';
import { breakReminderEditor } from '../components/breakReminderEditor';
import { logLevelToggle } from '../components/logLevelToggle';
import { openModal } from '../components/overlay';
import { rankLabel, roleLabel } from '../format';
import { TIERS } from '../../../src/core/rank';
import { isColorblind, setColorblind } from '../theme';
import { store } from '../store';
import { viewHead, type ViewContext } from './view';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'tank', label: 'Tank' }, { value: 'damage', label: 'Damage' },
  { value: 'support', label: 'Support' }, { value: 'openQ', label: 'Open Queue' },
];
const DIVISIONS = [5, 4, 3, 2, 1];

export function settings(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'view' },
    viewHead('Settings', 'Accounts, app behavior, coaching nudges, appearance, diagnostics'),
    accountsCard(),
    h('div', { class: 'grid-2' },
      card({ title: 'Coaching', sub: 'the break reminder fires a tray notification' },
        breakReminderEditor(ctx),
      ),
      appBehaviorCard(ctx),
    ),
    h('div', { class: 'grid-2' },
      card({ title: 'Appearance' },
        h('div', { style: { marginTop: '4px' } },
          chip(isColorblind() ? 'Colorblind-safe palette: on' : 'Colorblind-safe palette: off', isColorblind(), () => {
            setColorblind(!isColorblind());
            store.rerender();
          }),
          h('div', { class: 'hint', style: { marginTop: '8px' } },
            'Swaps the win/loss green–red for blue–orange across every chart and stat.'),
        ),
      ),
      diagnosticsCard(),
    ),
  );
}

/** Close-to-tray + run-at-login + demo data — persisted in the main process. */
function appBehaviorCard(ctx: ViewContext): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '10px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));
  void bridge.getAppSettings().then(paint);

  // demoPreference changes the dashboard payload (badge, targets, KPIs), so it
  // needs a store refetch; closeToTray/runAtLogin don't touch the dashboard.
  const refetchIfDemo = (p: Partial<AppUiSettings>): void => {
    if (p.demoPreference !== undefined) void store.refresh();
  };

  // Settings apply instantly; the chip itself flips to show the new state, so no
  // toast is fired here (they were distracting on every toggle). The change is
  // trivially reversible by toggling back.
  function apply(patch: Partial<AppUiSettings>): void {
    void bridge.setAppSettings(patch).then((applied) => {
      paint(applied);
      refetchIfDemo(patch);
    });
  }

  function paint(s: AppUiSettings): void {
    render(body,
      h('div', null,
        chip(s.closeToTray ? '✕ keeps Vantage in the tray' : '✕ quits Vantage', s.closeToTray,
          () => apply({ closeToTray: !s.closeToTray })),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          'When on, closing the window keeps tracking games in the background.'),
      ),
      h('div', null,
        chip(s.runAtLogin ? 'Run at login: on' : 'Run at login: off', s.runAtLogin,
          () => apply({ runAtLogin: !s.runAtLogin })),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          'Starts hidden in the tray so it never steals focus from a game.'),
      ),
      h('div', null,
        chip(s.demoPreference === 'on' ? 'Demo data: on' : 'Demo data: off', s.demoPreference === 'on',
          () => apply({ demoPreference: s.demoPreference === 'on' ? 'off' : 'on' })),
        h('div', { class: 'hint', style: { marginTop: '6px' } },
          ctx.data.hasRealHistory
            ? 'You have tracked games, so this has no visible effect — real data always wins. It applies again only if your history is empty.'
            : 'Preload a realistic sample season to explore the app. Turn it off to start from a clean slate.'),
      ),
    );
  }
  return card({ title: 'App behavior' }, body);
}

/**
 * Accounts manager — create/edit/delete the accounts you log matches against
 * (a battleTag → label mapping) and, per account, view and set the per-role rank
 * anchors the calculated-rank engine tracks from.
 */
function accountsCard(): HTMLElement {
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
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
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
    return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '12px' } },
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
      h('div', { class: 'hint' }, 'Set your current rank once; logged competitive matches move it from here. Editing re-anchors from the value you enter.'),
      host,
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Save', { variant: 'primary', onClick: () => {
          void bridge.setRankAnchor({ account, role: state.role, tier: state.tier, division: state.division, progressPct: Number(state.pct) || 0 }).then(() => { close(); onDone(); });
        } }),
        button('Cancel', { variant: 'ghost', onClick: close }),
      ),
    );
  });
}

function numField(value: string, onChange: (v: string) => void): HTMLInputElement {
  return h('input', {
    class: 'vt-input mono', type: 'number', step: '1', value, placeholder: '0–100',
    on: { input: (e) => onChange((e.target as HTMLInputElement).value) },
  }) as HTMLInputElement;
}

function diagnosticsCard(): HTMLElement {
  const about = h('div', { class: 'hint', style: { marginTop: '10px' } }, '');
  void bridge.getAppInfo().then((info) => {
    render(about, `Vantage ${info.version} · support: ${info.supportEmail}`);
  });
  return card({ title: 'Diagnostics', sub: 'the release debug log' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
      logLevelToggle(),
      h('button', {
        class: 'btn btn--soft',
        on: { click: () => store.setView('logs') },
      }, 'Open log viewer'),
    ),
    h('div', { class: 'hint', style: { marginTop: '8px' } },
      'Every build writes a rotating log — GEP lifecycle, match pipeline, sync results. Tokens are never logged.'),
    about,
  );
}
