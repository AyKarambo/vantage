import { battleTagName, type GepMessage, type RosterPlayer } from './model';
import { isMatchEndMessage, isMatchStartMessage } from './matchAggregator';
import { K } from './matchAggregator/keys';
import { asNumber, asObject, asString, asBool, parseRoster } from './matchAggregator/gepValues';
import { resolveHeroName } from './resolvers/hero';
import { resolveMapId } from './resolvers/mapId';

/**
 * The live (in-progress) match, folded from the same GEP message stream the
 * {@link MatchAggregator} consumes — but answering a different question.
 *
 * The aggregator is a WRITE path: it accumulates until `match_end` and emits one
 * finished {@link MatchRecord} to persist. It deliberately exposes nothing
 * mid-match. This is a READ path: what is on the TAB screen right now, thrown
 * away when the match ends. Keeping them separate means neither has to
 * compromise — the aggregator keeps its finalize-only contract, and this can be
 * lossy and throttled without risking what gets stored.
 *
 * Pure and Electron-free (guardrail #3), and GEP-only (guardrail #1): every
 * field here is something the game itself put on the scoreboard.
 *
 * ## What Overwatch's feed does NOT give us
 *
 * There is no live objective score. The documented `match_info` info-updates are
 * exactly `map`, `pseudo_match_id`, `match_outcome`, `round_outcome`, `match_id`
 * — no score of any kind — and `round_outcome` is documented "Only works for
 * Stadium mode", so the round tally is dead in normal competitive. Rather than
 * invent one, the live board reports an ELIMINATION count derived from the
 * `kill_feed` event stream, and says that is what it is.
 */

/** One entry from the `kill_feed` event stream. */
export interface LiveKill {
  /** ms epoch this was observed. */
  at: number;
  attacker?: string;
  victim?: string;
  attackerHero?: string;
  victimHero?: string;
  /** True when the ATTACKER was on the tracked player's team. */
  attackerFriendly?: boolean;
  /** A revive rather than a kill — counted separately, never as an elimination. */
  revive?: boolean;
}

/** How many kill-feed entries to retain for the "recent" strip. */
export const LIVE_FEED_CAP = 8;

export interface LiveMatchState {
  /** `live` between a match_start and the match ending (or GEP detaching). */
  phase: 'idle' | 'live';
  startedAt?: number;
  /** When the last match ENDED, for the idle screen's "just finished" note. */
  endedAt?: number;
  mapName?: string;
  gameType?: string;
  queueType?: string;
  /** The tracked player's BattleTag, once the feed has named it. */
  localBattleTag?: string;
  /** Latest snapshot per roster SLOT (`roster_0`…), so a partial update merges. */
  roster: Record<string, RosterPlayer>;
  /** Eliminations tallied from the kill feed, by team relation. */
  kills: { yours: number; theirs: number };
  /** Most recent kill-feed entries, newest first, capped at {@link LIVE_FEED_CAP}. */
  feed: LiveKill[];
}

export const INITIAL_LIVE_MATCH: LiveMatchState = {
  phase: 'idle',
  roster: {},
  kills: { yours: 0, theirs: 0 },
  feed: [],
};

/**
 * Fold one GEP message into the live state. Returns the SAME reference when
 * nothing changed, so the publisher can skip a push by identity.
 *
 * Rule order matters, and is the subtle part:
 *
 *  1. `match_start` always wins — it opens a fresh match from any phase.
 *  2. **Everything else is ignored while idle.** This gate sits ABOVE the
 *     match-end rule on purpose. {@link isMatchEndMessage} is not only the
 *     `match_end` event: it also matches a `game_info.game_state` value like
 *     "ended", which the feed emits while no match is running (menus, game
 *     exit). Handling match-end first would allocate a fresh object for each of
 *     those — breaking the same-reference contract, publishing on every throttle
 *     window, and re-stamping `endedAt` so the idle screen claims a match just
 *     finished when none ever started.
 *  3. Then apply the message, and only then check for the end.
 */
