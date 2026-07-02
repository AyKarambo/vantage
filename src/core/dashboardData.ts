/**
 * The dashboard view-model: turns raw games + filters into the exact payload the
 * renderer consumes. Pure and Electron-free, so it is unit-testable and can also
 * drive the browser preview harness. The main process only wires it to IPC.
 */
import {
  byAccount, byHero, byMap, byMode, byRole, calendar, focusBy, heroStats,
  latestSession, streak, trend, winLoss, groupBy, type GameRecord,
} from './analytics';
import { mapMode } from './maps';
import { mentalSummary } from './mental';
import { progression } from './progression';
import { buildTargets, type AuthoredTarget } from './targets';
import type { DashboardData, DashboardFilters, MatchRow } from '../shared/contract';

/** Manual (◎) data the player authored, threaded in from the main-process store. */
export interface ManualData {
  targets?: AuthoredTarget[];
}

export function computeDashboard(
  all: GameRecord[],
  filters: DashboardFilters,
  isSample: boolean,
  manual?: ManualData,
): DashboardData {
  const games = applyFilters(all, filters);
  const overall = winLoss(games);
  const weekly = (filters.days ?? 30) === 'all' || (filters.days as number) > 90;

  return {
    isSample,
    generatedAt: Date.now(),
    filters: {
      account: filters.account ?? 'all',
      role: filters.role ?? 'all',
      mode: filters.mode ?? 'all',
      days: filters.days ?? 30,
    },
    options: {
      accounts: distinct(all.map((g) => g.account)).sort(),
      roles: distinct(all.map((g) => g.role)),
      modes: distinct(all.map((g) => g.gameType)).sort(),
    },
    greetingName: topAccount(all),
    overall,
    streak: streak(games),
    progression: progression(games),
    session: latestSession(games),
    byRole: byRole(games),
    byAccount: byAccount(games),
    byMode: byMode(games),
    byMap: byMap(games),
    byMapType: groupBy(games, (g) => mapMode(g.map)),
    byHero: byHero(games).filter((h) => h.games >= 2).slice(0, 14),
    trend: trend(games, weekly ? 'week' : 'day'),
    calendar: calendar(games, 35),
    focusMaps: focusBy(games, (g) => g.map).slice(0, 8),
    heroStats: heroStats(games).filter((h) => h.games >= 2).slice(0, 24),
    matches: recentMatches(games),
    mental: mentalSummary(games),
    targets: buildTargets(games, manual?.targets),
  };
}

export function applyFilters(games: GameRecord[], f: DashboardFilters): GameRecord[] {
  let out = games;
  if (f.account && f.account !== 'all') out = out.filter((g) => g.account === f.account);
  if (f.role && f.role !== 'all') out = out.filter((g) => g.role === f.role);
  if (f.mode && f.mode !== 'all') out = out.filter((g) => g.gameType === f.mode);
  if (f.days && f.days !== 'all') {
    const cutoff = Date.now() - (f.days as number) * 86400000;
    out = out.filter((g) => g.timestamp >= cutoff);
  }
  return out;
}

function recentMatches(games: GameRecord[]): MatchRow[] {
  return [...games]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 150)
    .map((g) => ({
      matchId: g.matchId,
      timestamp: g.timestamp,
      account: g.account,
      role: g.role,
      map: g.map,
      mapType: mapMode(g.map),
      result: g.result,
      gameType: g.gameType,
      heroes: g.heroes,
      durationMinutes: g.durationMinutes,
    }));
}

/** Most-played account name — used for the Overview greeting. */
function topAccount(games: GameRecord[]): string {
  return byAccount(games)[0]?.key ?? 'Player';
}

const distinct = <T>(arr: T[]): T[] => [...new Set(arr)];
