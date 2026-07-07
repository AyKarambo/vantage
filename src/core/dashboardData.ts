/**
 * The dashboard view-model: turns raw games + filters into the exact payload the
 * renderer consumes. Pure and Electron-free, so it is unit-testable and can also
 * drive the browser preview harness. The main process only wires it to IPC.
 */
import {
  byAccount, byHero, byMap, byRole, bySessionPosition, byTimeOfDay, calendar,
  focusBy, heroStats, latestSession, performanceStats, sessionRecap, streak, trend, winLoss, groupBy,
  type GameRecord,
} from './analytics';
import { isCompetitive } from './matchFilter';
import { DEFAULT_MASTER_DATA, makeMapMode, type MapModeResolver } from './masterData';
import { mentalSummary, rowFlags } from './mental';
import { progression } from './progression';
import { buildTargets, evaluateMeasured, NOTION_IMPROVEMENT_TARGET_ID, type AuthoredTarget, type TargetSummary } from './targets';
import { DEFAULT_STALENESS, type StalenessSettings } from './staleness';
import { DEFAULT_BREAK_REMINDER, type BreakReminderSettings } from './breakReminder';
import { DEFAULT_READINESS, safeReadiness, type ReadinessSettings } from './readiness';
import { currentRank, rankKey, type RankAnchorMap } from './rank';
import { seasonsForData, seasonWindowById } from './season';
import type { Role } from './model';
import type { DemoContext } from './demoPreference';
import type { DashboardData, DashboardFilters, MatchRow, MasterData } from '../shared/contract';

/** Manual (◎) data the player authored, threaded in from the main-process store. */
export interface ManualData {
  targets?: AuthoredTarget[];
  /** Effective break-reminder settings; defaults when absent. */
  breakReminder?: BreakReminderSettings;
  /** Effective target-staleness thresholds; defaults when absent. */
  staleness?: StalenessSettings;
  /** Effective readiness feature settings; defaults when absent. */
  readiness?: ReadinessSettings;
  /** Per-(account, role) rank anchors, so the "real" primary rank can be computed. */
  rankAnchors?: RankAnchorMap;
}

