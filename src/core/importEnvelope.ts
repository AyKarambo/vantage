import type { CommsTone, GameRecord, MatchMental, MatchReview, TargetGrade } from './analytics';
import type { Role } from './model';
import type { AuthoredTarget, TargetMode } from './targets';
import type { RankAnchorMap } from './rank';
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
 * v1 envelope shape (still fully supported):
 * ```
 * { "vantageImport": 1, "account": "Lampenlicht",
 *   "anchor"?: { "role": "tank", "tier": "Diamond", "division": 3, "progressPct": 45 },
 *   "games": [ { matchId, timestamp, account?, role?, map, result, gameType?, heroes?, srDelta?, performance? } ] }
 * ```
 *
 * v2 (W3) is a full-backup superset — every configured account, every
 * (account, role) rank anchor (not just one), every authored target, and
 * every game with its review/mental layer preserved (v1 games never carried
 * those, since nothing ever wrote them). See {@link buildImportEnvelope} for
 * the writer's side; `games`/`accounts`/`rankAnchors`/`targets` are all
 * parsed here regardless of version — a v1 file simply has none of the extra
 * sections, and any game row happens to carry a `review`/`mental` block is
 * read either way.
 */

const ROLES: readonly Role[] = ['tank', 'damage', 'support', 'openQ'];
const DIVISIONS: readonly number[] = [1, 2, 3, 4, 5];
const COMMS_TONES: readonly CommsTone[] = ['positive', 'banter', 'abusive'];
const TARGET_GRADES: readonly TargetGrade[] = ['hit', 'partial', 'missed'];

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

/** One configured account's battleTag → label mapping (W3 full backup). */
export interface ImportAccount {
  battleTag: string;
  label: string;
}

/** One (account, role) rank anchor (W3 full backup) — the plural sibling of the legacy single {@link ImportAnchor}. */
export interface ImportRankAnchor extends ImportAnchor {
  account: string;
  /** Epoch ms the anchor reflects the rank as of — preserved from the source, not re-derived. */
  setAt: number;
}

/** The result of validating an import envelope: the good games, an optional anchor, and every rejection. */
export interface ParsedImport {
  games: GameRecord[];
  anchor?: ImportAnchor;
  /** The envelope's default account label (the anchor's account); undefined when the envelope set none. */
  account?: string;
  errors: ImportError[];
  /** v2 only — configured accounts, for a full backup restore. Absent on a v1 file. */
  accounts?: ImportAccount[];
  /** v2 only — every (account, role) rank anchor, for a full backup restore. Absent on a v1 file. */
  rankAnchors?: ImportRankAnchor[];
  /** v2 only — the player's authored improvement targets, for a full backup restore. Absent on a v1 file. */
  targets?: AuthoredTarget[];
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

  // v2-only sections — parsed whenever present (not gated on vantageImport === 2)
  // so a hand-edited v1 file that happens to add one still gets read.
  const accounts = Array.isArray(raw.accounts)
    ? raw.accounts
      .map((row, index) => toAccount(row, (reason) => errors.push({ index: null, reason: `Account ${index}: ${reason}` })))
      .filter((a): a is ImportAccount => a !== null)
    : undefined;
  const rankAnchors = Array.isArray(raw.rankAnchors)
    ? raw.rankAnchors
      .map((row, index) => toRankAnchor(row, (reason) => errors.push({ index: null, reason: `Rank anchor ${index}: ${reason}` })))
      .filter((a): a is ImportRankAnchor => a !== null)
    : undefined;
  const targets = Array.isArray(raw.targets)
    ? raw.targets
      .map((row, index) => toTarget(row, (reason) => errors.push({ index: null, reason: `Target ${index}: ${reason}` })))
      .filter((t): t is AuthoredTarget => t !== null)
    : undefined;

  return {
    games,
    ...(anchor ? { anchor } : {}),
    ...(defaultAccount ? { account: defaultAccount } : {}),
    ...(accounts ? { accounts } : {}),
    ...(rankAnchors ? { rankAnchors } : {}),
    ...(targets ? { targets } : {}),
    errors,
  };
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
  // W3 — the self-report layer, written only by a v2 backup (v1 files never
  // carried these, so an older import file simply has neither field).
  const mental = toMental(row.mental);
  if (mental) game.mental = mental;
  const review = toReview(row.review);
  if (review) game.review = review;
  return game;
}

