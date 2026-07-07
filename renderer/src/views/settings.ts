/**
 * Settings — the app-behavior home: break reminder (canonical editor, Mental
 * keeps its inline copy), window behavior (close-to-tray, run at login),
 * appearance (winrate colour scheme), and diagnostics (log level + viewer).
 */
import { h, render } from '../dom';
import type {
  AccountSummary, AppUiSettings, DataLocation, RankSummary, Role,
  MasterData, HeroEntry, MapEntry, SeasonEntry, HeroRole, MapMode, UpdatePreview,
} from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { button, card, chip, pill, segmented, select } from '../components/primitives';
import { breakReminderEditor } from '../components/breakReminderEditor';
import { readinessSettingsEditor } from '../components/readinessSettingsEditor';
import { logLevelToggle } from '../components/logLevelToggle';
import { openModal } from '../components/overlay';
import { toast } from '../components/toast';
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

/** Roles a hero can hold (no `openQ` — that's a queue, not a hero role). */
const HERO_ROLE_OPTIONS: Array<{ value: HeroRole; label: string }> = [
  { value: 'tank', label: 'Tank' }, { value: 'damage', label: 'Damage' }, { value: 'support', label: 'Support' },
];
/** Selectable map game modes. */
const MAP_MODE_OPTIONS: Array<{ value: MapMode; label: string }> = [
  { value: 'Control', label: 'Control' }, { value: 'Escort', label: 'Escort' }, { value: 'Hybrid', label: 'Hybrid' },
  { value: 'Push', label: 'Push' }, { value: 'Flashpoint', label: 'Flashpoint' }, { value: 'Clash', label: 'Clash' },
  { value: 'Unknown', label: 'Unknown' },
];

export function settings(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'view' },
    viewHead('Settings', 'Accounts, app behavior, coaching nudges, appearance, diagnostics'),
    accountsCard(),
    masterDataCard(ctx),
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

// --- Master data (heroes / maps / seasons) ---------------------------------

/** ISO `YYYY-MM-DD` for a UTC season start instant. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The Master Data editor: add/edit/remove heroes, maps (incl. the competitive
 * pool `isActive` toggle) and seasons, plus an "Update" that fetches the latest
 * heroes & maps from the online source and previews additions/changes for
 * accept/discard. Seeds synchronously from `ctx.data.masterData` (already on the
 * dashboard payload) so there's no loading flash; mutations round-trip through
 * the bridge and `store.refresh()` so every consumer (log-match, match detail,
 * analytics) sees the change.
 */
function masterDataCard(ctx: ViewContext): HTMLElement {
  let data: MasterData = ctx.data.masterData;
  const body = h('div', { class: 'stack', style: { gap: '18px', marginTop: '4px' } });

  /** Adopt fresh effective data, repaint, and propagate to the rest of the app. */
  const apply = (next: MasterData): void => {
    data = next;
    paint();
    void store.refresh();
  };

  const updateBtn = button('Update from online source', {
    variant: 'soft',
    onClick: () => void runUpdate(),
  });

  async function runUpdate(): Promise<void> {
    updateBtn.disabled = true;
    updateBtn.textContent = 'Checking…';
    try {
      const preview = await bridge.masterDataFetchUpdate();
      const empty =
        !preview.heroes.additions.length && !preview.heroes.changes.length &&
        !preview.maps.additions.length && !preview.maps.changes.length;
      if (empty) toast('Master data is already up to date.');
      else openUpdatePreview(preview, apply);
    } catch (err) {
      toast(`Update failed — ${String(err)}`);
    } finally {
      updateBtn.disabled = false;
      updateBtn.textContent = 'Update from online source';
    }
  }

  function paint(): void {
    render(body,
      heroSection(data.heroes, apply),
      mapSection(data.maps, apply),
      seasonSection(data.seasons, apply),
    );
  }

  paint();
  return card(
    {
      title: 'Master data',
      sub: 'Heroes, maps & seasons — edit them, or pull new ones from the online source',
      actions: updateBtn,
    },
    body,
  );
}

