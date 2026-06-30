import { emptyMatch, type MatchRecord } from './model';

/**
 * Parses Counterwatch's `unified_matches` records straight out of its Chromium
 * IndexedDB LevelDB `.log` bytes (read as Latin1).
 *
 * Counterwatch (an Overwolf-sanctioned app) does the actual GEP capture and
 * persists each finished match with RxDB key-compression. Values are V8-serialized
 * one-byte strings: a `0x22` tag, a varint length, then the bytes. We read those
 * length-delimited strings, which is robust to spaces/apostrophes in map names.
 *
 * Field key mapping is empirical (derived from real records) and centralized in
 * `KEYS` so it is trivial to re-map if a Counterwatch update changes the schema.
 */
const KEYS = {
  matchId: '__m', // match id (also the suffix of matchKey)
  battleTag: '__p', // player BattleTag, e.g. "Player#1234"
  gameType: '__f', // "Competitive" | "Unranked" | ...
  mapMode: '__e', // "Hybrid" | "Control" | ...
  map: '__j', // map name, e.g. "Eichenwalde"
  role: '__r', // "Tank" | "Damage" | "Support" | "Flex"
  outcome: '__o', // "Victory" | "Defeat" | "Draw"
} as const;

const V8_STRING_TAG = 0x22;
/** matchKey looks like "Player#1234|123456789" — guards against schema noise. */
const MATCH_KEY_RE = /^.+#\d+\|\d+$/;

/** Read a V8 one-byte string that begins at/just after `pos`. */
export function readV8String(text: string, pos: number): string | undefined {
  let p = pos;
  for (let tries = 0; tries < 4 && text.charCodeAt(p) !== V8_STRING_TAG; tries++) p++;
  if (text.charCodeAt(p) !== V8_STRING_TAG) return undefined;
  p++; // skip tag

  let len = 0;
  let shift = 0;
  let b: number;
  do {
    if (p >= text.length) return undefined;
    b = text.charCodeAt(p++);
    len |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);

  if (len <= 0 || len > 200) return undefined;
  return text.substr(p, len);
}

/** Within a record window, read the value string that follows a (compressed) key. */
function fieldValue(window: string, key: string): string | undefined {
  const idx = window.indexOf(key);
  if (idx < 0) return undefined;
  return readV8String(window, idx + key.length);
}

/** Parse every distinct `unified_matches` record found in the buffer. */
export function parseUnifiedMatches(text: string): MatchRecord[] {
  const byId = new Map<string, MatchRecord>();
  let idx = 0;
  while ((idx = text.indexOf('matchKey', idx)) >= 0) {
    const recordStart = idx;
    idx += 'matchKey'.length;

    const matchKey = readV8String(text, recordStart + 'matchKey'.length);
    if (!matchKey || !MATCH_KEY_RE.test(matchKey)) continue;

    const window = text.slice(recordStart, recordStart + 1500);
    const [tagFromKey, idFromKey] = splitMatchKey(matchKey);

    const matchId = fieldValue(window, KEYS.matchId) ?? idFromKey;
    if (!matchId) continue;

    const role = fieldValue(window, KEYS.role);
    const record: MatchRecord = {
      ...emptyMatch(matchId),
      battleTag: fieldValue(window, KEYS.battleTag) ?? tagFromKey,
      mapName: fieldValue(window, KEYS.map),
      outcome: fieldValue(window, KEYS.outcome),
      gameType: fieldValue(window, KEYS.gameType),
      heroRole: role,
      // Counterwatch reports the final role directly; flag open-queue roles so the
      // downstream resolver maps them to `openQ`.
      queueType: role && !/^(tank|damage|support)$/i.test(role) ? 'open' : undefined,
    };
    // The WAL holds multiple revisions/index entries per match; merge defined
    // fields so a partial copy never wipes a complete one.
    byId.set(matchId, mergeDefined(byId.get(matchId) ?? emptyMatch(matchId), record));
  }
  return [...byId.values()];
}

/** Overlay only the meaningfully-defined fields of `next` onto `base`. */
function mergeDefined(base: MatchRecord, next: MatchRecord): MatchRecord {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (!empty) out[key] = value;
  }
  return out as unknown as MatchRecord;
}

function splitMatchKey(matchKey: string): [string | undefined, string | undefined] {
  const pipe = matchKey.lastIndexOf('|');
  if (pipe < 0) return [undefined, undefined];
  return [matchKey.slice(0, pipe), matchKey.slice(pipe + 1)];
}
