/**
 * The dashboard view-model: turns raw games + filters into the exact payload the
 * renderer consumes. Pure and Electron-free, so it is unit-testable and can also
 * drive the browser preview harness. The main process only wires it to IPC.
 */
import {
  byAccount, byHero, byMap, byMode, byRole, calendar, focusBy, heroStats,
  latestSession, sessionRecap, streak, trend, winLoss, groupBy, type GameRecord,
} from './analytics';
import { mapMode } from './maps';
import { mentalSummary } from './mental';
import { progression } from './progression';
import { buildTargets, type AuthoredTarget } from './targets';
import { DEFAULT_BREAK_REMINDER, type BreakReminderSettings } from './breakReminder';
import { DEFAULT_READINESS, safeReadiness, type ReadinessSettings } from './readiness';
import type { DemoContext } from './demoPreference';
import type { DashboardData, DashboardFilters, MatchRow } from '../shared/contract';

/** Manual (◎) data the player authored, threaded in from the main-process store. */
export interface ManualData {
  targets?: AuthoredTarget[];
  /** Effective break-reminder settings; defaults when absent. */
  breakReminder?: BreakReminderSettings;
  /** Effective readiness feature settings; defaults when absent. */
  readiness?: ReadinessSettings;
}

export function computeDashboard(
  all: GameRecord[],
  filters: DashboardFilters,
  demo: DemoContext,
  manual?: ManualData,
): DashboardData {
  const games = applyFilters(all, filters);
  const overall = winLoss(games);
  const weekly = (filters.days ?? 30) === 'all' || (filters.days as number) > 90;
  // The review inbox is deliberately unfiltered: an ungraded game must stay
  // visible (and counted in the badge) no matter how the range is narrowed.
  const ungraded = all.filter((g) => !g.review).sort((a, b) => b.timestamp - a.timestamp);

  return {
    isSample: demo.active,
    demoPreference: demo.preference,
    hasRealHistory: demo.hasRealHistory,
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
    targets: buildTargets(games, demo.active, manual?.targets),
    reviewInbox: ungraded.slice(0, ROW_CAP).map(toMatchRow),
    pendingReviews: ungraded.length,
    breakReminder: manual?.breakReminder ?? DEFAULT_BREAK_REMINDER,
    // Readiness is a per-person verdict → computed over the UNFILTERED history,
    // like reviewInbox/recap. safeReadiness never throws, so a readiness bug can
    // never blank the whole dashboard.
    readiness: safeReadiness(all),
    readinessSettings: manual?.readiness ?? DEFAULT_READINESS,
    totalGamesAllTime: all.length,
    ...(recapOf(all) ?? {}),
  };
}

/** Yesterday's recap over the unfiltered history, as a spreadable fragment. */
function recapOf(all: GameRecord[]): { recap: NonNullable<DashboardData['recap']> } | null {
  const recap = sessionRecap(all);
  return recap ? { recap } : null;
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

/** Row cap keeps list payloads bounded; counts (e.g. pendingReviews) never are. */
const ROW_CAP = 150;

function recentMatches(games: GameRecord[]): MatchRow[] {
  return [...games]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, ROW_CAP)
    .map(toMatchRow);
}

function toMatchRow(g: GameRecord): MatchRow {
  return {
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
  };
}

/** Most-played account name — used for the Overview greeting. */
function topAccount(games: GameRecord[]): string {
  return byAccount(games)[0]?.key ?? 'Player';
}

const distinct = <T>(arr: T[]): T[] => [...new Set(arr)];