/** A titled sub-group inside the master-data card. */
function mdGroup(title: string, hint: string, rows: Node[], addForm: Node): HTMLElement {
  return h('div', null,
    h('div', { style: { fontSize: '13px', fontWeight: '600', marginBottom: '2px' } }, title),
    h('div', { class: 'hint', style: { marginBottom: '8px' } }, hint),
    h('div', { class: 'stack', style: { gap: '6px' } }, ...rows, addForm),
  );
}

/** A one-line editor row (label/controls left, actions right). `muted` dims inactive maps. */
function mdRow(muted: boolean, ...children: Node[]): HTMLElement {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
      padding: '4px 0', ...(muted ? { opacity: '0.55' } : {}),
    },
  }, ...children);
}

function textInput(value: string, placeholder: string): HTMLInputElement {
  return h('input', { class: 'vt-input', type: 'text', value, placeholder }) as HTMLInputElement;
}

function heroSection(heroes: HeroEntry[], apply: (d: MasterData) => void): HTMLElement {
  const rows = heroes.map((hero) =>
    mdRow(false,
      h('div', { style: { flex: '1 1 140px', minWidth: '120px' } }, hero.name),
      select(HERO_ROLE_OPTIONS, hero.role, (role) =>
        void bridge.masterDataUpsertHero({ name: hero.name, role: role as HeroRole }).then(apply)),
      button('Remove', { variant: 'ghost', onClick: () => void bridge.masterDataRemoveHero(hero.name).then(apply) }),
    ),
  );
  const name = textInput('', 'New hero name');
  let role: HeroRole = 'damage';
  const add = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '8px' } },
    name,
    select(HERO_ROLE_OPTIONS, role, (v) => (role = v as HeroRole)),
    button('Add hero', { variant: 'soft', onClick: () => {
      const n = name.value.trim();
      if (!n) return;
      void bridge.masterDataUpsertHero({ name: n, role }).then(apply);
    } }),
  );
  return mdGroup('Heroes', 'The quick-log hero list. Changing a role only affects new logs — past matches keep their recorded role.', rows, add);
}

function mapSection(maps: MapEntry[], apply: (d: MasterData) => void): HTMLElement {
  const rows = maps.map((map) =>
    mdRow(!map.isActive,
      h('div', { style: { flex: '1 1 140px', minWidth: '120px' } }, map.name),
      select(MAP_MODE_OPTIONS, map.mode, (mode) =>
        void bridge.masterDataUpsertMap({ ...map, mode: mode as MapMode }).then(apply)),
      chip(map.isActive ? 'In pool' : 'Out of pool', map.isActive, () =>
        void bridge.masterDataUpsertMap({ ...map, isActive: !map.isActive }).then(apply)),
      button('Remove', { variant: 'ghost', onClick: () => void bridge.masterDataRemoveMap(map.name).then(apply) }),
    ),
  );
  const name = textInput('', 'New map name');
  let mode: MapMode = 'Control';
  const add = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '8px' } },
    name,
    select(MAP_MODE_OPTIONS, mode, (v) => (mode = v as MapMode)),
    button('Add map', { variant: 'soft', onClick: () => {
      const n = name.value.trim();
      if (!n) return;
      void bridge.masterDataUpsertMap({ name: n, mode, isActive: true }).then(apply);
    } }),
  );
  return mdGroup(
    'Maps',
    '“In pool” = part of the current competitive map pool. Out-of-pool maps stay in your history but aren’t suggested for new logs.',
    rows,
    add,
  );
}

