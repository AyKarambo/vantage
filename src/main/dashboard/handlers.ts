import { EVENT_CHANNELS, IPC_CHANNELS, type OwStatsApi } from '../../shared/contract';
import type { DataProvider } from './provider';
import {
  dashboardRead, heroDetailRead, matchDetailRead, matchesPageRead, searchMatchesRead, playerHistoryRead,
  playerListRead, playerRecordsRead, filteredCompetitiveGames, competitiveOnly,
} from './reads';

/** Every request/response method of the contract (no push subscriptions, no window controls). */
export type DashboardInvokers = Omit<OwStatsApi, 'window' | keyof typeof EVENT_CHANNELS>;

/** The main-side form of a contract method: same parameters, may answer synchronously. */
type Answer<F> = F extends (...args: infer A) => Promise<infer R> ? (...args: A) => R | Promise<R> : never;

/** One handler per contract method — what the IPC layer (and the browser preview) dispatches to. */
export type DashboardHandlers = { [K in keyof DashboardInvokers]: Answer<DashboardInvokers[K]> };

/** Contract methods that are compositions over the provider rather than one of its own methods. */
export type ComposedMethod =
  | 'getDashboard' | 'heroDetail' | 'matchDetail' | 'matchesPage' | 'searchMatches'
  | 'playerHistory' | 'playerRecords' | 'playerList'
  | 'exportNotion' | 'exportNotionMatches' | 'masterDataGet' | 'getMasterDataCheck';

/** Contract methods the provider answers itself, under the contract's own name. */
export type ProviderMethod = Exclude<keyof DashboardInvokers, ComposedMethod>;

/** The provider methods that do real async work (dialogs, Notion, the network); every other one answers synchronously. */
export type AsyncProviderMethod =
  | 'importNotion' | 'importFromFile' | 'exportBackup' | 'cleanupNotionDuplicates'
  | 'listNotionDatabases' | 'listNotionPages' | 'selectNotionDatabase' | 'createNotionDatabase'
  | 'exportLogBundle' | 'openExternal' | 'masterDataFetchUpdate'
  | 'chooseDataFolder' | 'setDataFolder' | 'chooseFirstRunDataFolder';

type Sync<F> = F extends (...args: infer A) => Promise<infer R> ? (...args: A) => R : never;

/** The provider's side of the contract: the contract's own signatures, synchronous except {@link AsyncProviderMethod}. */
export type ProviderContract = {
  [K in ProviderMethod]: K extends AsyncProviderMethod ? DashboardInvokers[K] : Sync<DashboardInvokers[K]>;
};

function composed(provider: DataProvider): Pick<DashboardHandlers, ComposedMethod> {
  return {
    // Every read delegates to `reads.ts` — the competitive-only gate and
    // season-window resolution live there so no consumer can re-derive them.
    getDashboard: (filters) => dashboardRead(provider, filters),
    heroDetail: (hero, filters) => heroDetailRead(provider, hero, filters),
    matchDetail: (matchId, filters) => matchDetailRead(provider, matchId, filters),
    matchesPage: (input) => matchesPageRead(provider, input),
    searchMatches: (input) => searchMatchesRead(provider, input),
    playerHistory: (name) => playerHistoryRead(provider, name),
    playerRecords: (names) => playerRecordsRead(provider, names),
    playerList: (query) => playerListRead(provider, query),
    exportNotion: async (filters) => {
      if (!provider.exportToNotion) return { ok: 0, failed: 0, unavailable: true };
      return provider.exportToNotion(filteredCompetitiveGames(provider, filters));
    },
    // W6 "Retry failed" — bypasses the filter bar entirely so a retry can't
    // silently drop a game the active filters happen to exclude; still gated
    // competitive-only, matching every other export path's invariant.
    exportNotionMatches: async (matchIds) => {
      if (!provider.exportToNotion) return { ok: 0, failed: 0, unavailable: true };
      const ids = new Set(matchIds);
      return provider.exportToNotion(competitiveOnly(provider.games()).filter((g) => ids.has(g.matchId)));
    },
    masterDataGet: () => provider.effectiveMasterData(),
    getMasterDataCheck: () => ({ lastCheckedAt: provider.getMasterDataConfig().lastCheckedAt }),
  };
}

/**
 * The full handler table over a provider: the compositions above, plus every
 * other contract method forwarded to the provider method of the same name.
 * Electron-free, so the IPC registration and the browser preview dispatch
 * through the very same table.
 */
export function dashboardHandlers(provider: DataProvider): DashboardHandlers {
  const table: Record<string, unknown> = { ...composed(provider) };
  for (const method of Object.keys(IPC_CHANNELS) as Array<keyof DashboardInvokers>) {
    if (method in table) continue;
    const forward = provider[method as ProviderMethod] as (...args: unknown[]) => unknown;
    table[method] = (...args: unknown[]) => forward.apply(provider, args);
  }
  return table as DashboardHandlers;
}
