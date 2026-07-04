/**
 * Pure GEP value-coercion toolkit: turns the loosely-typed values the feed
 * delivers (strings, numbers, JSON blobs) into typed shapes, tolerating the
 * field aliases seen across patches. Stateless — kept separate from the
 * stateful accumulator so it stays trivially unit-testable.
 */
import type { RosterPlayer } from '../model';

/** Parse a roster value (object or JSON string) into a RosterPlayer, tolerating field aliases. */
export function parseRoster(value: unknown): RosterPlayer | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      const found = caseInsensitiveGet(obj, k);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const player: RosterPlayer = {
    battleTag: asString(pick('battleTag', 'battletag', 'name', 'player', 'playerName')),
    heroName: asString(pick('heroName', 'hero_name', 'hero', 'character')),
    heroRole: asString(pick('heroRole', 'hero_role', 'role')),
    team: asNumber(pick('team', 'team_id', 'teamId')),
    kills: asNumber(pick('kills', 'eliminations', 'elims')),
    deaths: asNumber(pick('deaths')),
    assists: asNumber(pick('assists')),
    damage: asNumber(pick('damage', 'hero_damage', 'heroDamage', 'damage_dealt')),
    healing: asNumber(pick('healing', 'healing_done', 'healingDone')),
    mitigation: asNumber(pick('mitigation', 'damage_mitigated', 'damageMitigated')),
  };
  return player;
}

function caseInsensitiveGet(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lower) return obj[k];
  return undefined;
}

/** Coerce a GEP value into an object, parsing JSON-looking strings; undefined otherwise. */
export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Coerce a GEP scalar into a string; undefined for nullish and non-scalar values. */
export function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Coerce a GEP value into a finite number, tolerating "1,234"-style strings. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[, ]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
