/**
 * Browser preview harness. Stands in for the Electron preload bridge by mocking
 * `window.owstats` with the pure core running against the sample season, so the
 * full UI can be viewed and iterated in a plain browser — no Overwolf runtime.
 *
 * Manual writes (logMatch / saveTarget) are persisted to localStorage so they
 * survive a reload here, mirroring how the real app persists them to disk.
 */
import type {
  AuthoredTargetInput, DashboardFilters, ManualMatchInput, OwStatsApi,
} from '../../src/shared/contract';
import type { GameRecord } from '../../src/core/analytics';
import type { AuthoredTarget } from '../../src/core/targets';
import { generateSampleGames } from '../../src/core/sampleData';
import { computeDashboard, applyFilters } from '../../src/core/dashboardData';
import { heroDetail } from '../../src/core/analytics';
import { App } from '../src/app/shell';
import { must } from '../src/dom';

const LOGGED_KEY = 'vantagePreviewLogged';
const TARGETS_KEY = 'vantagePreviewTargets';

const load = <T>(key: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
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
const targets: AuthoredTarget[] = load<AuthoredTarget>(TARGETS_KEY);

const dataset = (): GameRecord[] => [...season, ...logged];

const mock: OwStatsApi = {
  getDashboard: async (f: DashboardFilters) => computeDashboard(dataset(), f, true, { targets }),
  heroDetail: async (hero: string, f: DashboardFilters) => heroDetail(applyFilters(dataset(), f), hero),
  exportNotion: async () => ({ ok: 0, failed: 0, unavailable: true }),
  // The preview has no Notion runtime; report a disconnected state so the setup
  // UI is what's shown, and echo token set/clear locally.
  notionStatus: async () => ({ tokenSet: false, databaseConfigured: true, connected: false, trackedGames: dataset().length }),
  setNotionToken: async () => ({ tokenSet: true, databaseConfigured: true, connected: true, trackedGames: dataset().length }),
  clearNotionToken: async () => ({ tokenSet: false, databaseConfigured: true, connected: false, trackedGames: dataset().length }),
  logMatch: async (input: ManualMatchInput) => {
    const matchId = `manual-${Date.now()}`;
    logged.push({
      matchId,
      timestamp: Date.now(),
      account: 'You',
      role: input.role,
      map: input.map,
      result: input.result,
      gameType: input.gameType,
      heroes: input.hero ? [input.hero] : [],
      mental: input.mental,
    });
    save(LOGGED_KEY, logged);
    return { matchId };
  },
  saveTarget: async (input: AuthoredTargetInput) => {
    targets.push({ id: `t-${Date.now()}`, createdAt: Date.now(), ...input });
    save(TARGETS_KEY, targets);
  },
  window: {
    minimize: () => console.info('[preview] minimize'),
    toggleMaximize: () => console.info('[preview] toggle-maximize'),
    close: () => console.info('[preview] close'),
  },
};

window.owstats = mock;
new App(must('#app'));