export function reduceLiveMatch(state: LiveMatchState, msg: GepMessage, now: number): LiveMatchState {
  if (isMatchStartMessage(msg)) {
    return { ...INITIAL_LIVE_MATCH, phase: 'live', startedAt: now, roster: {}, feed: [], kills: { yours: 0, theirs: 0 } };
  }
  if (state.phase !== 'live') return state;

  const next = applyMessage(state, msg, now);
  if (isMatchEndMessage(msg)) return { ...INITIAL_LIVE_MATCH, endedAt: now };
  return next;
}

/**
 * GEP detached, the game closed, or it crashed — no `match_end` will ever
 * arrive. Without this the board would present a stale scoreboard as current
 * for the rest of the session, contradicting the status indicator, which DOES
 * recover (it resets on the same detach signal).
 */
export function liveMatchDetached(state: LiveMatchState, now: number): LiveMatchState {
  if (state.phase !== 'live') return state;
  return { ...INITIAL_LIVE_MATCH, endedAt: now };
}

function applyMessage(state: LiveMatchState, msg: GepMessage, now: number): LiveMatchState {
  const feature = msg.feature?.toLowerCase();
  const key = msg.key?.toLowerCase();

  if (feature === K.gameInfo) {
    if (key === K.battleTag) {
      const tag = asString(msg.value);
      return tag && tag !== state.localBattleTag ? { ...state, localBattleTag: tag } : state;
    }
    if (key === K.gameType) {
      const gameType = asString(msg.value);
      return gameType && gameType !== state.gameType ? { ...state, gameType } : state;
    }
    if (key === K.queueType) {
      const queueType = asString(msg.value);
      return queueType && queueType !== state.queueType ? { ...state, queueType } : state;
    }
    return state;
  }

  // The kill feed is matched on the KEY alone, not on a feature name. Overwolf
  // groups Overwatch's events under feature headings that have shifted between
  // package versions, and guessing wrong here would mean silently no kill feed;
  // the event key itself has been stable. Same tolerance as `nameMatches` in the
  // aggregator.
  if (key === 'kill_feed') return applyKillFeed(state, msg.value, now);

  if (feature === K.matchInfo || feature === K.roster) {
    if (key === K.map) {
      const mapName = resolveMapId(asString(msg.value)) ?? undefined;
      return mapName && mapName !== state.mapName ? { ...state, mapName } : state;
    }
    if (key?.startsWith(K.roster)) return applyRoster(state, key, msg.value);
  }
  return state;
}

/**
 * Merge one roster slot. GEP sends PARTIAL snapshots (a tick may carry only the
 * changed fields), so this merges onto the slot rather than replacing it —
 * replacing would blank a support's healing every time a tick omitted it.
 *
 * As the scoreboard tears down at match end the feed resets each slot to an
 * empty object, and masks names/heroes to "UNKNOWN". Both are dropped here, so
 * the last rich snapshot survives to the end of the match instead of the board
 * emptying out a second before it closes.
 */
function applyRoster(state: LiveMatchState, slot: string, value: unknown): LiveMatchState {
  const parsed = parseRoster(value);
  if (!parsed || !hasContent(parsed)) return state;
  const prev = state.roster[slot];
  const merged: RosterPlayer = { ...prev };
  for (const [k, v] of Object.entries(parsed) as Array<[keyof RosterPlayer, unknown]>) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  if (prev && shallowEqual(prev, merged)) return state;
  return { ...state, roster: { ...state.roster, [slot]: merged } };
}

/** True when a roster snapshot carries anything worth keeping. */
function hasContent(p: RosterPlayer): boolean {
  const named = p.battleTag && p.battleTag.trim() && p.battleTag.trim().toUpperCase() !== 'UNKNOWN';
  const hero = p.heroName && p.heroName.toUpperCase() !== 'UNKNOWN';
  return Boolean(named || hero || p.kills != null || p.deaths != null || p.damage != null);
}

/**
 * Tally one kill-feed entry.
 *
 * This is the only score-shaped signal Overwatch's feed offers — there is no
 * objective score in the GEP data at all — so it is counted and LABELLED as
 * eliminations, never dressed up as the match score.
 *
 * Revives carry the same event and must not count: `revived` being present is
 * the documented discriminator.
 */
