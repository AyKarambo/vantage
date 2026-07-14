/**
 * The dashboard view-model: turns raw games + filters into the exact payload the
 * renderer consumes. Pure and Electron-free, so it is unit-testable and can also
 * drive the browser preview harness. The main process only wires it to IPC.
 */
import {
  byAccount, byHero, byMap, byRole, bySessionPosition, byTimeOfDay, calendar, currentSession,
  focusBy, focusEntries, heroStats, linkFocusTargets, performanceStats, sessionRecap, streak,
  trend, winLoss, groupBy,
  type GameRecord,
} from './analytics';
import { isCompetitive } from './matchFilter';
import { DEFAULT_MASTER_DATA, makeMapMode, type MapModeResolver } from './masterData';
import { mentalSummary, rowFlags } from './mental';
import { mentalCosts, tiltBySessionPosition, tiltTrend } from './mentalAnalytics';
import { progression } from './progression';
import { buildTargets, activeMeasuredTargets, measuredGradesForMatch, type AuthoredTarget, type TargetSummary } from './targets';
import { DEFAULT_GRADING_SETTINGS, type GradingSettings } from './gradingSettings';
import { DEFAULT_STALENESS, type StalenessSettings } from './staleness';
import { DEFAULT_BREAK_REMINDER, type BreakReminderSettings } from './breakReminder';
import { DEFAULT_READINESS, safeReadiness, type ReadinessSettings } from './readiness';
import { DEFAULT_SESSION_SETTINGS, type SessionSettings } from './sessionSettings';
import { currentRank, rankKey, rankToPoints, type RankAnchorMap } from './rank';
import { seasonsForData, seasonWindowById } from './season';
import type { Role } from './model';
import type { DemoContext } from './demoPreference';
import type { DashboardData, DashboardFilters, MatchRow, MasterData, PendingMatch } from '../shared/contract';

/** Manual (◎) data the player authored, threaded in from the main-process store. */
export interface ManualData {
  targets?: AuthoredTarget[];
  /** Effective break-reminder settings; defaults when absent. */
  breakReminder?: BreakReminderSettings;
  /** Effective target-staleness thresholds; defaults when absent. */
  staleness?: StalenessSettings;
  /** Effective readiness feature settings; defaults when absent. */
  readiness?: ReadinessSettings;
  /** Effective "Current session" gap threshold; defaults when absent. */
  sessionSettings?: SessionSettings;
  /** Effective measured-grade settings (partial-credit margin); defaults when absent. */
  grading?: GradingSettings;
  /** Per-(account, role) rank anchors, so the "real" primary rank can be computed. */
  rankAnchors?: RankAnchorMap;
}

