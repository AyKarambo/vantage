/**
 * Browser preview harness. Stands in for the Electron preload bridge by mocking
 * `window.owstats` with the pure core running against the sample season, so the
 * full UI can be viewed and iterated in a plain browser — no Overwolf runtime.
 *
 * Manual writes (logMatch / saveTarget / saveReview / target lifecycle) are
 * persisted to localStorage so they survive a reload here, mirroring how the
 * real app persists them to disk.
 */
import type {
  AccountInput, AccountSummary, AppUiSettings, AuthoredTargetInput, BreakReminderSettings,
  DashboardFilters, DataLocationResult, GepHealthState, GepStatusPayload, LogEntry, LogLevel, ManualMatchInput,
  MatchEditInput, NotionDatabaseSummary, NotionPageSummary, NotionStatus, OwStatsApi,
  RankAnchorInput, RankSummary, ReadinessSettings, RendererErrorInput, ReviewInput, StalenessSettings, SyncProgress, TargetEditInput,
} from '../../src/shared/contract';
import type { GameRecord, MatchReview } from '../../src/core/analytics';
import type { AuthoredTarget } from '../../src/core/targets';
import type { Role } from '../../src/core/model';
import { effectiveDemo, type DemoPreference } from '../../src/core/demoPreference';
import { generateSampleGames } from '../../src/core/sampleData';
import { computeDashboard, applyFilters } from '../../src/core/dashboardData';
import { heroDetail, mostPlayedHeroes as rankHeroesByPlays } from '../../src/core/analytics';
import { matchDetail } from '../../src/core/matchDetail';
import {
  DEFAULT_MASTER_DATA, mergeMasterData, diffMasterData, applyAccepted, makeMapMode,
  upsertHeroOverride, removeHeroOverride, upsertMapOverride, removeMapOverride,
  upsertSeasonOverride, removeSeasonOverride, emptyOverrides,
  type MasterDataOverrides, type FetchedCatalog,
} from '../../src/core/masterData';
import { sourceOf } from '../../src/core/source';
import { currentRank, rankKey, type RankAnchor, type RankAnchorMap } from '../../src/core/rank';
import { DEFAULT_BREAK_REMINDER, normalizeBreakReminder } from '../../src/core/breakReminder';
import { DEFAULT_STALENESS, normalizeStaleness } from '../../src/core/staleness';
import { DEFAULT_READINESS, normalizeReadiness } from '../../src/core/readiness';
import { App } from '../src/app/shell';
import { must } from '../src/dom';

const LOGGED_KEY = 'vantagePreviewLogged';
const TARGETS_KEY = 'vantagePreviewTargets';
const REVIEWS_KEY = 'vantagePreviewReviews';
const BREAK_REMINDER_KEY = 'vantagePreviewBreakReminder';
const STALENESS_KEY = 'vantagePreviewStaleness';
const READINESS_KEY = 'vantagePreviewReadiness';
const NOTION_DB_KEY = 'vantagePreviewNotionDatabaseId';
const NOTION_TOKEN_KEY = 'vantagePreviewNotionTokenSet';
const APP_SETTINGS_KEY = 'vantagePreviewAppSettings';
const ACCOUNTS_KEY = 'vantagePreviewAccounts';
const ANCHORS_KEY = 'vantagePreviewAnchors';
const EDITS_KEY = 'vantagePreviewEdits';
const MASTER_DATA_KEY = 'vantagePreviewMasterData';

/** Preview-side master-data overrides, persisted to localStorage like other writes. */
function loadOverrides(): MasterDataOverrides {
  try {
    const p = JSON.parse(localStorage.getItem(MASTER_DATA_KEY) ?? 'null');
    if (p && typeof p === 'object') return { heroes: p.heroes ?? {}, maps: p.maps ?? {}, seasons: p.seasons ?? {} };
  } catch {
    /* fall through to empty */
  }
  return emptyOverrides();
}
let previewOverrides = loadOverrides();
const saveOverrides = (): void => localStorage.setItem(MASTER_DATA_KEY, JSON.stringify(previewOverrides));
const effectiveMasterData = () => mergeMasterData(DEFAULT_MASTER_DATA, previewOverrides);

