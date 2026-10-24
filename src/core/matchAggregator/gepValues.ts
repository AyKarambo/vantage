/**
 * Pure GEP value-coercion toolkit: turns the loosely-typed values the feed
 * delivers (strings, numbers, JSON blobs) into typed shapes, tolerating the
 * field aliases seen across patches. Stateless — kept separate from the
 * stateful accumulator so it stays trivially unit-testable.
 */
import type { RosterPlayer } from '../model';
import { resolveHero } from '../resolvers/hero';

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
    battleTag: asString(pick('battleTag', 'battletag', 'battle_tag', 'battlenet_tag', 'name', 'player', 'playerName', 'player_name')),
    // Documented Overwatch GEP flag marking the tracked (local) player — the
    // identity signal the pipeline used to throw away.
    isLocal: asBool(pick('is_local', 'isLocal', 'local')),
    // GEP delivers hero names in ALL CAPS — canonicalize so they match the
    // proper-case names the rest of the app and the user's history key on.
    // A numeric hero_id covers a brand-new hero GEP names "UNKNOWN" (see HERO_ID_TO_NAME).
    heroName: resolveHero(
      asString(pick('heroName', 'hero_name', 'hero', 'character')),
      asString(pick('heroId', 'hero_id')),
    ),
    heroRole: asString(pick('heroRole', 'hero_role', 'role')),
    team: asNumber(pick('team', 'team_id', 'teamId')),
    kills: asNumber(pick('kills', 'eliminations', 'elims')),
    deaths: asNumber(pick('deaths')),
    assists: asNumber(pick('assists')),
    damage: asNumber(pick('damage', 'hero_damage', 'heroDamage', 'damage_dealt')),
    // GEP's real roster keys are the past-tense `healed`/`mitigated` (seen in a
    // live capture) — without these aliases a support's healing/mitigation was
    // silently dropped from the scoreboard.
    healing: asNumber(pick('healing', 'healed', 'healing_done', 'healingDone')),
    mitigation: asNumber(pick('mitigation', 'mitigated', 'damage_mitigated', 'damageMitigated')),
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

/** Coerce a GEP flag (`0|1`, `true|false`, or `"true"/"false"`) into a boolean; undefined otherwise. */
export function asBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0' || s === '') return false;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read `game_info.party_player_count` out of an Overwolf GEP `getInfo()` result.
 * The result's exact shape isn't typed locally and has varied (`{ res: { game_info } }`,
 * `{ info: { game_info } }`, or a flat `{ game_info }`), so each wrapper is tried in
 * turn; the count itself may be a number, a numeric string, or nested as
 * `{ party_player_count }`. Returns the RAW number — solo normalization (0/1 → 1)
 * is the aggregator's job — or undefined when nothing usable is present.
 */
export function partyCountFromInfo(info: unknown): number | undefined {
  if (!isRecord(info)) return undefined;
  const candidates = [
    isRecord(info.res) ? info.res.game_info : undefined,
    isRecord(info.info) ? info.info.game_info : undefined,
    info.game_info,
  ];
  for (const gameInfo of candidates) {
    if (!isRecord(gameInfo)) continue;
    const raw = gameInfo.party_player_count;
    const n = asNumber(isRecord(raw) ? raw.party_player_count : raw);
    if (n !== undefined) return n;
  }
  return undefined;
}
