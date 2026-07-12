import type { GameRecord } from './analytics';
import type { RosterPlayer, Role } from './model';
import type { MatchDetail, ScoreboardEntry } from '../shared/contract';
import { DEFAULT_MASTER_DATA, makeMapMode, type MapModeResolver } from './masterData';
import { progression } from './progression';
import { classifyGameType } from './matchFilter';
import { sourceOf } from './source';
import { rankAfterMatch, rankKey, type RankAnchorMap } from './rank';
import { resolveRole } from './resolvers/role';
import { roleOfHero } from './heroes';
import { playerHistory } from './playerIndex';
import { mergeHeroStats } from './perHero';

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
    perHero: mergeHeroStats(game.perHero ?? []),
    mental: game.mental,
    review: game.review,
    scoreboard: scoreboardOf(game),
    competitive: competitiveOf(game, competitiveContext, all, anchors),
    playerHistory: playerHistory(all, game),
  };
}

/**
 * Scoreboard rows: the stored roster when GEP delivered one, otherwise the
 * tracked player's own per-hero lines (one tinted row per hero). Absent when
 * neither exists — the section is omitted, not faked.
 */
function scoreboardOf(game: GameRecord): ScoreboardEntry[] | undefined {
  if (game.roster?.length) return orderScoreboard(game.roster.map((p) => rosterEntry(p, game)));
  if (game.perHero?.length) {
    return mergeHeroStats(game.perHero).map((s) => ({
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
    // Local row keeps its authoritative queue role; for others prefer GEP's
    // heroRole, else derive from the hero (never guessed for an unknown hero).
    role: p.isLocal ? game.role : (resolveRole(undefined, p.heroRole) ?? roleOfHero(p.heroName)),
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

/** 5v5 role order within a team; openQ/unknown/unreported roles sort last. */
const ROLE_RANK: Record<string, number> = { tank: 0, damage: 1, support: 2 };
function roleRank(role: Role | undefined): number {
  return role != null && role in ROLE_RANK ? ROLE_RANK[role] : 3;
}

/**
 * Order scoreboard rows for the TAB screen: the tracked player's team first, then
 * within each team Tank → DPS → DPS → Support → Support (unresolved roles last),
 * tie-broken local-first then original slot. Rows are never moved across teams.
 */
function orderScoreboard(entries: ScoreboardEntry[]): ScoreboardEntry[] {
  const localTeam = entries.find((e) => e.isLocal)?.team;
  return entries
    .map((entry, slot) => ({ entry, slot }))
    .sort((a, b) => {
      const at = a.entry.team === localTeam ? 0 : 1;
      const bt = b.entry.team === localTeam ? 0 : 1;
      if (at !== bt) return at - bt;
      const ar = roleRank(a.entry.role);
      const br = roleRank(b.entry.role);
      if (ar !== br) return ar - br;
      const al = a.entry.isLocal ? 0 : 1;
      const bl = b.entry.isLocal ? 0 : 1;
      if (al !== bl) return al - bl;
      return a.slot - b.slot;
    })
    .map((x) => x.entry);
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
      progressPct: rank.progressPct,
      protected: rank.protected,
    };
  }

  // Fallback: the winrate heuristic.
  const scoped = context.filter(
    (g) => g.account === game.account && g.timestamp <= game.timestamp && classifyGameType(g.gameType) === 'competitive',
  );
  const p = progression(scoped.length ? scoped : [game]);
  return { note: 'estimate', tier: p.tier, division: p.division, progressPct: p.progressPct, delta: p.delta };
}
