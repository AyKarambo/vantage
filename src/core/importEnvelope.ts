import type { GameRecord } from './analytics';
import type { Role } from './model';
import { resolveResult } from './resolvers/result';
import { TIERS } from './rank';

/**
 * Pure parser/validator for a "Vantage import file" — the neutral JSON envelope
 * a companion tool (e.g. the Obsidian→Vantage PowerShell script) writes and the
 * in-app "Import from file" action ingests. Electron/Node-free and I/O-free
 * (mirrors {@link ./dataMigration}): the main-process edge does the file read +
 * `JSON.parse` and hands the parsed value in here; the store writes happen at
 * the edge too. The input is untrusted, so every rule is a runtime check —
 * bad rows are collected as {@link ImportError}s and skipped, never thrown, so
 * one malformed match can't abort a whole import.
 *
 * Envelope shape:
 * ```
 * { "vantageImport": 1, "account": "Lampenlicht",
 *   "anchor"?: { "role": "tank", "tier": "Diamond", "division": 3, "progressPct": 45 },
 *   "games": [ { matchId, timestamp, account?, role?, map, result, gameType?, heroes?, srDelta?, performance? } ] }
 * ```
 */

const ROLES: readonly Role[] = ['tank', 'damage', 'support', 'openQ'];
const DIVISIONS: readonly number[] = [1, 2, 3, 4, 5];

/** The rank anchor a validated envelope carries (the friend's current rank). `setAt` is derived at the edge. */
export interface ImportAnchor {
  role: Role;
  tier: string;
  division: number;
  progressPct: number;
}

/** A rejected row (`index` into `games`) or an envelope-level problem (`index: null`). */
export interface ImportError {
  index: number | null;
  reason: string;
}

/** The result of validating an import envelope: the good games, an optional anchor, and every rejection. */
export interface ParsedImport {
  games: GameRecord[];
  anchor?: ImportAnchor;
  /** The envelope's default account label (the anchor's account); undefined when the envelope set none. */
  account?: string;
  errors: ImportError[];
}

/** Validate + normalize a parsed import envelope. `opts.now` (default `Date.now`) clamps future timestamps. */
export function parseVantageImport(raw: unknown, opts: { now?: () => number } = {}): ParsedImport {
  const now = opts.now ? opts.now() : Date.now();
  const errors: ImportError[] = [];
  const games: GameRecord[] = [];

  if (!isRecord(raw)) {
    return { games, errors: [{ index: null, reason: 'Import file is not a JSON object.' }] };
  }
  if (typeof raw.vantageImport !== 'number') {
    errors.push({ index: null, reason: 'Missing or invalid "vantageImport" version number.' });
  }
  const defaultAccount = typeof raw.account === 'string' && raw.account.trim() ? raw.account.trim() : undefined;

  if (!Array.isArray(raw.games)) {
    errors.push({ index: null, reason: '"games" must be an array.' });
    return { games, errors };
  }

  raw.games.forEach((row, index) => {
    const game = toGame(row, defaultAccount, now, (reason) => errors.push({ index, reason }));
    if (game) games.push(game);
  });

  const anchor = raw.anchor !== undefined
    ? parseAnchor(raw.anchor, (reason) => errors.push({ index: null, reason }))
    : undefined;

  return { games, ...(anchor ? { anchor } : {}), ...(defaultAccount ? { account: defaultAccount } : {}), errors };
}

/** Validate one game row into a {@link GameRecord}, or `null` (and a reported reason) when it can't be imported. */
function toGame(
  row: unknown,
  defaultAccount: string | undefined,
  now: number,
  fail: (reason: string) => void,
): GameRecord | null {
  if (!isRecord(row)) {
    fail('Match entry is not an object.');
    return null;
  }
  const matchId = typeof row.matchId === 'string' && row.matchId.trim() ? row.matchId : undefined;
  if (!matchId) {
    fail('Match entry has no matchId.');
    return null;
  }
  // Result is essential — a row without a decidable win/loss is not a usable match.
  const result = resolveResult(typeof row.result === 'string' ? row.result : undefined);
  if (!result) {
    fail(`Match ${matchId} has an unrecognized or missing result.`);
    return null;
  }
  if (typeof row.timestamp !== 'number' || !Number.isFinite(row.timestamp)) {
    fail(`Match ${matchId} has an invalid timestamp.`);
    return null;
  }
  const account = typeof row.account === 'string' && row.account.trim() ? row.account.trim() : defaultAccount;
  if (!account) {
    fail(`Match ${matchId} has no account and the envelope sets no default.`);
    return null;
  }
  // Role defaults to 'tank' only when ABSENT; a present-but-unrecognized role is
  // rejected rather than silently mis-bucketed onto the tank ladder. Case-insensitive
  // so "Tank"/"Support" resolve to the canonical value.
  let role: Role = 'tank';
  if (typeof row.role === 'string' && row.role.trim()) {
    const rawRole = row.role;
    const matched = ROLES.find((r) => r.toLowerCase() === rawRole.toLowerCase());
    if (!matched) {
      fail(`Match ${matchId} has an unrecognized role "${rawRole}".`);
      return null;
    }
    role = matched;
  }
  const map = typeof row.map === 'string' && row.map.trim() ? row.map.trim() : 'Unknown';
  const gameType = typeof row.gameType === 'string' && row.gameType.trim() ? row.gameType.trim() : 'Competitive';
  const heroes = Array.isArray(row.heroes)
    ? row.heroes.filter((h): h is string => typeof h === 'string')
    : [];

  const game: GameRecord = {
    matchId,
    timestamp: Math.min(row.timestamp, now), // never stamp history in the future
    account,
    role,
    map,
    result,
    gameType,
    source: 'manual',
    heroes,
  };
  if (typeof row.srDelta === 'number' && Number.isFinite(row.srDelta)) game.srDelta = row.srDelta;
  // performance is a 0..100 self-rating; drop an out-of-range value rather than
  // letting it skew the performance averages (mirrors the anchor's progressPct check).
  if (typeof row.performance === 'number' && Number.isFinite(row.performance) && row.performance >= 0 && row.performance <= 100) {
    game.performance = row.performance;
  }
  return game;
}

/** Validate the optional rank anchor; a bad anchor is dropped (with a reason) rather than corrupting the ladder. */
function parseAnchor(raw: unknown, fail: (reason: string) => void): ImportAnchor | undefined {
  if (!isRecord(raw)) {
    fail('Anchor is not an object.');
    return undefined;
  }
  let role: Role = 'tank';
  if (typeof raw.role === 'string' && raw.role.trim()) {
    const rawRole = raw.role;
    const matched = ROLES.find((r) => r.toLowerCase() === rawRole.toLowerCase());
    if (!matched) {
      fail(`Anchor role "${rawRole}" is not a valid role.`);
      return undefined;
    }
    role = matched;
  }
  const tier = typeof raw.tier === 'string' ? raw.tier : '';
  // An unknown tier is silently coerced to Bronze by the rank engine — reject it here instead.
  if (!TIERS.includes(tier)) {
    fail(`Anchor tier "${tier}" is not a valid rank tier.`);
    return undefined;
  }
  if (typeof raw.division !== 'number' || !DIVISIONS.includes(raw.division)) {
    fail('Anchor division must be a whole number 1..5.');
    return undefined;
  }
  if (typeof raw.progressPct !== 'number' || !Number.isFinite(raw.progressPct) || raw.progressPct < 0 || raw.progressPct > 100) {
    fail('Anchor progressPct must be a number 0..100.');
    return undefined;
  }
  return { role, tier, division: raw.division, progressPct: raw.progressPct };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
