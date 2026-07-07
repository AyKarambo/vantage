import type { GameRecord } from './analytics';
import type { RosterPlayer } from './model';
import type { MatchDetail, ScoreboardEntry } from '../shared/contract';
import { DEFAULT_MASTER_DATA, makeMapMode, type MapModeResolver } from './masterData';
import { progression } from './progression';
import { classifyGameType } from './matchFilter';
import { sourceOf } from './source';
import { rankAfterMatch, rankKey, type RankAnchorMap } from './rank';
import { resolveRole } from './resolvers/role';
import { playerHistory } from './playerIndex';

/**
 * Full drill-down payload for one match. Pure and I/O-free, mirroring the
 * `heroDetail` pipeline. Every section that depends on data GEP may not have
 * delivered is optional/empty — the page degrades section-by-section, and a
 * minimal legacy record still yields a complete header.
 *
 * `all` is the full (unfiltered) history: the lookup must succeed even when
 * the dashboard filters have moved on, and the player index spans everything.
 * `competitiveContext` is the filter-scoped set the progression estimate is
 * computed from (defaults to `all`).
 */
export function matchDetail(
  all: GameRecord[],
  matchId: string,
  competitiveContext: GameRecord[] = all,
  anchors: RankAnchorMap = {},
  mapModeOf: MapModeResolver = makeMapMode(DEFAULT_MASTER_DATA.maps),
): MatchDetail | null {
  const game = all.find((g) => g.matchId === matchId);
  if (!game) return null;

  return {
    matchId: game.matchId,
    timestamp: game.timestamp,
    account: game.account,
    role: game.role,
    map: game.map,
    mapType: mapModeOf(game.map),
    result: game.result,
    gameType: game.gameType,
    source: sourceOf(game),
    srDelta: game.srDelta,
    durationMinutes: game.durationMinutes,
    performance: game.performance,
    finalScore: game.finalScore,
    heroes: game.heroes,
    perHero: game.perHero ?? [],
    mental: game.mental,
    review: game.review,
    scoreboard: scoreboardOf(game),
    competitive: competitiveOf(game, competitiveContext, all, anchors),
    playerHistory: playerHistory(all, game),
    screenshots: (game.screenshots ?? []).map(toMediaUrl),
  };
}

/**
 * Scoreboard rows: the stored roster when GEP delivered one, otherwise the
 * tracked player's own per-hero lines (one tinted row per hero). Absent when
 * neither exists — the section is omitted, not faked.
 */
function scoreboardOf(game: GameRecord): ScoreboardEntry[] | undefined {
  if (game.roster?.length) return game.roster.map((p) => rosterEntry(p, game));
  if (game.perHero?.length) {
    return game.perHero.map((s) => ({
      name: game.account,
      hero: s.hero,
      role: s.role,
      isLocal: true,
      eliminations: s.eliminations,
      deaths: s.deaths,
      assists: s.assists,
      damage: s.damage,
      healing: s.healing,
      mitigation: s.mitigation,
    }));
  }
  return undefined;
}

function rosterEntry(p: RosterPlayer, game: GameRecord): ScoreboardEntry {
  return {
    name: p.battleTag ?? 'Unknown',
    hero: p.heroName,
    role: p.isLocal ? game.role : resolveRole(undefined, p.heroRole),
    team: p.team,
    isLocal: Boolean(p.isLocal),
    eliminations: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    damage: p.damage,
    healing: p.healing,
    mitigation: p.mitigation,
  };
}

/**
 * Competitive progress for competitive games only. When the player has set a
 * rank anchor for this (account, role), the position is 'calculated' from that
 * anchor + logged SR deltas (including rank protection). Otherwise it falls back
 * to the winrate 'estimate' (the sanctioned feed does not report rank;
 * 'reported' is reserved for a future verified GEP upgrade).
 */
function competitiveOf(
  game: GameRecord,
  context: GameRecord[],
  all: GameRecord[],
  anchors: RankAnchorMap,
): MatchDetail['competitive'] {
  if (classifyGameType(game.gameType) !== 'competitive') return undefined;

  // Preferred: the rank as of this match, from the anchor timeline. A match
  // at/after the anchor is forward-replayed ('calculated'); an older one is
  // reconstructed backward from the anchor ('reconstructed', best-effort).
  const anchor = anchors[rankKey(game.account, game.role)];
  const rank = rankAfterMatch(all, anchors, game.account, game.role, game.timestamp);
  if (rank && anchor) {
    return {
      note: game.timestamp >= anchor.setAt ? 'calculated' : 'reconstructed',
      tier: rank.tier,
      division: rank.division,
      progressPct: rank.needsReanchor ? undefined : rank.progressPct,
      protected: rank.protected,
      needsReanchor: rank.needsReanchor,
    };
  }

  // Fallback: the winrate heuristic.
  const scoped = context.filter(
    (g) => g.account === game.account && g.timestamp <= game.timestamp && classifyGameType(g.gameType) === 'competitive',
  );
  const p = progression(scoped.length ? scoped : [game]);
  return { note: 'estimate', tier: p.tier, division: p.division, progressPct: p.progressPct, delta: p.delta };
}

/** Renderer-facing URL served by the read-only vantage-media:// protocol. */
function toMediaUrl(relPath: string): string {
  const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `vantage-media://screenshots/${clean.split('/').map(encodeURIComponent).join('/')}`;
}
