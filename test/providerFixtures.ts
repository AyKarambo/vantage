import type { GameRecord } from '../src/core/analytics';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import { defaultConfig, type AppConfig } from '../src/main/config/schema';
import type { JsonDocs } from '../src/store/jsonDocs';
import { MemoryHistoryStore } from '../src/store/memoryHistory';
import { ManualStore } from '../src/store/manualLog';
import { RankAnchorStore } from '../src/store/rankAnchors';
import { PlacementStore } from '../src/store/placements';
import { CheckInStore } from '../src/store/checkIns';
import { FriendStore } from '../src/store/friends';
import { MasterDataStore } from '../src/store/masterData';

/** A storage location that keeps every document in memory (copied in and out, like a file would). */
export function memoryDocs(): JsonDocs {
  const docs = new Map<string, string>();
  return (name) => ({
    read: () => {
      const raw = docs.get(name);
      return raw === undefined ? undefined : JSON.parse(raw);
    },
    write: (value) => { docs.set(name, JSON.stringify(value)); },
    clear: () => { docs.delete(name); },
    relocate: () => {},
  });
}

/** The real stores, in memory, plus the config they are read against. */
export interface ProviderWorld {
  history: MemoryHistoryStore;
  manual: ManualStore;
  rankAnchors: RankAnchorStore;
  placements: PlacementStore;
  checkIns: CheckInStore;
  friends: FriendStore;
  masterDataStore: MasterDataStore;
  config: AppConfig;
}

/**
 * Complete, typed provider deps for a test: the real stores over memory, the
 * default config, and inert edges (no Notion, no dialogs, no notifications).
 * Override any dep to observe or fake it; the stores stay reachable through
 * the returned world for arrange/assert.
 */
export function providerHarness(opts: { games?: GameRecord[]; config?: Partial<AppConfig>; deps?: Partial<DataProviderDeps> } = {}) {
  const docs = memoryDocs();
  const world: ProviderWorld = {
    history: new MemoryHistoryStore(undefined, opts.games ?? []),
    manual: new ManualStore(docs),
    rankAnchors: new RankAnchorStore(docs),
    placements: new PlacementStore(docs),
    checkIns: new CheckInStore(docs),
    friends: new FriendStore(docs),
    masterDataStore: new MasterDataStore(docs),
    config: { ...defaultConfig(), ...opts.config },
  };
  const unavailable = async () => ({ games: [], failed: 0, duplicates: 0, unavailable: true });
  const deps: DataProviderDeps = {
    history: world.history,
    manual: world.manual,
    rankAnchors: world.rankAnchors,
    placements: world.placements,
    checkIns: world.checkIns,
    friends: world.friends,
    masterDataStore: world.masterDataStore,
    fetchMasterDataUpdate: async () => ({ heroes: [], maps: [] }),
    notion: {
      export: async () => ({ ok: 0, failed: 0, unavailable: true }),
      import: unavailable,
      status: () => ({ tokenSet: false, databaseConfigured: false, connected: false, unsyncedGames: 0, competitiveGames: 0, databaseSource: 'none', importedMatches: 0 }),
      setToken: () => deps.notion.status(),
      clearToken: () => deps.notion.status(),
      listDatabases: async () => ({ databases: [] }),
      listPages: async () => ({ pages: [] }),
      selectDatabase: async () => deps.notion.status(),
      createDatabase: async () => deps.notion.status(),
      clearExports: () => {},
      cleanupDuplicates: async () => ({ archived: 0, kept: 0, failed: 0, unavailable: true }),
    },
    getConfig: () => world.config,
    persistAccounts: (accounts) => { world.config.accounts = accounts; },
    importFile: { pick: async () => undefined },
    persistConfig: () => {},
    recordGame: (game) => world.history.add(game),
    resolvePending: () => false,
    dismissPending: (matchId) => world.history.removePending(matchId),
    notify: () => {},
    sampleGames: () => [],
    logger: { entries: () => [], getLevel: () => 'info', setLevel: () => {}, error: () => {} },
    getSecrets: () => [],
    gepStatus: () => ({ state: 'no-game', sensor: 'gep', attachedAt: null, lastEventAt: null, eventsThisSession: 0, matchInProgress: false }),
    devModeAuthStatus: () => ({ attempted: false, outcome: 'pending' }),
    appSettings: { get: () => ({ ...world.config.ui, runAtLogin: world.config.runAtLogin }), apply: () => deps.appSettings.get() },
    setDevKey: () => ({ hasKey: false }),
    appInfo: () => ({
      version: 'test', supportEmail: '', electron: '', chromium: '', node: '', v8: '', platform: 'test', osRelease: '',
      packaged: false, devMode: false, devModeAttempted: false, gepPackageVersion: '', mcpBridgePath: '',
    }),
    openExternal: async () => {},
    saveTextFile: async () => undefined,
    applyGepUpdate: () => {},
    dataLocation: {
      get: () => ({ folder: 'memory', isDefault: true }),
      choose: async () => ({ ok: true, changed: false, location: { folder: 'memory', isDefault: true } }),
      set: async () => ({ ok: true, changed: false, location: { folder: 'memory', isDefault: true } }),
      chooseFirstRun: async () => ({ ok: true, changed: false, location: { folder: 'memory', isDefault: true } }),
      reveal: () => {},
    },
    ...opts.deps,
  };
  return { ...world, deps, provider: createDataProvider(deps) };
}
