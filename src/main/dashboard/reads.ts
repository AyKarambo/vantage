import { heroDetail, type GameRecord } from '../../core/analytics';
import { matchDetail } from '../../core/matchDetail';
import { activeMeasuredTargets } from '../../core/targets';
import { playerMatchHistory } from '../../core/playerIndex';
import { computeDashboard, applyFilters } from '../../core/dashboardData';
import { makeMapMode } from '../../core/masterData';
import { isCompetitive } from '../../core/matchFilter';
import type {
  DashboardFilters, DashboardData, HeroDetail, MatchDetail, PlayerMatchHistory,
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
  return heroDetail(filteredCompetitiveGames(provider, filters), hero);
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
  );
}

/**
 * Shared-match history for one player — over the full (competitive-only) local
 * history, unscoped by the filter bar (it's a cross-history drill-down).
 */
export function playerHistoryRead(
  provider: DataProvider,
  name: string,
): PlayerMatchHistory | null {
  const master = provider.effectiveMasterData();
  return playerMatchHistory(competitiveOnly(provider.games()), name, makeMapMode(master.maps));
}
