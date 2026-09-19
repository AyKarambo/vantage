/**
 * The dashboard view-model: turns raw games + filters into the exact payload the
 * renderer consumes. Pure and Electron-free, so it is unit-testable and can also
 * drive the browser preview harness. The main process only wires it to IPC.
 */
import {
  byAccount, byHero, byMap, byRole, byGroupSize, byDuration, scoreSplits, bySessionPosition, byTimeOfDay, calendar, currentSession, dayKey,
  focusBy, focusEntries, focusGamesFor, focusTrend, heroForm, heroStats, linkFocusTargets, performanceStats, sessionDebrief, sessionHistory, streak, streakStats,
  trend, rollingWinrate, windowCompare, winLoss, groupBy, srSum,
  type GameRecord,
} from './analytics';
import { isCompetitive } from './matchFilter';
import { playerDirectory } from './playerIndex';
import { DEFAULT_MASTER_DATA, makeMapActive, makeMapMode, type MapModeResolver } from './masterData';
import { mentalSummary, rowFlags } from './mental';
import { mentalCosts, tiltBySessionPosition, tiltTrend } from './mentalAnalytics';
import { progression } from './progression';
import { buildTargets, activeMeasuredTargets, measuredGradesForMatch, type AuthoredTarget, type TargetSummary } from './targets';
import { DEFAULT_GRADING_SETTINGS, type GradingSettings } from './gradingSettings';
import { DEFAULT_STALENESS, type StalenessSettings } from './staleness';
import { DEFAULT_BREAK_REMINDER, type BreakReminderSettings } from './breakReminder';
import { DEFAULT_READINESS, safeReadiness, type ReadinessSettings } from './readiness';
import { DEFAULT_SESSION_SETTINGS, type SessionSettings } from './sessionSettings';
import { currentRank, rankKey, rankSeries, rankToPoints, type RankAnchorMap, type RankSeriesPoint } from './rank';
import { hasDrifted, isAwaitingRank, resetBoundaries, runProgress, suppressedMatchIds, type PlacementRun } from './placements';
import { seasonsForData, seasonWindowById } from './season';
import type { Role, Result } from './model';
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
  /**
   * Tracked placement runs. Open ones make their counted matches contribute no
   * ladder movement (Overwatch shows no ±% during placements), and every run —
   * open or completed — becomes a {@link DashboardData.placements} summary so
   * rank surfaces can say `Placements N/10` instead of a rank the player
   * doesn't have.
   */
  placementRuns?: PlacementRun[];
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
  const isMapActive = makeMapActive(masterData.maps);
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
  // Scoped to the selected account when one is active, else the one most recently
  // played, so switching accounts (and just playing another account) both re-point
  // the rank — the corner chip is "what am I doing right now", not "where do I have
  // the most history". Falls back to topAccount's 'Player' placeholder only when
  // there are no games at all (mostRecentAccount has nothing to pick from then).
  const primaryAccount = filters.account && filters.account !== 'all'
    ? filters.account
    : mostRecentAccount(all) ?? topAccount(all);
  // Matches inside an OPEN placement run contribute no ladder movement: the game
  // shows no ±% during placements, so any delta recorded against them (a
  // backdated match, say) must lie dormant until the run completes or is
  // cancelled. Derived once here and shared by both rank readers below.
  const placementRuns = manual?.placementRuns ?? [];
  const suppressed = suppressedMatchIds(all, placementRuns);
  const primaryRank = primaryRankOf(all, manual?.rankAnchors, primaryAccount, filters.role, suppressed);
  // Per-account rank for the sidebar's account-switcher popover — the account's
  // most-recently-played anchored role, no movement (the arrow is Overview-KPI-only).
  const accountRanks = accountRanksOf(all, manual?.rankAnchors, suppressed);
  // EVERY anchored (account, role)'s rank — accountRanks above picks one role per
  // account; the switcher's expanded per-role listing needs all of them, and
  // computing it here (once, alongside accountRanks) keeps the renderer a thin
  // reader instead of re-deriving rank math from raw history.
  const accountRoleRanks = accountRoleRanksOf(all, manual?.rankAnchors, suppressed);
  // Rank over time (C1) — one series per anchored (account, role) that has at
  // least one competitive match in the FILTERED range, keyed like every other
  // rank map here. The walk itself always runs over the full `all` history
  // (a ladder position depends on everything before it); only the plotted
  // points are narrowed to the active range, via the same filtered-games id
  // set every other "in range" read uses.
  const rankTrend = rankTrendOf(all, games, manual?.rankAnchors, suppressed, resetBoundaries(placementRuns));
  const placements = placementRuns.map((run) => {
    const { counted, target, latestPrediction, countedMatchIds } = runProgress(all, run);
    return {
      account: run.account,
      role: run.role,
      counted,
      target,
      ...(latestPrediction ? { latestPrediction } : {}),
      completed: run.completedAt !== undefined,
      drifted: hasDrifted(all, run),
      awaitingRank: isAwaitingRank(all, run),
      countedMatchIds,
    };
  });
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

  // The comparison window immediately before the active one (C3) — same
  // account/role scope as `games`, a shifted date range. `undefined` on
  // "All time" (there's nothing before everything) or when the active
  // season has no addressable predecessor for this data.
  const previousRange = previousDateRange(all, filters, seasonStartsList, Date.now());
  const previous: DashboardData['previous'] = previousRange
    ? (() => {
      let prevGames = all.filter((g) => g.timestamp >= previousRange.start && g.timestamp < previousRange.end);
      if (filters.account && filters.account !== 'all') prevGames = prevGames.filter((g) => g.account === filters.account);
      if (filters.role && filters.role !== 'all') prevGames = prevGames.filter((g) => g.role === filters.role);
      return {
        label: previousRange.label,
        overall: winLoss(prevGames),
        byRole: byRole(prevGames),
        byMapType: groupBy(prevGames, (g) => mapModeOf(g.map), { suppressed }),
        heroStats: heroStats(prevGames, { mapModeOf, suppressed }),
      };
    })()
    : undefined;
  // C5: account/role-scoped but NOT date-scoped (see bySeasonOf) — a real
  // "how did each season go" read, computed once here rather than the
  // renderer looping setFilter({ days: { season } }) ten times.
  let accountRoleGames = all;
  if (filters.account && filters.account !== 'all') accountRoleGames = accountRoleGames.filter((g) => g.account === filters.account);
  if (filters.role && filters.role !== 'all') accountRoleGames = accountRoleGames.filter((g) => g.role === filters.role);
  const bySeason = bySeasonOf(accountRoleGames, seasonStartsList, suppressed, Date.now());
  const heroStatsWithForm = heroStats(games, { mapModeOf, suppressed }).map((r) => {
    // Trend/form (H6) reuse Focus's dimension-agnostic reads, joined onto
    // each hero row here rather than inside heroStats() — that stays a pure
    // per-game fold with no notion of "this hero's own games" to re-filter for.
    const heroGames = focusGamesFor(games, 'hero', r.hero);
    const trend = focusTrend(heroGames);
    return { ...r, ...(trend ? { trend } : {}), form: heroForm(heroGames) };
  });
  // Δ WR / Δ games vs. the previous window (C3), joined by hero name — a
  // hero absent from the previous window gets its full game count as the
  // delta (it's new this window) but no winrate delta (nothing to compare
  // against).
  const heroStatsWithDelta = previous
    ? heroStatsWithForm.map((r) => {
      const prev = previous.heroStats.find((p) => p.hero === r.hero);
      return {
        ...r,
        deltaGames: r.games - (prev?.games ?? 0),
        ...(prev && prev.wins + prev.losses > 0 && r.wins + r.losses > 0
          ? { deltaWinrate: Math.round((r.winrate - prev.winrate) * 1000) / 10 }
          : {}),
      };
    })
    : heroStatsWithForm;

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
    extremes: streakStats(games),
    progression: progression(games),
    ...(primaryRank ? { primaryRank } : {}),
    accountRanks,
    accountRoleRanks,
    rankTrend,
    placements,
    session: currentSession(sessionGames, Date.now(), sessionSettings.gapMinutes),
    // Every past sitting (S4), same account scope + gap as `session` above, capped like every other list.
    sessions: sessionHistory(sessionGames, sessionSettings.gapMinutes, suppressed).slice(0, ROW_CAP),
    byRole: byRole(games),
    byAccount: byAccount(games),
    // Net SR (C2) alongside net wins — the games/wins tally is unaffected;
    // only the SR sum excludes placement-run matches, whose swing isn't
    // comparable to a normal match's (same stance sessionHistory already takes).
    byMap: byMap(games, { suppressed }),
    byMapType: groupBy(games, (g) => mapModeOf(g.map), { suppressed }),
    byHero: byHero(games).filter((h) => h.games >= 2).slice(0, 14),
    // Party size, game length and score-margin splits (H9) — previously
    // captured/stored but never surfaced.
    byGroupSize: byGroupSize(games, { suppressed }),
    byDuration: byDuration(games, mapModeOf, { suppressed }),
    scoreSplits: scoreSplits(games, mapModeOf),
    trend: rollingWinrate(trend(games, weekly ? 'week' : 'day'), weekly ? 'week' : 'day'),
    // Momentum (C6): the same trailing-window comparison in weeks once the
    // chart itself switches to weekly buckets, so the strip and the chart
    // it sits above agree on what "recent" means.
    momentum: windowCompare(games, Date.now(), weekly ? 28 : 7),
    ...(previous ? { previous } : {}),
    bySeason,
    timeOfDay: byTimeOfDay(games),
    // Positions are numbered over the person's whole history — a role/date
    // filter must scope which games are counted, not renumber their sittings.
    sessionPosition: bySessionPosition(all, { include: new Set(games.map((g) => g.matchId)) }),
    calendar: calendar(games, 35),
    focusMaps: focusBy(games, (g) => g.map).slice(0, 8),
    // The Focus screen's cross-dimension hub (H1: maps, heroes AND roles):
    // ranked/trended over the FILTERED range (the list describes what you
    // see), while the since-flagged progress of a linked target runs over the
    // unfiltered history (like staleness — it is about the target's
    // lifetime, not the current filter). `mode` (H2) is resolved here, not in
    // focusEntries, since it needs the master-data map catalog focus.ts has
    // no business depending on.
    focusItems: linkFocusTargets(focusEntries(games, { isMapActive, suppressed }), authoredTargets, all)
      .map((e) => (e.dimension === 'map' ? { ...e, mode: mapModeOf(e.key) } : e)),
    // No games/row floor (H5) — the Heroes screen's own min-games chips (default
    // 1+) are the real filter, and its table wrap already scrolls; a hard-coded
    // 2-game floor + 24-row slice here used to quietly drop 1-game heroes from
    // both the table and the palette's Hero entries before the renderer ever saw them.
    heroStats: heroStatsWithDelta,
    matches: recentMatches(games, mapModeOf, activeMeasured, margin, suppressed),
    // The TRUE filtered count, uncapped (M1) — `matches` itself silently caps
    // at ROW_CAP, but the Matches header, the detail stepper and the status
    // bar all used to state or imply the uncapped number regardless, so a
    // busy range (150+ games) read a header count that flatly disagreed with
    // the status bar right next to it.
    matchesTotal: games.length,
    // A small, cheap slice for the command palette's 'Player' items (M5) — the
    // full player list is a filter-scoped IPC round trip (`playerList`); this
    // reuses the SAME pure aggregation already paid for on the Players screen,
    // over the same filtered `games`, so Ctrl+K can show a handful of players
    // synchronously without a second fetch.
    recentPlayers: playerDirectory(games).players.slice(0, 30),
    mental: mentalSummary(games),
    mentalCosts: mentalCosts(games),
    tiltTrend: tiltTrend(games),
    // Same convention as sessionPosition above: number over the whole history,
    // aggregate only the filtered games.
    tiltBySession: tiltBySessionPosition(all, { include: new Set(games.map((g) => g.matchId)) }),
    performance: performanceStats(games),
    targets: withStaleness(buildTargets(games, demo.active, manual?.targets, margin), authoredTargets, all),
    reviewInbox: pending.slice(0, ROW_CAP).map((g) => toMatchRow(g, mapModeOf, activeMeasured, margin, suppressed)),
    pendingReviews: pending.length,
    pendingReviewsRecent: pendingReviewsRecent(pending),
    pendingMatches,
    breakReminder: manual?.breakReminder ?? DEFAULT_BREAK_REMINDER,
    staleness: manual?.staleness ?? DEFAULT_STALENESS,
    // Readiness is a per-person verdict → computed over the UNFILTERED
    // (but now competitive-only, plan D1) history, like reviewInbox/recap.
    // The target context feeds the target-focus dampener (active targets are
    // not derivable from GameRecord alone); the rank anchors feed the
    // rank-gated undertraining nudge, masked by the same `suppressed` set every
    // other rank surface uses so a track mid-placements can't read as stagnant.
    // safeReadiness never throws, so a readiness bug can never blank the whole
    // dashboard.
    readiness: safeReadiness(all, Date.now(), {
      targets: manual?.targets ?? [],
      rankAnchors: manual?.rankAnchors,
      suppressed,
    }),
    readinessSettings: manual?.readiness ?? DEFAULT_READINESS,
    sessionSettings,
    gradingSettings: grading,
    totalGamesAllTime: all.length,
    masterData,
    ...(recapOf(sessionGames, authoredTargets, sessionSettings.gapMinutes, margin) ?? {}),
  };
}