export function computeDashboard(
  allGames: GameRecord[],
  filters: DashboardFilters,
  demo: DemoContext,
  manual?: ManualData,
  masterData: MasterData = DEFAULT_MASTER_DATA,
): DashboardData {
  // Effective map-mode + season boundaries come from the (possibly user-edited)
  // master data so an edited mode/season is honored everywhere; both default to
  // the built-in snapshot, so callers that pass nothing get today's behavior.
  const mapModeOf = makeMapMode(masterData.maps);
  const seasonStartsList = masterData.seasons.map((s) => s.start);
  // Vantage is competitive-only (spec D1): scope every count/stat/option to
  // competitive games ONCE, here, rather than re-filtering in each analytic.
  // Non-competitive rows may still exist in the DB (pre-update history) but
  // must be invisible everywhere the dashboard looks.
  const all = allGames.filter((g) => isCompetitive(g.gameType));
  const games = applyFilters(all, filters, seasonStartsList);
  const overall = winLoss(games);
  // Rank is per-person, computed over the FULL history (like readiness), not the
  // filtered set — the anchored "real" rank the sidebar/KPI show over the heuristic.
  // Scoped to the selected account when one is active, else the most-played one,
  // so switching accounts in the sidebar re-points the rank too.
  const primaryAccount = filters.account && filters.account !== 'all' ? filters.account : topAccount(all);
  const primaryRank = primaryRankOf(all, manual?.rankAnchors, primaryAccount, filters.role);
  // Long ranges (all-time, >90d) bucket the trend by week; a season (~63d) and
  // shorter windows stay daily, matching the pre-'season' behavior of the old 90.
  const days = filters.days ?? 30;
  const weekly = days === 'all' || (typeof days === 'number' && days > 90);
  // The review inbox is deliberately unfiltered: an ungraded game must stay
  // visible (and counted in the badge) no matter how the range is narrowed.
  const ungraded = all.filter((g) => !g.review).sort((a, b) => b.timestamp - a.timestamp);
  // Active measured targets auto-grade every inbox row (shown read-only on Review);
  // the same active set drives the staleness cue, counted over unfiltered history.
  const authoredTargets = manual?.targets ?? [];
  const activeMeasured = authoredTargets.filter(
    (t) => t.mode === 'measured' && t.isActive && !t.archivedAt && t.id !== NOTION_IMPROVEMENT_TARGET_ID,
  );

  return {
    isSample: demo.active,
    demoPreference: demo.preference,
    hasRealHistory: demo.hasRealHistory,
    generatedAt: Date.now(),
    filters: {
      account: filters.account ?? 'all',
      role: filters.role ?? 'all',
      days: filters.days ?? 30,
    },
    options: {
      accounts: distinct(all.map((g) => g.account)).sort(),
      roles: distinct(all.map((g) => g.role)),
      seasons: seasonsForData(all.map((g) => g.timestamp), Date.now(), seasonStartsList)
        .map((w) => ({ id: w.id, label: w.label })),
    },
    greetingName: topAccount(all),
    overall,
    streak: streak(games),
    progression: progression(games),
    ...(primaryRank ? { primaryRank } : {}),
    session: latestSession(games),
    byRole: byRole(games),
    byAccount: byAccount(games),
    byMap: byMap(games),
    byMapType: groupBy(games, (g) => mapModeOf(g.map)),
    byHero: byHero(games).filter((h) => h.games >= 2).slice(0, 14),
    trend: trend(games, weekly ? 'week' : 'day'),
    timeOfDay: byTimeOfDay(games),
    // Positions are numbered over the person's whole history — a role/date
    // filter must scope which games are counted, not renumber their sittings.
    sessionPosition: bySessionPosition(all, { include: new Set(games.map((g) => g.matchId)) }),
    calendar: calendar(games, 35),
    focusMaps: focusBy(games, (g) => g.map).slice(0, 8),
    heroStats: heroStats(games).filter((h) => h.games >= 2).slice(0, 24),
    matches: recentMatches(games, mapModeOf),
    mental: mentalSummary(games),
    performance: performanceStats(games),
    targets: withStaleness(buildTargets(games, demo.active, manual?.targets), authoredTargets, all),
    reviewInbox: ungraded.slice(0, ROW_CAP).map((g) => toMatchRow(g, mapModeOf, activeMeasured)),
    pendingReviews: ungraded.length,
    breakReminder: manual?.breakReminder ?? DEFAULT_BREAK_REMINDER,
    staleness: manual?.staleness ?? DEFAULT_STALENESS,
    // Readiness is a per-person verdict → computed over the UNFILTERED
    // (but now competitive-only, plan D1) history, like reviewInbox/recap.
    // The target context feeds the target-focus dampener (active targets are
    // not derivable from GameRecord alone). safeReadiness never throws, so a
    // readiness bug can never blank the whole dashboard.
    readiness: safeReadiness(all, Date.now(), { targets: manual?.targets ?? [] }),
    readinessSettings: manual?.readiness ?? DEFAULT_READINESS,
    totalGamesAllTime: all.length,
    masterData,
    ...(recapOf(all) ?? {}),
  };
}

/** Yesterday's recap over the unfiltered history, as a spreadable fragment. */
function recapOf(all: GameRecord[]): { recap: NonNullable<DashboardData['recap']> } | null {
  const recap = sessionRecap(all);
  return recap ? { recap } : null;
}

export function applyFilters(
  games: GameRecord[],
  f: DashboardFilters,
  seasonStartsList?: readonly number[],
): GameRecord[] {
  let out = games;
  if (f.account && f.account !== 'all') out = out.filter((g) => g.account === f.account);
  if (f.role && f.role !== 'all') out = out.filter((g) => g.role === f.role);
  if (f.days && f.days !== 'all') {
    if (typeof f.days === 'object') {
      // A specific season id (spec D2/D3): resolve to its [start, end) window.
      // An unknown/unlistable id (untrusted IPC, or a season that rolled off
      // the list) falls back to the 30-day window rather than showing nothing.
      const now = Date.now();
      const w = seasonWindowById(f.days.season, now, seasonStartsList);
      if (w) {
        out = out.filter((g) => g.timestamp >= w.start && g.timestamp < w.end);
      } else {
        const cutoff = now - 30 * 86400000;
        out = out.filter((g) => g.timestamp >= cutoff);
      }
    } else {
      const cutoff = Date.now() - f.days * 86400000;
      out = out.filter((g) => g.timestamp >= cutoff);
    }
  }
  return out;
}

/** Row cap keeps list payloads bounded; counts (e.g. pendingReviews) never are. */
const ROW_CAP = 150;