export function computeDashboard(
  allGames: GameRecord[],
  filters: DashboardFilters,
  demo: DemoContext,
  manual?: ManualData,
  masterData: MasterData = DEFAULT_MASTER_DATA,
  // Held "needs result" matches (no GEP outcome) — assembled by the main process
  // from the SEPARATE pending store and threaded through unchanged. Pure here:
  // this function never reads history for them, so they can't touch analytics.
  pendingMatches: PendingMatch[] = [],
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
  // Per-account rank for the sidebar's account-switcher popover — the account's
  // most-played anchored role, no movement (the arrow is Overview-KPI-only).
  const accountRanks = accountRanksOf(all, manual?.rankAnchors);
  // Long ranges (all-time, >90d) bucket the trend by week; a season (~63d) and
  // shorter windows stay daily, matching the pre-'season' behavior of the old 90.
  const days = filters.days ?? 30;
  const weekly = days === 'all' || (typeof days === 'number' && days > 90);
  // The review inbox honors Role/account (an ungraded game outside the active
  // role/account scope hides, same as everywhere else) but is exempt from the
  // Season/day-window value — see pendingReviewMatches.
  const pending = pendingReviewMatches(allGames, filters, seasonStartsList);
  // Active measured targets auto-grade every inbox row (shown read-only on Review);
  // the same active set drives the staleness cue, counted over unfiltered history.
  const authoredTargets = manual?.targets ?? [];
  const activeMeasured = activeMeasuredTargets(authoredTargets);
  // The user's partial-credit margin drives every measured-grade computation
  // below (match rows, review inbox, target summaries/sparks) from one value.
  const grading = manual?.grading ?? DEFAULT_GRADING_SETTINGS;
  const margin = grading.partialMargin;
  // The "Current session" card is scoped by account (a real sitting doesn't
  // span two different tracked accounts) but NOT by role/date — a role switch
  // or an unrelated date-range filter must not fragment or hide an in-progress
  // sitting. Mirrors the primaryAccount ternary above, keeping the account's
  // games rather than resolving to a single account name.
  const sessionGames = filters.account && filters.account !== 'all'
    ? all.filter((g) => g.account === filters.account)
    : all;
  const sessionSettings = manual?.sessionSettings ?? DEFAULT_SESSION_SETTINGS;

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
    accountRanks,
    session: currentSession(sessionGames, Date.now(), sessionSettings.gapMinutes),
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
    // The Focus screen's cross-dimension hub: ranked/trended over the FILTERED
    // range (the list describes what you see), while the since-flagged progress
    // of a linked target runs over the unfiltered history (like staleness —
    // it is about the target's lifetime, not the current filter).
    focusItems: linkFocusTargets(focusEntries(games), authoredTargets, all),
    heroStats: heroStats(games).filter((h) => h.games >= 2).slice(0, 24),
    matches: recentMatches(games, mapModeOf, activeMeasured, margin),
    mental: mentalSummary(games),
    mentalCosts: mentalCosts(games),
    tiltTrend: tiltTrend(games),
    // Same convention as sessionPosition above: number over the whole history,
    // aggregate only the filtered games.
    tiltBySession: tiltBySessionPosition(all, { include: new Set(games.map((g) => g.matchId)) }),
    performance: performanceStats(games),
    targets: withStaleness(buildTargets(games, demo.active, manual?.targets, margin), authoredTargets, all),
    reviewInbox: pending.slice(0, ROW_CAP).map((g) => toMatchRow(g, mapModeOf, activeMeasured, margin)),
    pendingReviews: pending.length,
    pendingMatches,
    breakReminder: manual?.breakReminder ?? DEFAULT_BREAK_REMINDER,
    staleness: manual?.staleness ?? DEFAULT_STALENESS,
    // Readiness is a per-person verdict → computed over the UNFILTERED
    // (but now competitive-only, plan D1) history, like reviewInbox/recap.
    // The target context feeds the target-focus dampener (active targets are
    // not derivable from GameRecord alone); the rank anchors feed the
    // rank-gated undertraining nudge. safeReadiness never throws, so a
    // readiness bug can never blank the whole dashboard.
    readiness: safeReadiness(all, Date.now(), { targets: manual?.targets ?? [], rankAnchors: manual?.rankAnchors }),
    readinessSettings: manual?.readiness ?? DEFAULT_READINESS,
    sessionSettings,
    gradingSettings: grading,
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

/**
 * Tracked games with no saved review, scoped by Role/account like every other
 * screen — but deliberately exempt from the Season/day-window value, which is
 * forced to `'all'` regardless of what the caller passes. The app's default
 * day-window (30 days) would otherwise silently hide exactly the backlog the
 * Review screen's bulk "Ignore all" exists to help clear. The explicit,
 * off-by-default age cutoff (a renderer-local concern) is the only thing that
 * narrows Review by date. Sorted newest-first; both `reviewInbox` (capped) and
 * a future bulk-ignore computation derive from this same result so they can
 * never disagree.
 */
export function pendingReviewMatches(
  allGames: GameRecord[],
  filters: DashboardFilters,
  seasonStartsList?: readonly number[],
): GameRecord[] {
  const competitive = allGames.filter((g) => isCompetitive(g.gameType));
  return applyFilters(competitive, { ...filters, days: 'all' }, seasonStartsList)
    .filter((g) => !g.review)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/** Row cap keeps list payloads bounded; counts (e.g. pendingReviews) never are. */
const ROW_CAP = 150;

function recentMatches(games: GameRecord[], mapModeOf: MapModeResolver, activeMeasured: AuthoredTarget[] = [], margin?: number): MatchRow[] {
  return [...games]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, ROW_CAP)
    .map((g) => toMatchRow(g, mapModeOf, activeMeasured, margin));
}

function toMatchRow(g: GameRecord, mapModeOf: MapModeResolver, activeMeasured: AuthoredTarget[] = [], margin?: number): MatchRow {
  const flags = rowFlags(g);
  const measuredGrades = activeMeasured.length ? measuredGradesForMatch(g, activeMeasured, margin) : undefined;
  // The player's stored self-grades stay with the match (unlike the live-computed
  // measuredGrades), so the Matches-list "Target grades" field renders these.
  const storedGrades = g.review?.grades;
  const targetGrades = storedGrades && Object.keys(storedGrades).length ? storedGrades : undefined;
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
    ...(g.performance !== undefined ? { performance: g.performance } : {}),
    ...(flags ? { flags } : {}),
    ...(measuredGrades ? { measuredGrades } : {}),
    ...(targetGrades ? { targetGrades } : {}),
  };
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
  const anchor = anchors[rankKey(account, role)];
  const rank = currentRank(all, anchors, account, role);
  if (!rank || !anchor) return undefined;
  return {
    account, role,
    tier: rank.tier, division: rank.division, progressPct: rank.progressPct,
    protected: rank.protected,
    // Net anchor→now movement in ladder %-points (positive = climbed). Measured
    // over the FULL history for this (account, role) — like the rank itself — so
    // it is independent of the active date filter (spec Area A).
    movement: rankToPoints(rank) - rankToPoints(anchor),
  };
}

/**
 * The per-account rank shown in the account-switcher popover: each account's
 * most-played anchored role's calculated rank (no active Role filter, no
 * movement arrow). Only accounts with a rank anchor appear; the "All accounts"
 * scope has no single rank and is simply absent from the map.
 */
function accountRanksOf(
  all: GameRecord[],
  anchors: RankAnchorMap | undefined,
): DashboardData['accountRanks'] {
  const out: DashboardData['accountRanks'] = {};
  if (!anchors) return out;
  for (const account of distinct(all.map((g) => g.account))) {
    const r = primaryRankOf(all, anchors, account);
    if (r) out[account] = { tier: r.tier, division: r.division, progressPct: r.progressPct, protected: r.protected };
  }
  return out;
}

const distinct = <T>(arr: T[]): T[] => [...new Set(arr)];