/**
 * The trailing sitting's debrief (S3), as a spreadable fragment — only once
 * it has CLOSED (a still-open sitting is already the sidebar's live "Current
 * session" card; showing both would double up the same numbers). Same
 * account scope as `session` above — a real sitting doesn't span accounts.
 */
function recapOf(
  sessionGames: GameRecord[],
  authoredTargets: AuthoredTarget[],
  gapMinutes: number,
  margin?: number,
): { recap: NonNullable<DashboardData['recap']> } | null {
  const debrief = sessionDebrief(sessionGames, authoredTargets, Date.now(), gapMinutes, margin);
  return debrief?.closed ? { recap: debrief } : null;
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
 * The `[start, end)` date range immediately before the active filter's own
 * window (C3) — the counterpart every KPI/Heroes/Trends comparison reads
 * against. A season filter compares against the previous entry in
 * {@link seasonsForData}'s own addressable list for THIS data (so a season
 * with zero games in it is a legitimate, present "previous" — silence,
 * not absence); an N-day filter compares `[now−2N, now−N)` against `[now−N,
 * now]`. `undefined` on "All time" (there's nothing before everything) or
 * when the active season isn't addressable or has no earlier entry.
 */
export function previousDateRange(
  all: GameRecord[],
  filters: DashboardFilters,
  seasonStartsList: readonly number[] | undefined,
  now: number,
): { start: number; end: number; label: string } | undefined {
  if (!filters.days || filters.days === 'all') return undefined;
  if (typeof filters.days === 'object') {
    const seasonId = filters.days.season;
    const list = seasonsForData(all.map((g) => g.timestamp), now, seasonStartsList);
    const i = list.findIndex((w) => w.id === seasonId);
    const prev = i !== -1 ? list[i + 1] : undefined;
    return prev ? { start: prev.start, end: prev.end, label: prev.label } : undefined;
  }
  const n = filters.days;
  const dayMs = 86_400_000;
  return { start: now - 2 * n * dayMs, end: now - n * dayMs, label: `the previous ${n} days` };
}

/**
 * Win/loss per season, newest first (C5) — "how did each season go" answered
 * without turning it into ten filter changes and ten memorised numbers. Scoped
 * by account/role like every other breakdown but NOT by the date/season filter
 * itself (a by-season view of one already-picked season is pointless) — same
 * `{...filters, days: 'all'}` override `pendingReviewMatches` already uses.
 */
function bySeasonOf(
  accountRoleGames: GameRecord[],
  seasonStartsList: readonly number[] | undefined,
  suppressed: ReadonlySet<string>,
  now: number,
): DashboardData['bySeason'] {
  return seasonsForData(accountRoleGames.map((g) => g.timestamp), now, seasonStartsList).map((w) => {
    const seasonGames = accountRoleGames.filter((g) => g.timestamp >= w.start && g.timestamp < w.end);
    const wl = winLoss(seasonGames);
    const sr = srSum(seasonGames.map((game) => ({ game, weight: 1 })), suppressed);
    return { id: w.id, label: w.label, games: wl.games, wins: wl.wins, losses: wl.losses, winrate: wl.winrate, ...sr };
  });
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

/** How far back {@link pendingReviewsRecent} counts (R1) — matches the badge's
 *  "things to do this week" framing, not the app's session-gap convention:
 *  a queue someone hasn't opened in days is exactly what the badge exists to
 *  surface, so it can't be scoped to "the current sitting". */
export const RECENT_REVIEW_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * Of `pendingReviewMatches`' result, how many landed in the last 7 days — the
 * sidebar badge's count (R1). The uncapped lifetime total only ever grows for
 * an active player, which stops meaning "things to do tonight" and trains
 * people to ignore it; this is the number that still does.
 */
export function pendingReviewsRecent(pending: readonly GameRecord[], now = Date.now()): number {
  const cutoff = now - RECENT_REVIEW_WINDOW_MS;
  return pending.filter((g) => g.timestamp >= cutoff).length;
}

/**
 * Of `pendingReviewMatches`' already role/account-scoped rows, the ones a bulk
 * "Mark older games as no-read" at this age cutoff would affect (R1) — the
 * SAME function backs the live preview count and the actual write, so they
 * can never disagree. `minAgeDays <= 0` means no cutoff: every pending row.
 */
export function eligibleForNoRead(
  pending: readonly GameRecord[],
  minAgeDays: number,
  now = Date.now(),
): GameRecord[] {
  if (minAgeDays <= 0) return [...pending];
  const cutoff = now - minAgeDays * 24 * 60 * 60_000;
  return pending.filter((g) => g.timestamp <= cutoff);
}

/** Row cap keeps list payloads bounded; counts (e.g. pendingReviews) never are. */
const ROW_CAP = 150;
/** Exposed for `matchesPage` (M1) — the "Show older games" page shares the same page size. */
export { ROW_CAP as MATCHES_PAGE_SIZE };

/**
 * Filter (older than a cutoff, when given) → sort newest-first → cap — the
 * "Show older games" page behind `matches.ts`'s own row cap (M1). Mirrors
 * `selectPlayers`' filter → sort → cap shape: `matched` is taken from the
 * SAME sorted array the page is sliced from, so a page and its denominator
 * can never disagree.
 */
export function selectMatches(
  games: readonly GameRecord[],
  sel: { before?: number; limit: number },
): { rows: GameRecord[]; matched: number } {
  const before = sel.before;
  const eligible = before != null ? games.filter((g) => g.timestamp < before) : [...games];
  eligible.sort((a, b) => b.timestamp - a.timestamp);
  return { rows: eligible.slice(0, sel.limit), matched: eligible.length };
}

/** Matches' in-list filter row (M2) — result and map-type are multi-select (empty = no restriction), `search` matches map, hero or account (case-insensitive substring, mirrors `selectPlayers`'). */
export interface MatchesTextFilter {
  results?: readonly Result[];
  mapTypes?: readonly string[];
  search?: string;
}

/**
 * Applied BEFORE `selectMatches`' before/sort/cap — result/map-type/search
 * narrow WHICH games are eligible for a page, `selectMatches` then picks
 * which slice of them. Needs `mapModeOf` because map type isn't a stored
 * `GameRecord` field, only ever resolved on read (same resolver every other
 * map-type read in this module already uses).
 */
export function matchesFilter(
  games: readonly GameRecord[],
  mapModeOf: MapModeResolver,
  f: MatchesTextFilter,
): GameRecord[] {
  let out: readonly GameRecord[] = games;
  if (f.results?.length) out = out.filter((g) => f.results!.includes(g.result));
  if (f.mapTypes?.length) out = out.filter((g) => f.mapTypes!.includes(mapModeOf(g.map)));
  if (f.search) {
    const q = f.search.trim().toLowerCase();
    if (q) {
      out = out.filter((g) =>
        g.map.toLowerCase().includes(q)
        || g.account.toLowerCase().includes(q)
        || g.heroes.some((h) => h.toLowerCase().includes(q)));
    }
  }
  return [...out];
}

/** UTC month abbreviations, no `Intl`/locale dependency — {@link matchSearchFilter} stays deterministic for tests and CI. */
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A timestamp's searchable text: the ISO `dayKey` plus a friendlier "sep 18" pair. */
function dateSearchText(ts: number): string {
  const d = new Date(ts);
  return `${dayKey(ts)} ${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Full-text match search (M5) — map, hero, account, a roster player's
 * battleTag, or the date, matched as a case-insensitive substring. Backs the
 * command palette's reach past its own snapshot slice (30 most recent rows):
 * unlike {@link matchesFilter}, this runs over the FULL scoped history the
 * caller hands it, not just what's already loaded in the renderer.
 */
export function matchSearchFilter(games: readonly GameRecord[], q: string): GameRecord[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  return games.filter((g) =>
    g.map.toLowerCase().includes(query)
    || g.account.toLowerCase().includes(query)
    || g.heroes.some((h) => h.toLowerCase().includes(query))
    || (g.roster ?? []).some((p) => (p.battleTag ?? '').toLowerCase().includes(query))
    || dateSearchText(g.timestamp).includes(query));
}

function recentMatches(games: GameRecord[], mapModeOf: MapModeResolver, activeMeasured: AuthoredTarget[] = [], margin?: number, suppressed?: ReadonlySet<string>): MatchRow[] {
  return selectMatches(games, { limit: ROW_CAP }).rows
    .map((g) => toMatchRow(g, mapModeOf, activeMeasured, margin, suppressed));
}

export function toMatchRow(g: GameRecord, mapModeOf: MapModeResolver, activeMeasured: AuthoredTarget[] = [], margin?: number, suppressed?: ReadonlySet<string>): MatchRow {
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
    // A match inside an OPEN placement run has no settled ±% — Overwatch shows
    // none during placements, and the rank engine already ignores whatever is
    // stored (see ../placements/engine suppressedMatchIds). Masking it here too
    // stops the Matches list asserting a number every rank surface is
    // deliberately not using. Masked at read time, never erased: cancel the run
    // and the stored value is back.
    ...(g.srDelta !== undefined && !suppressed?.has(g.matchId) ? { srDelta: g.srDelta } : {}),
    // Masked by the same set, and for the same reason: `rankAtStart` only ever
    // exists alongside a ±%, so showing the snapshot while hiding the change it
    // belongs to would leave the row asserting half a story.
    ...(g.rankAtStart !== undefined && !suppressed?.has(g.matchId) ? { rankAtStart: g.rankAtStart } : {}),
    ...(g.finalScore !== undefined ? { finalScore: g.finalScore } : {}),
    ...(g.performance !== undefined ? { performance: g.performance } : {}),
    ...(g.groupSize !== undefined ? { groupSize: g.groupSize } : {}),
    ...(flags ? { flags } : {}),
    ...(measuredGrades ? { measuredGrades } : {}),
    ...(targetGrades ? { targetGrades } : {}),
    reviewed: g.review != null,
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

/**
 * The account of the single most recently played game, or undefined with no
 * games at all. Deliberately a DIFFERENT heuristic from {@link topAccount}
 * (most games, not most recent) — that one still drives the Overview greeting,
 * which is about who you are, not what you last did; this one drives the
 * corner rank chip, which is about what you last did.
 */
function mostRecentAccount(games: GameRecord[]): string | undefined {
  return games.reduce<GameRecord | undefined>(
    (latest, g) => (!latest || g.timestamp > latest.timestamp ? g : latest),
    undefined,
  )?.account;
}

const ROLES: Role[] = ['tank', 'damage', 'support', 'openQ'];

/** The most recently played timestamp for `account`/`role` in `all`, or -Infinity if never played. */
function lastPlayedAt(all: GameRecord[], account: string, role: Role): number {
  return all.reduce((ts, g) => (g.account === account && g.role === role && g.timestamp > ts ? g.timestamp : ts), -Infinity);
}

/**
 * The user's real rank for `account`: the calculated rank of the active Role
 * filter when it names an anchored role, otherwise its most RECENTLY PLAYED
 * *anchored* role. Undefined when that account has no rank anchor — the caller
 * falls back to the winrate heuristic. This is what makes the sidebar/KPI
 * reflect the rank the user set in Settings instead of a number derived from
 * winrate, and lets a Role filter re-point it to whichever role you're looking
 * at. Recency, not volume: the corner chip and the KPI are both "what's my rank
 * right now", so a track you just started placing on should outrank one you
 * happen to have thousands of old games on.
 */
function primaryRankOf(
  all: GameRecord[],
  anchors: RankAnchorMap | undefined,
  account: string,
  roleFilter?: string,
  suppressed?: ReadonlySet<string>,
): DashboardData['primaryRank'] {
  if (!anchors) return undefined;
  const anchored = ROLES.filter((role) => anchors[rankKey(account, role)]);
  if (!anchored.length) return undefined;
  const mostRecent = [...anchored].sort((a, b) => lastPlayedAt(all, account, b) - lastPlayedAt(all, account, a))[0];
  // Honor an active Role filter that has an anchor here; else most recently played.
  const filtered = anchored.find((r) => r === roleFilter);
  const role = filtered ?? mostRecent;
  const anchor = anchors[rankKey(account, role)];
  const rank = currentRank(all, anchors, account, role, undefined, suppressed);
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
 * The per-account rank shown wherever only ONE line per account fits (the
 * sidebar chip, the greeting): each account's most-recently-played anchored
 * role's calculated rank (no active Role filter, no movement arrow). Only
 * accounts with a rank anchor appear; the "All accounts" scope has no single
 * rank and is simply absent from the map.
 */
function accountRanksOf(
  all: GameRecord[],
  anchors: RankAnchorMap | undefined,
  suppressed?: ReadonlySet<string>,
): DashboardData['accountRanks'] {
  const out: DashboardData['accountRanks'] = {};
  if (!anchors) return out;
  for (const account of distinct(all.map((g) => g.account))) {
    const r = primaryRankOf(all, anchors, account, undefined, suppressed);
    if (r) out[account] = { tier: r.tier, division: r.division, progressPct: r.progressPct, protected: r.protected };
  }
  return out;
}

/**
 * EVERY anchored (account, role)'s calculated rank — unlike {@link
 * accountRanksOf}, which picks one role per account, this keeps all of them.
 * Feeds the account-switcher's expanded per-role listing, so an account with
 * several tracked roles shows each one instead of a single aggregate line.
 */
function accountRoleRanksOf(
  all: GameRecord[],
  anchors: RankAnchorMap | undefined,
  suppressed?: ReadonlySet<string>,
): DashboardData['accountRoleRanks'] {
  const out: DashboardData['accountRoleRanks'] = {};
  if (!anchors) return out;
  for (const account of distinct(all.map((g) => g.account))) {
    for (const role of ROLES) {
      const anchor = anchors[rankKey(account, role)];
      if (!anchor) continue;
      const rank = currentRank(all, anchors, account, role, undefined, suppressed);
      if (!rank) continue;
      (out[account] ??= {})[role] = {
        tier: rank.tier, division: rank.division, progressPct: rank.progressPct, protected: rank.protected,
      };
    }
  }
  return out;
}

const distinct = <T>(arr: T[]): T[] => [...new Set(arr)];

/**
 * {@link DashboardData.rankTrend} (C1): one {@link rankSeries} per anchored
 * (account, role) track that has at least one competitive match in `inRange`
 * — tracks with an anchor but nothing played in the active window are simply
 * absent, same convention as every other "in range" map here.
 */
function rankTrendOf(
  all: GameRecord[],
  inRange: GameRecord[],
  anchors: RankAnchorMap | undefined,
  suppressed: ReadonlySet<string>,
  resetBefore: ReadonlyMap<string, number>,
): DashboardData['rankTrend'] {
  const out: DashboardData['rankTrend'] = {};
  if (!anchors) return out;
  const tracks = new Map<string, { account: string; role: Role }>();
  for (const g of inRange) {
    const key = rankKey(g.account, g.role);
    if (!tracks.has(key) && anchors[key]) tracks.set(key, { account: g.account, role: g.role });
  }
  const inRangeIds = new Set(inRange.map((g) => g.matchId));
  for (const [key, { account, role }] of tracks) {
    const series = rankSeries(all, anchors, account, role, { suppressed, resetBefore })
      .filter((p) => inRangeIds.has(p.matchId));
    if (series.length) out[key] = series;
  }
  return out;
}