function seasonSection(seasons: SeasonEntry[], apply: (d: MasterData) => void): HTMLElement {
  // Newest first, matching the season filter.
  const rows = [...seasons].sort((a, b) => b.start - a.start).map((season) => {
    const label = textInput(season.label, 'Season label');
    const commit = (): void => {
      const l = label.value.trim();
      if (l && l !== season.label) void bridge.masterDataUpsertSeason({ start: season.start, label: l }).then(apply);
    };
    label.addEventListener('change', commit);
    return mdRow(false,
      h('div', { class: 'mono u-dim', style: { flex: '0 0 96px', fontSize: '12px' } }, isoDate(season.start)),
      h('div', { style: { flex: '1 1 160px' } }, label),
      button('Remove', { variant: 'ghost', onClick: () =>
        void bridge.masterDataRemoveSeason(`S:${isoDate(season.start)}`).then(apply) }),
    );
  });
  const date = h('input', { class: 'vt-input', type: 'date' }) as HTMLInputElement;
  const label = textInput('', 'Season label (e.g. 2026 Season 4)');
  const add = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '8px' } },
    date, label,
    button('Add season', { variant: 'soft', onClick: () => {
      const start = Date.parse(date.value);
      const l = label.value.trim();
      if (Number.isNaN(start) || !l) return;
      void bridge.masterDataUpsertSeason({ start, label: l }).then(apply);
    } }),
  );
  return mdGroup(
    'Seasons',
    'Competitive season boundaries for the “This season” filter. The current season is auto-extrapolated; add one here to correct or get ahead of a new start.',
    rows,
    add,
  );
}

/**
 * The Update preview modal: each proposed addition/change gets a checkbox
 * (checked by default). Accept applies only the ticked items; Discard leaves
 * everything untouched (spec AC 5/6). `isActive` is never a proposed change —
 * the diff excludes it — so a user's pool toggle is never reverted here.
 */
function openUpdatePreview(preview: UpdatePreview, onApplied: (d: MasterData) => void): void {
  openModal((close) => {
    const picks: Array<{ cb: HTMLInputElement; hero?: HeroEntry; map?: MapEntry }> = [];

    const checkRow = (text: string, sel: { hero?: HeroEntry; map?: MapEntry }): HTMLElement => {
      const cb = h('input', { type: 'checkbox', checked: 'checked' }) as HTMLInputElement;
      picks.push({ cb, ...sel });
      return h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' } }, cb, h('span', null, text));
    };

    const groups: Node[] = [];
    if (preview.heroes.additions.length || preview.heroes.changes.length) {
      groups.push(h('div', { style: { fontWeight: '600', fontSize: '13px', marginTop: '4px' } }, 'Heroes'));
      for (const hentry of preview.heroes.additions) groups.push(checkRow(`+ ${hentry.name} · ${hentry.role}`, { hero: hentry }));
      for (const c of preview.heroes.changes) groups.push(checkRow(`~ ${c.to.name}: ${c.from.role} → ${c.to.role}`, { hero: c.to }));
    }
    if (preview.maps.additions.length || preview.maps.changes.length) {
      groups.push(h('div', { style: { fontWeight: '600', fontSize: '13px', marginTop: '4px' } }, 'Maps'));
      for (const m of preview.maps.additions) groups.push(checkRow(`+ ${m.name} · ${m.mode}`, { map: m }));
      for (const c of preview.maps.changes) groups.push(checkRow(`~ ${c.to.name}: ${c.from.mode} → ${c.to.mode}`, { map: c.to }));
    }

    const accept = (): void => {
      const heroes = picks.filter((p) => p.hero && p.cb.checked).map((p) => p.hero as HeroEntry);
      const maps = picks.filter((p) => p.map && p.cb.checked).map((p) => p.map as MapEntry);
      if (!heroes.length && !maps.length) { close(); return; }
      void bridge.masterDataApplyUpdate({ heroes, maps }).then((next) => {
        close();
        onApplied(next);
        toast(`Applied ${heroes.length + maps.length} update${heroes.length + maps.length === 1 ? '' : 's'}.`);
      });
    };

    return h('div', { class: 'stack', style: { gap: '12px', padding: '18px', width: '460px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, 'Master data update'),
      h('div', { class: 'hint' }, 'New and changed entries from the online source. Untick anything you don’t want, then Accept.'),
      h('div', { class: 'stack', style: { gap: '6px', maxHeight: '46vh', overflowY: 'auto' } }, ...groups),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Accept selected', { variant: 'primary', onClick: accept }),
        button('Discard', { variant: 'ghost', onClick: close }),
      ),
    );
  });
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
