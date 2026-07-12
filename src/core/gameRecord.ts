import type { MatchRecord } from './model';
import type { GameRecord } from './analytics';
import { resolveAccount } from './resolvers/account';
import { resolveRole } from './resolvers/role';
import { resolveResult } from './resolvers/result';
import { resolveGepMapName } from './maps';

/**
 * Convert a raw capture record into an analyzable, resolved game — the one
 * mapping between the GEP aggregation shape and the persisted history shape.
 * Pure (no Electron/config imports) so the mapping is unit-testable.
 */
export function matchToGame(
  record: MatchRecord,
  accounts: Record<string, string>,
  now: () => number = () => Date.now(),
): GameRecord | null {
  const result = resolveResult(record.outcome);
  if (!result) return null; // no win/loss → not useful for stats
  const role = resolveRole(record.queueType, record.heroRole) ?? 'openQ';
  const perHero = record.perHero?.length
    ? record.perHero
    : record.heroes.length === 1 && record.eliminations != null
      ? [{
          hero: record.heroes[0], role,
          eliminations: record.eliminations ?? 0, deaths: record.deaths ?? 0, assists: record.assists ?? 0,
          damage: record.damage ?? 0, healing: record.healing ?? 0, mitigation: record.mitigation ?? 0,
        }]
      : undefined;
  return {
    matchId: record.matchId,
    timestamp: record.endedAt ?? now(),
    account: resolveAccount(record.battleTag, accounts) ?? record.battleTag ?? 'Unknown',
    role,
    map: resolveGepMapName(record.mapName) ?? 'Unknown',
    result,
    gameType: record.gameType ?? 'Unknown',
    durationMinutes: record.durationMinutes,
    heroes: record.heroes,
    perHero,
    finalScore: record.finalScore,
    roster: record.roster,
  };
}