function applyKillFeed(state: LiveMatchState, value: unknown, now: number): LiveMatchState {
  const obj = killFeedPayload(value);
  if (!obj) return state;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (obj[k] !== undefined) return obj[k];
    return undefined;
  };
  const revivedName = asString(pick('revived'));
  const revive = Boolean(revivedName && revivedName.trim());
  const attackerFriendly = asBool(pick('is_attacker_teammate', 'isAttackerTeammate'));
  const entry: LiveKill = {
    at: now,
    ...(asString(pick('attacker')) ? { attacker: asString(pick('attacker')) } : {}),
    ...(asString(pick('victim')) ? { victim: asString(pick('victim')) } : {}),
    ...(resolveHeroName(asString(pick('attacker_hero_name', 'attackerHeroName')))
      ? { attackerHero: resolveHeroName(asString(pick('attacker_hero_name', 'attackerHeroName'))) } : {}),
    ...(resolveHeroName(asString(pick('victim_hero_name', 'victimHeroName')))
      ? { victimHero: resolveHeroName(asString(pick('victim_hero_name', 'victimHeroName'))) } : {}),
    ...(attackerFriendly !== undefined ? { attackerFriendly } : {}),
    ...(revive ? { revive: true } : {}),
  };
  const kills = revive || attackerFriendly === undefined
    ? state.kills
    : attackerFriendly
      ? { ...state.kills, yours: state.kills.yours + 1 }
      : { ...state.kills, theirs: state.kills.theirs + 1 };
  return { ...state, kills, feed: [entry, ...state.feed].slice(0, LIVE_FEED_CAP) };
}

/**
 * Unwrap a `kill_feed` event value into its object.
 *
 * Overwolf documents this event's data as a JSON STRING nested inside the
 * event's `name` property — the inner object is `\"`-escaped, not a real nested
 * object. Different package versions have delivered it as the bare string, as
 * the wrapper, and (once parsed upstream) as the object itself, so all three
 * are accepted rather than betting on one. Anything unparseable is dropped: a
 * kill we cannot read is better than a kill we guess at.
 */
function killFeedPayload(value: unknown): Record<string, unknown> | undefined {
  const outer = asObject(value);
  if (!outer) return undefined;
  // Already the kill object (it names an attacker or a victim).
  if ('attacker' in outer || 'victim' in outer) return outer;
  // The documented wrapper: the payload lives in `name` as a JSON string.
  for (const key of ['name', 'data', 'events']) {
    const inner = asObject(outer[key]);
    if (inner) return inner;
  }
  return undefined;
}

/**
 * The roster as a list, with `isLocal` resolved across the WHOLE roster at read
 * time rather than stamped when each row arrived.
 *
 * That ordering is load-bearing. Roster rows routinely arrive before
 * `game_info.battle_tag` does, and a row stamped at write time never gets
 * re-examined — so on a feed that names the local player late, no row is ever
 * marked local and the entire with/vs split silently degrades to "unknown".
 * Resolving here re-answers the question on every read, from whatever identity
 * is known by then. Same all-rows-at-once shape the aggregator uses at finalize.
 */
export function liveRoster(state: LiveMatchState): RosterPlayer[] {
  const localTag = battleTagName(state.localBattleTag ?? '');
  return Object.entries(state.roster)
    .sort(([a], [b]) => slotIndex(a) - slotIndex(b))
    .map(([, p]) => {
      const isLocal = Boolean(p.isLocal) || (localTag.length > 0 && battleTagName(p.battleTag ?? '') === localTag);
      return isLocal ? { ...p, isLocal: true } : p;
    });
}

/** The tracked player's own team number, when the feed reported one. */
export function localTeam(roster: RosterPlayer[]): number | undefined {
  return roster.find((p) => p.isLocal)?.team;
}

/**
 * The non-local players whose identity is known, as names — what the
 * known-players lookup is asked for. Ordered as the scoreboard is.
 */
export function liveOpponentNames(roster: RosterPlayer[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of roster) {
    if (p.isLocal) continue;
    const key = battleTagName(p.battleTag ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p.battleTag!.trim());
  }
  return out;
}

/** `roster_7` → 7, for stable scoreboard ordering; unparseable slots sort last. */
function slotIndex(slot: string): number {
  const n = asNumber(slot.replace(/^\D+/, ''));
  return n ?? Number.MAX_SAFE_INTEGER;
}

function shallowEqual(a: RosterPlayer, b: RosterPlayer): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof RosterPlayer>;
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}
