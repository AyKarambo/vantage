/**
 * Settings — the app-behavior home: break reminder (canonical editor, Mental
 * keeps its inline copy), window behavior (close-to-tray, run at login),
 * appearance (winrate colour scheme), and diagnostics (log level + viewer).
 */
import { h, render } from '../dom';
import type { AccountSummary, AppUiSettings, DataLocation, RankSummary, Role } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { button, card, chip, pill, segmented, select } from '../components/primitives';
import { breakReminderEditor } from '../components/breakReminderEditor';
import { readinessSettingsEditor } from '../components/readinessSettingsEditor';
import { logLevelToggle } from '../components/logLevelToggle';
import { openModal } from '../components/overlay';
import { rankLabel, roleLabel } from '../format';
import { TIERS } from '../../../src/core/rank';
import { getWinrateScheme, setWinrateScheme } from '../theme';
import { WINRATE_SCHEME_OPTIONS, type WinrateScheme } from '../winrateScheme';
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
      card({ title: 'Coaching', sub: 'break reminder + readiness nudges' },
        breakReminderEditor(ctx),
        readinessSettingsEditor(ctx),
      ),
      appBehaviorCard(ctx),
    ),
    h('div', { class: 'grid-2' },
      card({ title: 'Appearance' },
        h('div', { style: { marginTop: '4px' } },
          h('div', { class: 'field-label' }, 'Winrate colours'),
          segmented<WinrateScheme>({
            options: [...WINRATE_SCHEME_OPTIONS],
            value: getWinrateScheme(),
            onChange: (scheme) => {
              setWinrateScheme(scheme);
              store.rerender();
            },
          }),
          h('div', { class: 'hint', style: { marginTop: '8px' } },
            'Colours the win / loss / draw stats across every chart and screen. ' +
            'Colorblind uses a blue–orange palette instead of teal–rose.'),
        ),
      ),
      diagnosticsCard(),
    ),
    dataLocationCard(),
  );
}

/**
 * Data storage — where *all* Vantage data files live (`history.db`,
 * `manual.json`, `outbox.json`, `rankAnchors.json`, `screenshots/`, plus a
 * legacy `history.json` backup when present). Point it at a cloud-synced
 * folder for off-machine backup. "Change…" migrates everything with a
 * copy-verify-then-delete guarantee: originals are removed only after the
 * switch is committed, and a target that already holds Vantage data is
 * offered as adopt-or-cancel rather than ever being overwritten.
 */
function dataLocationCard(): HTMLElement {
  const body = h('div', { class: 'stack', style: { gap: '8px', marginTop: '4px' } }, h('div', { class: 'hint' }, 'Loading…'));
  void bridge.getDataLocation().then((loc) => paint(loc));

  function paint(loc: DataLocation, message?: string): void {
    render(body,
      h('div', { style: { fontSize: '12px', fontWeight: '600' } }, loc.isDefault ? 'Default location' : 'Custom folder'),
      h('div', { class: 'mono u-dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, loc.folder),
      message ? h('div', { class: 'hint' }, message) : null,
      h('div', { style: { marginTop: '2px' } }, button('Change…', { variant: 'soft', onClick: choose })),
      h('div', { class: 'hint', style: { marginTop: '6px' } },
        'All match history, targets, and screenshots move together. Point this at a cloud-synced folder ' +
        '(OneDrive, Dropbox) for off-machine backup — use from one machine only, since editing the synced ' +
        'files from two machines at once can corrupt them. Notion export stays a separate, portable backup.'),
    );
  }

  function choose(): void {
    void bridge.chooseDataFolder().then((res) => {
      if (!res.ok) {
        void bridge.getDataLocation().then((loc) => paint(loc, `⚠ Couldn't change the data folder: ${res.error}`));
        return;
      }
      if (res.requiresAdopt) {
        confirmAdopt(res.location, () => void bridge.getDataLocation().then((loc) => paint(loc)));
        return;
      }
      paint(res.location, leftoverNote(res.leftovers));
    });
  }

  /** The chosen folder already holds Vantage data — offer adopt (repoint, no
   *  copy/delete of either side) or cancel (stay on the current folder). */
  function confirmAdopt(location: DataLocation, onCancel: () => void): void {
    openModal((close) => h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '440px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Folder already has Vantage data'),
      h('div', { class: 'mono u-dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, location.folder),
      h('div', { class: 'hint' },
        'This folder already contains Vantage data. Adopting it switches to that data as-is — your ' +
        'current data stays intact in its old location, untouched. Nothing is copied or overwritten.'),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Adopt this folder', { variant: 'primary', onClick: () => {
          void bridge.setDataFolder({ folder: location.folder, adopt: true }).then((res) => {
            close();
            if (!res.ok) {
              void bridge.getDataLocation().then((loc) => paint(loc, `⚠ Couldn't adopt the folder: ${res.error}`));
              return;
            }
            paint(res.location);
            // The adopted folder's data (games, targets, ranks) differs from
            // whatever was showing — refresh the dashboard snapshot, same as
            // every other data-changing settings action (rank anchors, Notion
            // import/clear).
            void store.refresh();
          });
        } }),
        button('Cancel', { variant: 'ghost', onClick: () => { close(); onCancel(); } }),
      ),
    ));
  }

  return card({ title: 'Data storage', sub: 'where your match history, targets, and screenshots are stored' }, body);
}

/** The migration succeeded but some originals in the old folder couldn't be
 *  removed (Windows file locks) — surface the count rather than staying silent. */
function leftoverNote(leftovers?: number): string | undefined {
  if (!leftovers) return undefined;
  return `⚠ ${leftovers} file${leftovers === 1 ? '' : 's'} couldn't be removed from the old folder — safe to delete manually.`;
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
      h('div', { class: 'hint' }, 'Set your current rank once; logged competitive matches move it from here. Editing re-anchors from the value you enter.'),
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