function recentMatches(games: GameRecord[], mapModeOf: MapModeResolver): MatchRow[] {
  return [...games]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, ROW_CAP)
    .map((g) => toMatchRow(g, mapModeOf));
}

function toMatchRow(g: GameRecord, mapModeOf: MapModeResolver, activeMeasured: AuthoredTarget[] = []): MatchRow {
  const flags = rowFlags(g);
  const measuredGrades = measuredGradesFor(g, activeMeasured);
  return {
    matchId: g.matchId,
    timestamp: g.timestamp,
    account: g.account,
    role: g.role,
    map: g.map,
    mapType: mapModeOf(g.map),
    result: g.result,
    gameType: g.gameType,
    heroes: g.heroes,
    durationMinutes: g.durationMinutes,
    ...(g.srDelta !== undefined ? { srDelta: g.srDelta } : {}),
    ...(g.finalScore !== undefined ? { finalScore: g.finalScore } : {}),
    ...(flags ? { flags } : {}),
    ...(measuredGrades ? { measuredGrades } : {}),
  };
}

/** Read-only auto-grades for the active measured targets on one match (Review display). */
function measuredGradesFor(g: GameRecord, targets: AuthoredTarget[]): MatchRow['measuredGrades'] {
  if (!targets.length) return undefined;
  const out: NonNullable<MatchRow['measuredGrades']> = {};
  for (const t of targets) {
    const res = evaluateMeasured(g, t);
    out[t.id] = res ? { grade: res.grade, value: res.value } : 'no-stat';
  }
  return out;
}

/**
 * Enrich active, non-archived authored targets with the staleness inputs the
 * renderer needs: when they became active (`activatedAt`, defaulting to
 * `createdAt`) and how many matches have been played since — counted over
 * UNFILTERED competitive history so a narrow dashboard range can't suppress the
 * "getting stale" nudge. Inactive/archived/sample targets pass through untouched.
 */
function withStaleness(
  summaries: TargetSummary[],
  authored: AuthoredTarget[],
  all: GameRecord[],
): TargetSummary[] {
  if (!authored.length) return summaries;
  const byId = new Map(authored.map((t) => [t.id, t]));
  return summaries.map((s) => {
    const t = byId.get(s.id);
    if (!t || !s.isActive || s.archivedAt) return s;
    const activatedAt = t.activatedAt ?? t.createdAt;
    const matchesSinceActive = all.reduce((n, g) => (g.timestamp >= activatedAt ? n + 1 : n), 0);
    return { ...s, activatedAt, matchesSinceActive };
  });
}

/** Most-played account name — used for the Overview greeting. */
function topAccount(games: GameRecord[]): string {
  return byAccount(games)[0]?.key ?? 'Player';
}

const ROLES: Role[] = ['tank', 'damage', 'support', 'openQ'];

/**
 * The user's real rank for `account`: the calculated rank of the active Role
 * filter when it names an anchored role, otherwise its most-played *anchored*
 * role. Undefined when that account has no rank anchor — the caller falls back
 * to the winrate heuristic. This is what makes the sidebar/KPI reflect the rank
 * the user set in Settings instead of a number derived from winrate, and lets a
 * Role filter re-point it to whichever role you're looking at.
 */
function primaryRankOf(
  all: GameRecord[],
  anchors: RankAnchorMap | undefined,
  account: string,
  roleFilter?: string,
): DashboardData['primaryRank'] {
  if (!anchors) return undefined;
  const anchored = ROLES.filter((role) => anchors[rankKey(account, role)]);
  if (!anchored.length) return undefined;
  const plays = (role: Role): number => all.reduce((n, g) => (g.account === account && g.role === role ? n + 1 : n), 0);
  const mostPlayed = [...anchored].sort((a, b) => plays(b) - plays(a))[0];
  // Honor an active Role filter that has an anchor here; else most-played.
  const filtered = anchored.find((r) => r === roleFilter);
  const role = filtered ?? mostPlayed;
  const rank = currentRank(all, anchors, account, role);
  if (!rank) return undefined;
  return {
    account, role,
    tier: rank.tier, division: rank.division, progressPct: rank.progressPct,
    protected: rank.protected, needsReanchor: rank.needsReanchor,
  };
}

const distinct = <T>(arr: T[]): T[] => [...new Set(arr)];