/** A light structural parse of the quick-log self-report — every field optional, unrecognized values dropped rather than failing the whole game row. */
function toMental(raw: unknown): MatchMental | undefined {
  if (!isRecord(raw)) return undefined;
  const m: MatchMental = {};
  if (typeof raw.tilt === 'boolean') m.tilt = raw.tilt;
  if (typeof raw.toxicMates === 'boolean') m.toxicMates = raw.toxicMates;
  if (typeof raw.leaver === 'boolean') m.leaver = raw.leaver;
  if (typeof raw.leaverMyTeam === 'boolean') m.leaverMyTeam = raw.leaverMyTeam;
  if (typeof raw.leaverEnemyTeam === 'boolean') m.leaverEnemyTeam = raw.leaverEnemyTeam;
  if (typeof raw.positiveComms === 'boolean') m.positiveComms = raw.positiveComms;
  if (typeof raw.comms === 'string' && COMMS_TONES.includes(raw.comms as CommsTone)) m.comms = raw.comms as CommsTone;
  return Object.keys(m).length ? m : undefined;
}

/** The saved Review-screen read — `at` + grades are required to mean anything; a review with neither is dropped. */
function toReview(raw: unknown): MatchReview | undefined {
  if (!isRecord(raw) || typeof raw.at !== 'number') return undefined;
  const grades: Record<string, TargetGrade> = {};
  if (isRecord(raw.grades)) {
    for (const [targetId, grade] of Object.entries(raw.grades)) {
      if (typeof grade === 'string' && TARGET_GRADES.includes(grade as TargetGrade)) grades[targetId] = grade as TargetGrade;
    }
  }
  return { at: raw.at, grades, flags: toMental(raw.flags) ?? {} };
}

/** Validate the optional rank anchor; a bad anchor is dropped (with a reason) rather than corrupting the ladder. */
function parseAnchor(raw: unknown, fail: (reason: string) => void): ImportAnchor | undefined {
  if (!isRecord(raw)) {
    fail('Anchor is not an object.');
    return undefined;
  }
  return parseRankFields(raw, 'Anchor', fail);
}

/** Shared role/tier/division/progressPct validation for both the legacy single anchor and each v2 rank-anchor entry. */
function parseRankFields(raw: Record<string, unknown>, label: string, fail: (reason: string) => void): ImportAnchor | undefined {
  let role: Role = 'tank';
  if (typeof raw.role === 'string' && raw.role.trim()) {
    const rawRole = raw.role;
    const matched = ROLES.find((r) => r.toLowerCase() === rawRole.toLowerCase());
    if (!matched) {
      fail(`${label} role "${rawRole}" is not a valid role.`);
      return undefined;
    }
    role = matched;
  }
  const tier = typeof raw.tier === 'string' ? raw.tier : '';
  // An unknown tier is silently coerced to Bronze by the rank engine — reject it here instead.
  if (!TIERS.includes(tier)) {
    fail(`${label} tier "${tier}" is not a valid rank tier.`);
    return undefined;
  }
  if (typeof raw.division !== 'number' || !DIVISIONS.includes(raw.division)) {
    fail(`${label} division must be a whole number 1..5.`);
    return undefined;
  }
  if (typeof raw.progressPct !== 'number' || !Number.isFinite(raw.progressPct) || raw.progressPct < 0 || raw.progressPct > 100) {
    fail(`${label} progressPct must be a number 0..100.`);
    return undefined;
  }
  return { role, tier, division: raw.division, progressPct: raw.progressPct };
}

/** One v2 backup account entry: a plain battleTag/label pair. */
function toAccount(raw: unknown, fail: (reason: string) => void): ImportAccount | null {
  if (!isRecord(raw)) {
    fail('not an object.');
    return null;
  }
  const battleTag = typeof raw.battleTag === 'string' && raw.battleTag.trim() ? raw.battleTag.trim() : undefined;
  if (!battleTag) {
    fail('missing battleTag.');
    return null;
  }
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : battleTag;
  return { battleTag, label };
}

