import { battleTagName, type GepMessage, type RosterPlayer } from './model';
import { isMatchEndMessage, isMatchStartMessage } from './matchAggregator';
import { K } from './matchAggregator/keys';
import { asNumber, asObject, asString, asBool, parseRoster } from './matchAggregator/gepValues';
import { deployableOf, resolveHero } from './resolvers/hero';
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
 * invent one, the live board reports DEATHS per team, summed off the roster.
 *
 * Deaths, not eliminations, on purpose: one death credits up to five
 * eliminations (everyone who contributed), so a team's elimination total says
 * nothing about how many players actually died — one solo death against five
 * credited eliminations on the other side would read 5–1 although each side lost
 * exactly one player. And it is read off the roster rather than counted from the
 * kill feed so it can never disagree with the D column on the same screen, and
 * so a destroyed turret/pylon or a revive (Mercy, Anran's self-revive) cannot be
 * mistaken for a death — the game's own death counter only knows players.
 */

/** One entry from the `kill_feed` event stream — shown as a strip, never summed. */
export interface LiveKill {
  /** ms epoch this was observed. */
  at: number;
  attacker?: string;
  victim?: string;
  attackerHero?: string;
  victimHero?: string;
  /** True when the ATTACKER was on the tracked player's team. */
  attackerFriendly?: boolean;
  /** A revive rather than a kill — nobody died. */
  revive?: boolean;
  /**
   * The victim was a hero's DEPLOYABLE (a turret, a pylon, a trap), not a
   * player. Overwatch reports destroying one as an ordinary kill event. Kept in
   * the feed — it did happen — but marked so it reads as a destroy, not a kill.
   */
  deployable?: { hero: string; label: string };
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
  /** Most recent kill-feed entries, newest first, capped at {@link LIVE_FEED_CAP}. */
  feed: LiveKill[];
}

export const INITIAL_LIVE_MATCH: LiveMatchState = {
  phase: 'idle',
  roster: {},
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
    return { ...INITIAL_LIVE_MATCH, phase: 'live', startedAt: now, roster: {}, feed: [] };
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
 * Record one kill-feed entry for the "Kill feed" strip. Nothing is counted
 * here — team deaths come off the roster (see {@link liveTeamTotals}).
 *
 * Revives carry the same event and read differently (supporter + revived rather
 * than attacker + victim): `revived` being non-empty is the documented
 * discriminator. A destroyed deployable is tagged for the same reason — both are
 * real feed lines, neither is a player dying.
 */
function applyKillFeed(state: LiveMatchState, value: unknown, now: number): LiveMatchState {
  const obj = killFeedPayload(value);
  if (!obj) return state;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (obj[k] !== undefined) return obj[k];
    return undefined;
  };
  const revivedName = asString(pick('revived'))?.trim();
  const revive = Boolean(revivedName);
  const attackerFriendly = asBool(pick('is_attacker_teammate', 'isAttackerTeammate'));
  const rawVictimHero = asString(pick('victim_hero_name', 'victimHeroName'));
  // A revive names the SUPPORTER and the REVIVED, not an attacker and a victim
  // — reading the kill fields for one produced "someone revived a teammate".
  const actor = revive ? asString(pick('supporter')) : asString(pick('attacker'));
  const actorHero = revive
    ? asString(pick('supporter_hero_name', 'supporterHeroName'))
    : asString(pick('attacker_hero_name', 'attackerHeroName'));
  const actorHeroId = revive
    ? asString(pick('supporter_hero_id', 'supporterHeroId'))
    : asString(pick('attacker_hero_id', 'attackerHeroId'));
  const subject = revive ? revivedName : asString(pick('victim'));
  const subjectHero = revive ? asString(pick('revived_hero_name', 'revivedHeroName')) : rawVictimHero;
  const subjectHeroId = revive
    ? asString(pick('revived_hero_id', 'revivedHeroId'))
    : asString(pick('victim_hero_id', 'victimHeroId'));
  const deployable = revive ? undefined : deployableOf(rawVictimHero);
  const attackerHero = resolveHero(actorHero, actorHeroId);
  const victimHero = resolveHero(subjectHero, subjectHeroId);
  const entry: LiveKill = {
    at: now,
    ...(actor ? { attacker: actor } : {}),
    ...(subject ? { victim: subject } : {}),
    ...(attackerHero ? { attackerHero } : {}),
    ...(victimHero ? { victimHero } : {}),
    ...(attackerFriendly !== undefined ? { attackerFriendly } : {}),
    ...(revive ? { revive: true } : {}),
    ...(deployable ? { deployable } : {}),
  };
  return { ...state, feed: [entry, ...state.feed].slice(0, LIVE_FEED_CAP) };
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
  // Already the kill object. A kill names an attacker or a victim; a revive (a
  // Mercy resurrect, Anran's self-revive) names a supporter and the revived, and
  // may carry no attacker/victim keys at all — without these two it would be
  // dropped as unreadable instead of showing up in the feed.
  if ('attacker' in outer || 'victim' in outer || 'supporter' in outer || 'revived' in outer) return outer;
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

/** One side's summed scoreboard output for the live match. */
export interface LiveTeamTotals {
  damage: number;
  healing: number;
  /** Players of this side who died, summed — one per death, however many credited it. */
  deaths: number;
}

/**
 * Damage, healing and deaths summed per side, so the board can answer "who is
 * out-damaging whom" and "who is losing more players" at a glance.
 *
 * Read off the ROSTER, not the kill feed — which matters twice over. It means
 * these survive the kill feed being switched off (they are TAB-screen numbers
 * the game itself is showing, not derived from kill events), and it means they
 * are available on any feed that reports teams, even one that never emits a
 * single `kill_feed`. For deaths it also means the total is, by construction,
 * the sum of the D column printed right above it, and that a destroyed
 * deployable or a revive can never be counted: the game's death counter only
 * knows players.
 *
 * `known` is false unless the feed named the local player's team AND at least
 * one other player's. Without both there is no "your side" to sum against, and
 * a pair of totals with nothing to compare them to would invite exactly the
 * misreading this exists to prevent.
 *
 * `deathsKnown` is stricter: at least one player on EACH side must have
 * reported a `deaths` value. A side where nobody did would sum to a confident 0,
 * which reads as "nobody has died" — a different (and wrong) claim — so the
 * deaths line is withheld instead, the way the match-detail scoreboard leaves
 * an unreported column blank rather than zero-filled.
 */
export function liveTeamTotals(roster: RosterPlayer[]): {
  yours: LiveTeamTotals;
  theirs: LiveTeamTotals;
  known: boolean;
  deathsKnown: boolean;
} {
  const mine = localTeam(roster);
  const yours: LiveTeamTotals = { damage: 0, healing: 0, deaths: 0 };
  const theirs: LiveTeamTotals = { damage: 0, healing: 0, deaths: 0 };
  let sawOther = false;
  let yoursReportedDeaths = false;
  let theirsReportedDeaths = false;
  for (const p of roster) {
    if (p.team === undefined) continue;
    if (mine === undefined) continue;
    const isYours = p.team === mine;
    const side = isYours ? yours : theirs;
    if (!isYours) sawOther = true;
    side.damage += p.damage ?? 0;
    side.healing += p.healing ?? 0;
    side.deaths += p.deaths ?? 0;
    if (p.deaths !== undefined) {
      if (isYours) yoursReportedDeaths = true;
      else theirsReportedDeaths = true;
    }
  }
  const known = mine !== undefined && sawOther;
  return { yours, theirs, known, deathsKnown: known && yoursReportedDeaths && theirsReportedDeaths };
}
