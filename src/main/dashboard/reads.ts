import { heroDetail, type GameRecord } from '../../core/analytics';
import { matchDetail } from '../../core/matchDetail';
import { activeMeasuredTargets } from '../../core/targets';
import { playerMatchHistory, playerRecords } from '../../core/playerIndex';
import { computeDashboard, applyFilters } from '../../core/dashboardData';
import { makeMapMode } from '../../core/masterData';
import { isCompetitive } from '../../core/matchFilter';
import { resetBoundaries, suppressedMatchIds } from '../../core/placements';
import { enteringRanks, rankKey } from '../../core/rank';
import type {
  DashboardFilters, DashboardData, HeroDetail, MatchDetail, PlayerMatchHistory, PlayerRecord,
} from '../../shared/contract';
import type { DataProvider } from './provider';

/**
 * The filter-scoped READ compositions over a {@link DataProvider}, in one place
 * so every consumer resolves them identically.
 *
 * These used to live inline in `ipcHandlers.ts`, which was fine while the
 * renderer was the only caller. It stopped being fine once a second consumer
 * (the MCP bridge) needed the same reads: the competitive-only gate and the
 * season-window resolution are *product invariants*, not handler details, and a
 * second caller re-deriving them would silently drift from what the app shows.
 * Extracting them makes divergence impossible rather than merely unlikely.
 *
 * Deliberately NOT in `core/`: these compose pure core functions against the
 * main-process provider, so they belong to the edge (guardrail 3).
 */

/**
 * Vantage is competitive-only (spec D1): scope a games list down to
 * competitive rows. `computeDashboard` already does this internally for the
 * main dashboard payload; every *other* feed that reads `provider.games()`
 * directly (export, hero drilldown, match detail) must apply the same gate
 * so a non-competitive row already in the DB never surfaces there either.
 */
export function competitiveOnly(games: GameRecord[]): GameRecord[] {
  return games.filter((g) => isCompetitive(g.gameType));
}

/**
 * Every filter-scoped read must resolve a `{ season: id }` filter against the
 * SAME effective season starts computeDashboard uses (so a user-added,
 * off-cadence season resolves to its window instead of silently falling back
 * to the 30-day default). Pulled from the effective master data, exactly as
 * the dashboard payload does.
 */
export function seasonStarts(provider: DataProvider): number[] {
  return provider.effectiveMasterData().seasons.map((s) => s.start);
}

/**
 * The competitive-only history narrowed by the filter bar — the shared basis
 * for the hero drilldown and the Notion export selection.
 */
export function filteredCompetitiveGames(
  provider: DataProvider,
  filters: DashboardFilters | undefined,
): GameRecord[] {
  return applyFilters(competitiveOnly(provider.games()), filters ?? {}, seasonStarts(provider));
}

/** The full dashboard payload for these filters. */
export function dashboardRead(
  provider: DataProvider,
  filters: DashboardFilters | undefined,
): DashboardData {
  return computeDashboard(
    provider.games(),
    filters ?? {},
    provider.demoContext(),
    {
      targets: provider.manualTargets(),
      breakReminder: provider.getBreakReminder(),
      staleness: provider.getStaleness(),
      readiness: provider.getReadiness(),
      sessionSettings: provider.getSessionSettings(),
      grading: provider.getGrading(),
      rankAnchors: provider.rankAnchorMap(),
      placementRuns: provider.placementRuns(),
    },
    provider.effectiveMasterData(),
    // Held "needs result" matches ride on the same payload the Review screen
    // reads — sourced from the SEPARATE pending store, never from history.
    provider.pendingMatches(),
  );
}

/** One hero's drilldown over the filtered, competitive-only history. */
export function heroDetailRead(
  provider: DataProvider,
  hero: string,
  filters: DashboardFilters | undefined,
): HeroDetail {
  // Same catalog-aware map-mode resolver the match detail uses, so an older
  // capture's estimated played time subtracts the right mode's setup locks.
  const mapModeOf = makeMapMode(provider.effectiveMasterData().maps);
  return heroDetail(filteredCompetitiveGames(provider, filters), hero, { mapModeOf });
}

/**
 * Full drill-down for one match; null when the id is unknown.
 *
 * Looked up in the full (competitive-only) history — a row must open even
 * after filters move on; the competitive-estimate CONTEXT is scoped to the
 * current filter set, on top of the same competitive-only gate.
 */
export function matchDetailRead(
  provider: DataProvider,
  matchId: string,
  filters: DashboardFilters | undefined,
): MatchDetail | null {
  const games = competitiveOnly(provider.games());
  const master = provider.effectiveMasterData();
  const mapModeOf = makeMapMode(master.maps);
  const filtered = applyFilters(games, filters ?? {}, master.seasons.map((s) => s.start));
  // Same active-measured set + partial margin the dashboard rows use, so the
  // match-detail Grades card shows calculated grades identically.
  const activeMeasured = activeMeasuredTargets(provider.manualTargets());
  return matchDetail(
    games, matchId, filtered, provider.rankAnchorMap(), mapModeOf, activeMeasured,
    provider.getGrading().partialMargin,
    resetBoundaryFor(provider, games, matchId),
    // The same mask the dashboard applies, so a match inside an open run doesn't
    // report a per-match rank built from ±% every other surface is holding back.
    suppressedMatchIds(games, provider.placementRuns()),
  );
}

/**
 * The rank-reset instant that applies to one match's (account, role), or
 * undefined when that track has never completed a placement run.
 *
 * A COMPLETED run is the boundary: its `startedAt` is where the old ladder
 * stopped meaning anything, so a match before it cannot be reconstructed from
 * the post-placement anchor. An open run is not a boundary — it has written no
 * anchor yet, so the old one still describes the ladder the match was played on.
 */
function resetBoundaryFor(
  provider: DataProvider,
  games: GameRecord[],
  matchId: string,
): number | undefined {
  const game = games.find((g) => g.matchId === matchId);
  if (!game) return undefined;
  // One definition of "boundary", in core, shared with the write path and the
  // player table — so the three can never drift apart.
  return resetBoundaries(provider.placementRuns()).get(rankKey(game.account, game.role));
}

/**
 * Shared-match history for one player — over the full (competitive-only) local
 * history, unscoped by the filter bar (it's a cross-history drill-down).
 */
export function playerHistoryRead(
  provider: DataProvider,
  name: string,
): PlayerMatchHistory | null {
  // Every provider read hoisted into a local in ONE synchronous tick: the same
  // `games` array feeds the name index, the suppression mask and the rank fold,
  // so no row can reference a match the fold never saw.
  const games = competitiveOnly(provider.games());
  const master = provider.effectiveMasterData();
  const runs = provider.placementRuns();
  // ONE grouped pass for every match's entering rank, not one history walk per
  // row — see `core/rank/entering`. `playerMatchHistory` only looks the result
  // up, so it structurally cannot walk history twice.
  return playerMatchHistory(games, name, makeMapMode(master.maps), enteringRanks(games, provider.rankAnchorMap(), {
    suppressed: suppressedMatchIds(games, runs),
    resetBefore: resetBoundaries(runs),
  }));
}

/**
 * Your record with and against a whole roster at once — the live-match screen's
 * known-players section.
 *
 * Deliberately its own read rather than N calls to {@link playerHistoryRead}:
 * that one walks the entire history per name, and this is asked for up to nine
 * players every time the live roster ticks.
 */
export function playerRecordsRead(
  provider: DataProvider,
  names: string[],
): PlayerRecord[] {
  return playerRecords(competitiveOnly(provider.games()), names);
}