/** One v2 backup rank-anchor entry — the same rank fields as the legacy anchor, plus the (account, role) it belongs to and its original setAt. */
function toRankAnchor(raw: unknown, fail: (reason: string) => void): ImportRankAnchor | null {
  if (!isRecord(raw)) {
    fail('not an object.');
    return null;
  }
  const account = typeof raw.account === 'string' && raw.account.trim() ? raw.account.trim() : undefined;
  if (!account) {
    fail('missing account.');
    return null;
  }
  if (typeof raw.setAt !== 'number' || !Number.isFinite(raw.setAt)) {
    fail('missing or invalid setAt.');
    return null;
  }
  const fields = parseRankFields(raw, 'Rank anchor', fail);
  if (!fields) return null;
  return { ...fields, account, setAt: raw.setAt };
}

/** One v2 backup authored target — validated loosely (Vantage's own export is a trusted round-trip), dropped whole on a structural problem rather than partially reconstructed. */
function toTarget(raw: unknown, fail: (reason: string) => void): AuthoredTarget | null {
  if (!isRecord(raw)) {
    fail('not an object.');
    return null;
  }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : undefined;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : undefined;
  const rule = typeof raw.rule === 'string' ? raw.rule : undefined;
  const mode: TargetMode | undefined = raw.mode === 'self' || raw.mode === 'measured' ? raw.mode : undefined;
  if (!id || !name || rule === undefined || !mode) {
    fail('missing id, name, rule, or mode.');
    return null;
  }
  if (typeof raw.createdAt !== 'number' || typeof raw.isActive !== 'boolean') {
    fail('missing or invalid createdAt/isActive.');
    return null;
  }
  const target: AuthoredTarget = { id, name, mode, rule, createdAt: raw.createdAt, isActive: raw.isActive };
  if (raw.scope === 'match' || raw.scope === 'season') target.scope = raw.scope;
  if (typeof raw.roleScope === 'string' && ROLES.includes(raw.roleScope as Role)) target.roleScope = raw.roleScope as Role;
  if (Array.isArray(raw.heroScope)) target.heroScope = raw.heroScope.filter((h): h is string => typeof h === 'string');
  if (Array.isArray(raw.mapScope)) target.mapScope = raw.mapScope.filter((m): m is string => typeof m === 'string');
  if (typeof raw.activatedAt === 'number') target.activatedAt = raw.activatedAt;
  if (typeof raw.archivedAt === 'number') target.archivedAt = raw.archivedAt;
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Input to {@link buildImportEnvelope} — everything a full local backup captures. */
export interface BackupData {
  games: GameRecord[];
  /** Configured accounts only (battleTag → label) — detected/unlabelled ones are re-derived from `games` on import. */
  accounts: ImportAccount[];
  rankAnchors: RankAnchorMap;
  targets: AuthoredTarget[];
}

/** The v2 envelope {@link buildImportEnvelope} writes — a superset of v1 (games + one anchor). */
export interface VantageBackupEnvelope {
  vantageImport: 2;
  exportedAt: number;
  accounts: ImportAccount[];
  rankAnchors: ImportRankAnchor[];
  targets: AuthoredTarget[];
  games: GameRecord[];
}

/**
 * Serialize a full local backup (W3 phase 2) — every game (with its review/
 * mental self-report layer, unlike v1's games-only export, since nothing
 * ever wrote v1 files from Vantage itself), every configured account, every
 * (account, role) rank anchor, and every authored target. Pure: the main
 * edge gathers these from the live stores and writes the result to disk.
 * `opts.now` mirrors {@link parseVantageImport}'s injectable clock.
 */
export function buildImportEnvelope(data: BackupData, opts: { now?: () => number } = {}): VantageBackupEnvelope {
  const now = opts.now ? opts.now() : Date.now();
  return {
    vantageImport: 2,
    exportedAt: now,
    accounts: data.accounts,
    rankAnchors: Object.entries(data.rankAnchors)
      .map(([key, a]): ImportRankAnchor | null => {
        // Keys are always `${account}::${role}` (rankKey) — matching the KNOWN
        // role suffix, not a blind split, since an account name could itself
        // contain "::" (unlikely for a BattleTag, but not worth trusting).
        const role = ROLES.find((r) => key.endsWith(`::${r}`));
        if (!role) return null;
        return { account: key.slice(0, key.length - role.length - 2), role, tier: a.tier, division: a.division, progressPct: a.progressPct, setAt: a.setAt };
      })
      .filter((a): a is ImportRankAnchor => a !== null),
    targets: data.targets,
    games: data.games,
  };
}