const load = <T>(key: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const loadMap = <T>(key: string): Record<string, T> => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
const save = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

const season = generateSampleGames(220, 42);
const logged: GameRecord[] = load<GameRecord>(LOGGED_KEY);
// Older preview targets predate the active flag / activatedAt stamp — backfill like ManualStore does.
const targets: AuthoredTarget[] = load<AuthoredTarget>(TARGETS_KEY)
  .map((t) => ({ ...t, isActive: t.isActive ?? true, activatedAt: t.activatedAt ?? t.createdAt }));
const previewReviews: Record<string, MatchReview> = loadMap<MatchReview>(REVIEWS_KEY);
// Manual-layer edits from the Matches drill-down, overlaid onto any match.
const previewEdits: Record<string, Partial<GameRecord>> = loadMap<Partial<GameRecord>>(EDITS_KEY);
// Accounts (battleTag → label). Seeded from the sample season's accounts.
type AnchorRecord = RankAnchor & { account: string; role: Role };
const seededAccounts = (): Record<string, string> => {
  const names = [...new Set(season.map((g) => g.account))];
  return Object.fromEntries(names.map((n) => [`${n}#0000`, n]));
};
const storedAccounts = loadMap<string>(ACCOUNTS_KEY);
const previewAccounts: Record<string, string> = Object.keys(storedAccounts).length ? storedAccounts : seededAccounts();
const previewAnchors: Record<string, AnchorRecord> = loadMap<AnchorRecord>(ANCHORS_KEY);
const anchorMap = (): RankAnchorMap => {
  const out: RankAnchorMap = {};
  for (const a of Object.values(previewAnchors)) {
    out[rankKey(a.account, a.role)] = { tier: a.tier, division: a.division, progressPct: a.progressPct, setAt: a.setAt };
  }
  return out;
};
const accountList = (): AccountSummary[] =>
  Object.entries(previewAccounts).map(([battleTag, label]) => ({ battleTag, label: label || battleTag }));
const previewRanks = (): RankSummary[] => {
  const games = dataset();
  const map = anchorMap();
  return Object.values(previewAnchors).map((a) => {
    const s = currentRank(games, map, a.account, a.role);
    return {
      account: a.account, role: a.role,
      tier: s?.tier ?? a.tier, division: s?.division ?? a.division,
      progressPct: s?.progressPct ?? a.progressPct,
      protected: s?.protected ?? false, needsReanchor: s?.needsReanchor ?? false,
    };
  });
};
const savedBreakReminder = loadMap<unknown>(BREAK_REMINDER_KEY) as Partial<BreakReminderSettings>;
let breakReminder: BreakReminderSettings = Object.keys(savedBreakReminder).length
  ? normalizeBreakReminder(savedBreakReminder)
  : { ...DEFAULT_BREAK_REMINDER };
const savedStaleness = loadMap<unknown>(STALENESS_KEY) as Partial<StalenessSettings>;
let staleness: StalenessSettings = Object.keys(savedStaleness).length
  ? normalizeStaleness(savedStaleness)
  : { ...DEFAULT_STALENESS };
const savedReadiness = loadMap<unknown>(READINESS_KEY) as Partial<ReadinessSettings>;
let readiness: ReadinessSettings = Object.keys(savedReadiness).length
  ? normalizeReadiness(savedReadiness)
  : { ...DEFAULT_READINESS };

// Saved reviews are overlaid onto the dataset so the pure core exercises the
// full pipeline (inbox, mental merge, target scoring) exactly as in the app.
// Mirrors src/main/dataProvider.ts's games(): real (logged) games win; the demo
// season shows only while opted in with no real games — so ?demo=off/unset
// previews the honest empty states end-to-end.
const dataset = (): GameRecord[] =>
  (logged.length ? logged : appSettings.demoPreference === 'on' ? season : []).map((g) => {
    let out = g;
    if (previewEdits[g.matchId]) out = { ...out, ...previewEdits[g.matchId] };
    if (previewReviews[g.matchId]) out = { ...out, review: previewReviews[g.matchId] };
    return out;
  });

const findTarget = (id: string): AuthoredTarget | undefined => targets.find((t) => t.id === id);

// Canned Notion picker data — the preview has no real Notion runtime, but the
// database-picker card still needs something to list and select against.
const CANNED_DATABASES: NotionDatabaseSummary[] = [
  { id: 'db-gametracker', title: 'Gametracker', url: 'https://notion.so/db-gametracker' },
  { id: 'db-old-season', title: 'Gametracker (Season 1 — archived)', url: 'https://notion.so/db-old-season' },
];
const CANNED_PAGES: NotionPageSummary[] = [
  { id: 'page-overwatch', title: 'Overwatch', url: 'https://notion.so/page-overwatch' },
  { id: 'page-gaming', title: 'Gaming', url: 'https://notion.so/page-gaming' },
];
let selectedNotionDatabaseId: string | undefined = localStorage.getItem(NOTION_DB_KEY) ?? undefined;
let notionTokenSet = localStorage.getItem(NOTION_TOKEN_KEY) === '1';
let appSettings: AppUiSettings = {
  closeToTray: true,
  runAtLogin: false,
  demoPreference: 'on',
  ...(loadMap<unknown>(APP_SETTINGS_KEY) as Partial<AppUiSettings>),
};
// ?demo=on|off|unset overrides the persisted choice — lets design QA preview the
// first-run prompt (unset) and the honest empty states (off) without Electron.
const demoParam = new URLSearchParams(location.search).get('demo');
if (demoParam === 'on' || demoParam === 'off' || demoParam === 'unset') {
  appSettings.demoPreference = demoParam as DemoPreference;
}
const previewDemo = () => ({
  active: effectiveDemo(appSettings.demoPreference, logged.length),
  preference: appSettings.demoPreference,
  hasRealHistory: logged.length > 0,
});

// Fake log feed: a canned backlog plus a slow trickle of new entries, so the
// Logs screen's tail/filter/pause behaviors are all exercisable in a browser.
let previewLogLevel: LogLevel = 'info';
const logListeners = new Set<(e: LogEntry) => void>();
const previewLog: LogEntry[] = [
  { ts: Date.now() - 90_000, level: 'info', scope: 'main', message: 'Vantage started', fields: { version: 'preview', sensor: 'gep' } },
  { ts: Date.now() - 80_000, level: 'info', scope: 'gep', message: 'game detected', fields: { game: 10844 } },
  { ts: Date.now() - 75_000, level: 'debug', scope: 'gep', message: 'info update kill_feed' },
  { ts: Date.now() - 60_000, level: 'warn', scope: 'notion', message: 'shape validation skipped — no database selected' },
  { ts: Date.now() - 30_000, level: 'error', scope: 'renderer', message: 'example forwarded error', fields: { source: 'preview' } },
];
let previewLogTick = 0;
setInterval(() => {
  const e: LogEntry = {
    ts: Date.now(),
    level: previewLogLevel === 'debug' && previewLogTick % 2 === 0 ? 'debug' : 'info',
    scope: previewLogTick % 3 === 0 ? 'pipeline' : 'gep',
    message: `preview heartbeat #${++previewLogTick}`,
  };
  previewLog.push(e);
  for (const cb of logListeners) cb(e);
}, 4000);

// Simulated connection status: pick a state with ?gep=live|stale|connected|
// no-game, or ?gep=cycle to rotate through all four (default: connected).
const gepListeners = new Set<(s: GepStatusPayload) => void>();
const GEP_STATES: GepHealthState[] = ['no-game', 'connected', 'live', 'stale'];
const gepParam = new URLSearchParams(location.search).get('gep') ?? 'connected';
let gepState: GepHealthState = (GEP_STATES as string[]).includes(gepParam)
  ? (gepParam as GepHealthState)
  : 'connected';
const gepPayload = (): GepStatusPayload => ({
  state: gepState,
  sensor: 'gep',
  attachedAt: gepState === 'no-game' ? null : Date.now() - 300_000,
  lastEventAt: gepState === 'no-game' ? null : Date.now() - (gepState === 'stale' ? 90_000 : 4_000),
  eventsThisSession: gepState === 'no-game' ? 0 : 128,
  matchInProgress: gepState === 'live' || gepState === 'stale',
});
if (gepParam === 'cycle') {
  let i = 1;
  setInterval(() => {
    gepState = GEP_STATES[i++ % GEP_STATES.length];
    for (const cb of gepListeners) cb(gepPayload());
  }, 5000);
}

const syncListeners = new Set<(p: SyncProgress) => void>();

// Canned count of "imported" matches so the wipe-for-re-import affordance is testable.
let previewImportedMatches = 0;

// In-memory data-folder mock (Area C): the browser preview has no real
// filesystem to migrate, so "choosing a folder" just relabels the mock
// location instead of moving anything. `?firstRunData=1` shows the first-run
// data-location prompt (default: already-chosen, matching an existing install
// per spec C5) so the prompt itself stays reachable without a fresh Electron
// profile.
const DEFAULT_DATA_FOLDER = '(browser preview — in-memory)';
let previewDataFolder = DEFAULT_DATA_FOLDER;
let previewDataFolderIsDefault = true;
let previewNeedsFirstRunChoice = new URLSearchParams(location.search).get('firstRunData') === '1';
let previewFolderPickCount = 0;

function notionStatusFor(databaseId: string | undefined): NotionStatus {
  const db = CANNED_DATABASES.find((d) => d.id === databaseId);
  return {
    tokenSet: notionTokenSet,
    databaseConfigured: Boolean(db),
    connected: notionTokenSet && Boolean(db),
    gametrackerUrl: db?.url,
    trackedGames: dataset().length,
    databaseSource: db ? 'selected' : 'none',
    databaseId: db?.id,
    databaseTitle: db?.title,
    shapeValid: db ? true : undefined,
    shapeIssues: undefined,
    lastSyncedAt: db ? Date.now() - 3_600_000 : undefined,
    importedMatches: previewImportedMatches,
  };
}

const mock: OwStatsApi = {
  getDashboard: async (f: DashboardFilters) => computeDashboard(dataset(), f, previewDemo(), { targets, breakReminder, staleness, readiness, rankAnchors: anchorMap() }, effectiveMasterData()),
  heroDetail: async (hero: string, f: DashboardFilters) =>
    heroDetail(applyFilters(dataset(), f, effectiveMasterData().seasons.map((s) => s.start)), hero),
  matchDetail: async (matchId: string, f: DashboardFilters) => {
    const games = dataset();
    const eff = effectiveMasterData();
    return matchDetail(games, matchId, applyFilters(games, f, eff.seasons.map((s) => s.start)), anchorMap(), makeMapMode(eff.maps));
  },
  exportNotion: async () => {
    if (!selectedNotionDatabaseId) return { ok: 0, failed: 0, unavailable: true };
    // Simulate per-game progress so the sync card's live counter is testable.
    const total = Math.min(dataset().length, 40);
    for (let done = 1; done <= total; done += 8) {
      for (const cb of syncListeners) cb({ done: Math.min(done, total), total });
      await new Promise((r) => setTimeout(r, 60));
    }
    return { ok: dataset().length, failed: 0, skipped: 0 };
  },
  // The preview has no Notion runtime; token state is tracked locally, and the
  // database picker operates against a small canned list (see CANNED_DATABASES).
  notionStatus: async () => notionStatusFor(selectedNotionDatabaseId),
  setNotionToken: async () => {
    // A token alone doesn't select a database — the picker card is what shows next.
    notionTokenSet = true;
    localStorage.setItem(NOTION_TOKEN_KEY, '1');
    return notionStatusFor(selectedNotionDatabaseId);
  },
  clearNotionToken: async () => {
    notionTokenSet = false;
    selectedNotionDatabaseId = undefined;
    localStorage.removeItem(NOTION_TOKEN_KEY);
    localStorage.removeItem(NOTION_DB_KEY);
    return notionStatusFor(undefined);
  },
  listNotionDatabases: async () => ({ databases: CANNED_DATABASES }),
  listNotionPages: async () => ({ pages: CANNED_PAGES }),
  selectNotionDatabase: async (databaseId: string) => {
    selectedNotionDatabaseId = databaseId;
    localStorage.setItem(NOTION_DB_KEY, databaseId);
    return notionStatusFor(databaseId);
  },
  createNotionDatabase: async (_parentPageId: string) => {
    // Simulate the ~15s auto-create latency the real IPC call incurs.
    await new Promise((resolve) => setTimeout(resolve, 400));
    selectedNotionDatabaseId = 'db-gametracker';
    localStorage.setItem(NOTION_DB_KEY, selectedNotionDatabaseId);
    return notionStatusFor(selectedNotionDatabaseId);
  },
  // Master data: overrides persist to localStorage; the Update fetch is simulated
  // with a synthetic catalog (one new hero + one new map) so the preview exercises
  // the additions/changes → accept/discard flow without any network.
  masterDataGet: async () => effectiveMasterData(),
  masterDataUpsertHero: async (entry) => {
    previewOverrides = upsertHeroOverride(previewOverrides, DEFAULT_MASTER_DATA, entry);
    saveOverrides();
    return effectiveMasterData();
  },
  masterDataRemoveHero: async (name) => {
    previewOverrides = removeHeroOverride(previewOverrides, DEFAULT_MASTER_DATA, name);
    saveOverrides();
    return effectiveMasterData();
  },
  masterDataUpsertMap: async (entry) => {
    previewOverrides = upsertMapOverride(previewOverrides, DEFAULT_MASTER_DATA, entry);
    saveOverrides();
    return effectiveMasterData();
  },
  masterDataRemoveMap: async (name) => {
    previewOverrides = removeMapOverride(previewOverrides, DEFAULT_MASTER_DATA, name);
    saveOverrides();
    return effectiveMasterData();
  },
  masterDataUpsertSeason: async (entry) => {
    previewOverrides = upsertSeasonOverride(previewOverrides, DEFAULT_MASTER_DATA, entry);
    saveOverrides();
    return effectiveMasterData();
  },
  masterDataRemoveSeason: async (id) => {
    previewOverrides = removeSeasonOverride(previewOverrides, DEFAULT_MASTER_DATA, id);
    saveOverrides();
    return effectiveMasterData();
  },
  masterDataFetchUpdate: async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const eff = effectiveMasterData();
    const fetched: FetchedCatalog = {
      heroes: [...eff.heroes, { name: 'Preview Hero', role: 'damage' }],
      maps: [
        ...eff.maps.map((m) => ({ name: m.name, mode: m.mode, isActive: true })),
        { name: 'Preview Arena', mode: 'Control', isActive: true },
      ],
    };
    return diffMasterData(eff, fetched);
  },
  masterDataApplyUpdate: async (accepted) => {
    previewOverrides = applyAccepted(previewOverrides, DEFAULT_MASTER_DATA, accepted);
    saveOverrides();
    return effectiveMasterData();
  },
  logMatch: async (input: ManualMatchInput) => {
    const matchId = `manual-${Date.now()}`;
    const grades = input.grades && Object.keys(input.grades).length ? input.grades : undefined;
    logged.push({
      matchId,
      timestamp: input.playedAt != null ? Math.min(input.playedAt, Date.now()) : Date.now(),
      account: input.account || Object.values(previewAccounts)[0] || 'You',
      role: input.role,
      map: input.map,
      result: input.result,
      gameType: input.gameType,
      source: 'manual',
      heroes: input.heroes ?? (input.hero ? [input.hero] : []),
      mental: input.mental,
      ...(input.srDelta != null ? { srDelta: input.srDelta } : {}),
      ...(input.performance != null ? { performance: input.performance } : {}),
    });
    save(LOGGED_KEY, logged);
    if (grades) {
      previewReviews[matchId] = { at: Date.now(), grades, flags: input.mental ?? {} };
      save(REVIEWS_KEY, previewReviews);
    }
    return { matchId };
  },
  editMatch: async (input: MatchEditInput) => {
    const game = dataset().find((g) => g.matchId === input.matchId);
    if (!game) return;
    const patch: Partial<GameRecord> = { ...previewEdits[input.matchId] };
    if (sourceOf(game) === 'manual') {
      if (input.result !== undefined) patch.result = input.result;
      if (input.role !== undefined) patch.role = input.role;
      if (input.map !== undefined) patch.map = input.map;
      if (input.gameType !== undefined) patch.gameType = input.gameType;
      if (input.heroes !== undefined) patch.heroes = input.heroes;
      else if (input.hero !== undefined) patch.heroes = input.hero ? [input.hero] : [];
    }
    if (input.mental !== undefined) patch.mental = input.mental;
    if (input.srDelta !== undefined) {
      if (input.srDelta === null) delete patch.srDelta;
      else patch.srDelta = input.srDelta;
    }
    if (input.performance !== undefined) {
      if (input.performance === null) delete patch.performance;
      else patch.performance = input.performance;
    }
    previewEdits[input.matchId] = patch;
    save(EDITS_KEY, previewEdits);
    if (input.grades && Object.keys(input.grades).length) {
      previewReviews[input.matchId] = { at: Date.now(), grades: input.grades, flags: input.mental ?? game.mental ?? {} };
      save(REVIEWS_KEY, previewReviews);
    }
  },
  listAccounts: async () => accountList(),
  saveAccount: async (input: AccountInput) => {
    const newLabel = input.label || input.battleTag;
    const oldLabel = input.previousBattleTag ? previewAccounts[input.previousBattleTag] : undefined;
    if (input.previousBattleTag && input.previousBattleTag !== input.battleTag) delete previewAccounts[input.previousBattleTag];
    // Cascade a label rename onto games + anchors (both key by label), mirroring the app.
    if (oldLabel && oldLabel !== newLabel) {
      for (const g of logged) if (g.account === oldLabel) g.account = newLabel;
      for (const g of season) if (g.account === oldLabel) g.account = newLabel;
      for (const key of Object.keys(previewAnchors)) {
        const a = previewAnchors[key];
        if (a.account !== oldLabel) continue;
        delete previewAnchors[key];
        a.account = newLabel;
        previewAnchors[rankKey(newLabel, a.role)] = a;
      }
      save(LOGGED_KEY, logged);
      save(ANCHORS_KEY, previewAnchors);
    }
    previewAccounts[input.battleTag] = newLabel;
    save(ACCOUNTS_KEY, previewAccounts);
    return accountList();
  },
  deleteAccount: async (battleTag: string) => {
    delete previewAccounts[battleTag];
    save(ACCOUNTS_KEY, previewAccounts);
    return accountList();
  },
  getRanks: async () => previewRanks(),
  mostPlayedHeroes: async () => {
    const games = dataset();
    const roles: Role[] = ['tank', 'damage', 'support', 'openQ'];
    const out: Record<string, Partial<Record<Role, string[]>>> = {};
    for (const account of new Set(games.map((g) => g.account))) {
      const perRole: Partial<Record<Role, string[]>> = {};
      for (const role of roles) {
        const names = rankHeroesByPlays(games, account, role);
        if (names.length) perRole[role] = names;
      }
      if (Object.keys(perRole).length) out[account] = perRole;
    }
    return out;
  },
  setRankAnchor: async (input: RankAnchorInput) => {
    previewAnchors[rankKey(input.account, input.role)] = {
      account: input.account, role: input.role,
      tier: input.tier, division: input.division, progressPct: input.progressPct, setAt: Date.now(),
    };
    save(ANCHORS_KEY, previewAnchors);
    return previewRanks();
  },
  importNotion: async () => {
    if (!selectedNotionDatabaseId) return { imported: 0, skipped: 0, failed: 0, unavailable: true };
    // No real Notion rows in the harness — return a canned result so the UI is testable.
    previewImportedMatches += 4;
    return { imported: 4, skipped: 2, failed: 0, accountsAdded: 2 };
  },
  deleteImportedMatches: async () => {
    const deleted = previewImportedMatches;
    previewImportedMatches = 0;
    return { deleted };
  },
  cleanupNotionDuplicates: async () => {
    if (!selectedNotionDatabaseId) return { archived: 0, kept: 0, failed: 0, unavailable: true };
    // No real Notion rows in the harness — return a canned result so the UI is testable.
    return { archived: 2, kept: 1, failed: 0 };
  },
  saveTarget: async (input: AuthoredTargetInput) => {
    const now = Date.now();
    targets.push({ id: `t-${now}`, createdAt: now, isActive: true, activatedAt: now, scope: 'season', ...input });
    save(TARGETS_KEY, targets);
  },
  saveReview: async (input: ReviewInput) => {
    previewReviews[input.matchId] = { at: Date.now(), grades: input.grades, flags: input.flags };
    save(REVIEWS_KEY, previewReviews);
    if (input.performance !== undefined) {
      previewEdits[input.matchId] = { ...previewEdits[input.matchId], performance: input.performance };
      save(EDITS_KEY, previewEdits);
    }
  },
  importReviews: async (inputs: ReviewInput[]) => {
    const known = new Set(dataset().map((g) => g.matchId));
    let imported = 0;
    let skipped = 0;
    for (const i of inputs) {
      if (!known.has(i.matchId) || previewReviews[i.matchId]) {
        skipped++;
        continue;
      }
      previewReviews[i.matchId] = { at: Date.now(), grades: i.grades, flags: i.flags };
      imported++;
    }
    if (imported) save(REVIEWS_KEY, previewReviews);
    return { imported, skipped };
  },
  updateTarget: async (input: TargetEditInput) => {
    const t = findTarget(input.id);
    if (!t) return;
    t.name = input.name;
    t.mode = input.mode;
    t.rule = input.rule;
    save(TARGETS_KEY, targets);
  },
  setTargetActive: async (id: string, active: boolean) => {
    const t = findTarget(id);
    if (!t) return;
    t.isActive = active;
    if (active) t.activatedAt = Date.now();
    save(TARGETS_KEY, targets);
  },
  deactivateAllTargets: async () => {
    for (const t of targets) t.isActive = false;
    save(TARGETS_KEY, targets);
  },
  setTargetArchived: async (id: string, archived: boolean) => {
    const t = findTarget(id);
    if (!t) return;
    if (archived) t.archivedAt = Date.now();
    else delete t.archivedAt;
    save(TARGETS_KEY, targets);
  },
  deleteTarget: async (id: string) => {
    const idx = targets.findIndex((t) => t.id === id);
    if (idx < 0) return;
    targets.splice(idx, 1);
    save(TARGETS_KEY, targets);
  },
  getBreakReminder: async () => breakReminder,
  setBreakReminder: async (input: BreakReminderSettings) => {
    breakReminder = normalizeBreakReminder(input);
    save(BREAK_REMINDER_KEY, breakReminder);
    return breakReminder;
  },
  getStaleness: async () => staleness,
  setStaleness: async (input: StalenessSettings) => {
    staleness = normalizeStaleness(input);
    save(STALENESS_KEY, staleness);
    return staleness;
  },
  getReadiness: async () => readiness,
  setReadiness: async (input: ReadinessSettings) => {
    readiness = normalizeReadiness(input);
    save(READINESS_KEY, readiness);
    return readiness;
  },
  getLogEntries: async () => [...previewLog],
  getLogLevel: async () => previewLogLevel,
  setLogLevel: async (level: LogLevel) => {
    previewLogLevel = level;
    return previewLogLevel;
  },
  logRendererError: async (input: RendererErrorInput) => {
    const e: LogEntry = {
      ts: Date.now(), level: 'error', scope: 'renderer', message: input.message,
      fields: { ...(input.source ? { source: input.source } : {}) },
    };
    previewLog.push(e);
    for (const cb of logListeners) cb(e);
  },
  onLogEntry: (cb: (e: LogEntry) => void) => {
    logListeners.add(cb);
    return () => logListeners.delete(cb);
  },
  getGepStatus: async () => gepPayload(),
  onGepStatus: (cb: (s: GepStatusPayload) => void) => {
    gepListeners.add(cb);
    return () => gepListeners.delete(cb);
  },
  onSyncProgress: (cb: (p: SyncProgress) => void) => {
    syncListeners.add(cb);
    return () => syncListeners.delete(cb);
  },
  getAppSettings: async () => appSettings,
  setAppSettings: async (patch: Partial<AppUiSettings>) => {
    appSettings = { ...appSettings, ...patch };
    save(APP_SETTINGS_KEY, appSettings);
    return appSettings;
  },
  getAppInfo: async () => ({
    version: 'preview',
    supportEmail: 'timo.seikel@gmail.com',
    electron: 'preview',
    chromium: 'preview',
    node: 'preview',
    v8: 'preview',
    platform: 'browser',
    osRelease: 'preview',
    packaged: false,
  }),
  openExternal: async (url: string) => {
    // No shell in the browser harness — echo the intent so links stay debuggable.
    console.info('[preview] openExternal', url);
  },
  getDataLocation: async () => ({
    folder: previewDataFolder,
    isDefault: previewDataFolderIsDefault,
    ...(previewNeedsFirstRunChoice ? { needsFirstRunChoice: true } : {}),
  }),
  // No real filesystem in the browser preview: each "pick" just cycles through
  // a couple of canned folder names. The first pick simulates an ordinary new
  // folder (migrate); every third simulates one that already holds Vantage
  // data (requiresAdopt), so the adopt-or-cancel flow stays exercisable here.
  chooseDataFolder: async (): Promise<DataLocationResult> => {
    previewFolderPickCount++;
    const target = `C:\\Users\\preview\\OneDrive\\Vantage-data-${previewFolderPickCount}`;
    if (previewFolderPickCount % 3 === 0) {
      return { ok: true, location: { folder: target, isDefault: false }, changed: false, requiresAdopt: true };
    }
    previewDataFolder = target;
    previewDataFolderIsDefault = false;
    return { ok: true, location: { folder: previewDataFolder, isDefault: false }, changed: true };
  },
  setDataFolder: async (input: { folder: string; adopt?: boolean }): Promise<DataLocationResult> => {
    previewDataFolder = input.folder;
    previewDataFolderIsDefault = input.folder === DEFAULT_DATA_FOLDER;
    previewNeedsFirstRunChoice = false;
    return { ok: true, location: { folder: previewDataFolder, isDefault: previewDataFolderIsDefault }, changed: true };
  },
  chooseFirstRunDataFolder: async (): Promise<DataLocationResult> => {
    previewFolderPickCount++;
    const target = `C:\\Users\\preview\\OneDrive\\Vantage-data-${previewFolderPickCount}`;
    previewDataFolder = target;
    previewDataFolderIsDefault = false;
    previewNeedsFirstRunChoice = false;
    return { ok: true, location: { folder: previewDataFolder, isDefault: false }, changed: true };
  },
  clearReview: async (matchId: string) => {
    delete previewReviews[matchId];
    save(REVIEWS_KEY, previewReviews);
  },
  window: {
    minimize: () => console.info('[preview] minimize'),
    toggleMaximize: () => console.info('[preview] toggle-maximize'),
    close: () => console.info('[preview] close'),
  },
};

window.owstats = mock;
new App(must('#app'));
