/**
 * Accumulates the GEP message stream into one {@link MatchRecord} per match.
 *
 * GEP delivers flat `{ feature, category, key, value }` items. We keep the latest
 * value per (feature,key), resolve the local player out of the roster by BattleTag,
 * and emit a finished record when the match ends.
 *
 * Pure and Electron-free — the GEP edge in `src/main` owns the I/O and feeds
 * normalized messages in (guardrail #1: GEP is the only live data source).
 */
import { battleTagName, emptyMatch, type GepMessage, type HeroStat, type MatchRecord, type Role, type RosterPlayer, type RoundSpan } from '../model';
import { isPlayedSegment, mergeHeroStats } from '../perHero';
import { K } from './keys';
import { asNumber, asString, parseRoster } from './gepValues';
import { resolveMapId } from '../resolvers/mapId';
import { mapMode as staticMapMode } from '../maps';
import { overlapMinutes, playWindowsOf, windowMinutes, type MapModeResolver } from '../playedTime';

export interface MatchAggregatorOptions {
  /**
   * Map name → mode, for the per-mode setup lock removed from each round's
   * play window. Defaults to the built-in table; callers holding the user's
   * map catalog pass its resolver so edited/added maps resolve too.
   */
  mapModeOf?: MapModeResolver;
}

/** The stateful accumulator: feed messages to `handle`, receive a finished record on match end. */
export class MatchAggregator {
  private now: () => number;
  private mapModeOf: MapModeResolver;
  private synthetic = 0;
  private current: MutableMatch = newMutable();

  constructor(now: () => number = () => Date.now(), options: MatchAggregatorOptions = {}) {
    this.now = now;
    this.mapModeOf = options.mapModeOf ?? staticMapMode;
  }

  /**
   * Latest party size GEP reported (solo normalized to 1). GEP pushes
   * `party_player_count` only when it CHANGES — typically in the lobby, before
   * `match_start` — so it must outlive the per-match reset in `handle` and
   * `finalize`, or the next match would silently lose its group size.
   */
  private partyCount?: number;

  /** A checkpoint from before a restart, waiting for the feed to name its match. */
  private resume?: AggregatorCheckpoint;

  reset(): void {
    this.current = newMutable();
    this.partyCount = undefined;
    this.resume = undefined;
  }

  /**
   * A serializable copy of the match in progress, for surviving an app restart
   * mid-match; `null` when no match is running or the feed hasn't named it yet
   * (`match_id` is what a restart resumes by).
   */
  checkpoint(): AggregatorCheckpoint | null {
    const c = this.current;
    if (!c.gameMatchId || (c.record.startedAt == null && c.rounds.length === 0)) return null;
    const { rosterAll, ...rest } = c;
    return { version: 1, savedAt: this.now(), match: JSON.parse(JSON.stringify({ ...rest, rosterAll: [...rosterAll] })) };
  }

  /**
   * Hold a checkpoint from before a restart. It is adopted when the feed next
   * names the SAME `match_id` — GEP re-sends it in the snapshot it delivers on
   * attach — and dropped for any other match. Too old to be the match still
   * running ({@link RESUME_MAX_AGE_MS}) or unreadable, it is ignored.
   */
  armResume(cp: unknown): void {
    this.resume = isCheckpoint(cp) && this.now() - cp.savedAt <= RESUME_MAX_AGE_MS ? cp : undefined;
  }

  /** True while a checkpoint is held, waiting for its match to be named. */
  hasPendingResume(): boolean {
    return this.resume !== undefined;
  }

  /**
   * The feed named the running match. Adopt a held checkpoint for that same
   * match — but only into a fresh session (nothing started or timed yet), so a
   * live match is never overwritten. Facts this session already received
   * (map, game type, BattleTag, party) win over the checkpoint's older copy.
   */
  private resumeIfSameMatch(gameMatchId: string): void {
    const cp = this.resume;
    if (!cp) return;
    this.resume = undefined;
    const fresh = this.current.record.startedAt == null && this.current.rounds.length === 0;
    if (cp.match.gameMatchId !== gameMatchId || !fresh) return;
    const now = this.current.record;
    const restored = cp.match;
    this.current = { ...restored, rosterAll: new Map(restored.rosterAll) } as MutableMatch;
    const rec = this.current.record;
    for (const k of ['gameType', 'queueType', 'mapName', 'battleTag', 'groupSize'] as const) {
      if (now[k] !== undefined) (rec as unknown as Record<string, unknown>)[k] = now[k];
    }
  }

  /**
   * Forget the held party size without touching the match in progress — for
   * the game exiting, after which a relaunch starts a fresh (party-less) session.
   */
  clearPartyCount(): void {
    this.partyCount = undefined;
  }

  /** True once a party size is held (pushed by GEP or seeded from a probe). */
  hasPartyCount(): boolean {
    return this.partyCount !== undefined;
  }

  /**
   * Gap-filler for a `getInfo()` probe, for when the lobby update was missed
   * (e.g. the app started mid-session). Never overrides a pushed update: it is a
   * no-op when a count is already held, and leaves a group size already on the
   * in-progress record alone.
   */
  seedPartyCount(n: number | undefined): void {
    if (n === undefined || this.partyCount !== undefined) return;
    const count = normalizePartyCount(n);
    this.partyCount = count;
    const rec = this.current.record;
    if (rec.groupSize === undefined) rec.groupSize = count;
  }

  /** Feed one normalized GEP message. Returns a finished record on match end. */
  handle(msg: GepMessage): MatchRecord | null {
    if (isMatchStartMessage(msg)) {
      this.current = newMutable();
      this.current.record.startedAt = this.now();
      // The lobby's party size was reported before match_start and won't be re-sent.
      if (this.partyCount !== undefined) this.current.record.groupSize = this.partyCount;
      return null;
    }

    // Round boundaries. Real captures: `round_start` fires ~28 s after
    // `match_start` (after hero select) and `round_end` → next `round_start` is
    // ~1 s, so the between-round setup lives INSIDE the next round; the mode's
    // setup lock is removed from each round by `playWindowsOf` downstream.
    if (isRoundStartMessage(msg)) {
      const now = this.now();
      const open = openRound(this.current.rounds);
      if (open) open.endedAt = now; // a missed round_end: close it as the next round begins
      this.current.rounds.push({ startedAt: now });
      return null;
    }
    if (isRoundEndMessage(msg)) {
      const open = openRound(this.current.rounds);
      if (open) open.endedAt = this.now(); // no open round → stray event, ignored
      return null;
    }

    this.apply(msg);

    if (isMatchEndMessage(msg)) {
      return this.finalize();
    }
    return null;
  }

  // --- message application ---------------------------------------------------

  private apply(msg: GepMessage): void {
    const rec = this.current.record;
    const feature = msg.feature?.toLowerCase();
    const key = msg.key?.toLowerCase();

    if (feature === K.gameInfo) {
      switch (key) {
        case K.battleTag:
          rec.battleTag = asString(msg.value) ?? rec.battleTag;
          break;
        case K.gameType:
          rec.gameType = asString(msg.value) ?? rec.gameType;
          break;
        case K.queueType:
          rec.queueType = asString(msg.value) ?? rec.queueType;
          break;
        case K.partySize: {
          const n = asNumber(msg.value);
          if (n !== undefined) {
            // 0 arrives after a match / on leaving a party and means solo.
            this.partyCount = normalizePartyCount(n);
            rec.groupSize = this.partyCount;
          }
          break;
        }
      }
      return;
    }

    if (feature === K.matchInfo || feature === K.roster) {
      if (key === K.map) rec.mapName = resolveMapId(asString(msg.value)) ?? rec.mapName;
      else if (key === K.matchId) {
        const id = asString(msg.value);
        // The game's own match id is stable across an app restart — the key a
        // checkpoint resumes by (see resumeIfSameMatch).
        if (id) {
          this.resumeIfSameMatch(id);
          this.current.gameMatchId = id;
          this.current.record.matchId = id;
        }
      }
      else if (key === K.pseudoMatchId)
        rec.matchId = asString(msg.value) ?? rec.matchId;
      else if (key === K.outcome) {
        const outcome = asString(msg.value);
        if (outcome !== undefined) {
          rec.outcome = outcome;
          // Captures show the outcome 2–5 ms BEFORE the final round_end — the
          // best stand-in for a round_end the feed never delivered.
          this.current.outcomeAt = this.now();
        }
      }
      else if (key === K.score) rec.finalScore = asString(msg.value) ?? rec.finalScore;
      else if (key === K.roundOutcome) this.tallyRound(asString(msg.value));
      else if (key === K.eliminations) this.current.matchElims = asNumber(msg.value);
      else if (key === K.deaths) this.current.matchDeaths = asNumber(msg.value);
      else if (key === K.assists) this.current.matchAssists = asNumber(msg.value);
      else if (key.startsWith(K.roster)) this.applyRoster(key, msg.value);
      return;
    }
  }

  private applyRoster(key: string, value: unknown): void {
    const player = parseRoster(value);
    if (!player) return;
    // As the scoreboard tears down at match end, GEP resets each roster slot to
    // an empty object (`roster_N = {}`) — observed in a real capture, arriving
    // BEFORE match_end fires. Such a snapshot carries no identity, hero, or stat;
    // ignore it so it can't overwrite the last rich snapshot we retained (which
    // would blank the whole scoreboard).
    if (!hasRosterContent(player)) return;

    // Keep the latest snapshot per roster slot so the finished record carries
    // the full scoreboard GEP chose to report (local team only on some patches).
    this.current.rosterAll.set(key, player);

    const rec = this.current.record;
    // Local-player identity: GEP's roster `is_local` flag is the documented signal.
    // Seed `rec.battleTag` from the local entry so the account resolves even when the
    // `game_info.battle_tag` event never arrives; BattleTag matching stays the fallback.
    if (player.isLocal && player.battleTag && !rec.battleTag) rec.battleTag = player.battleTag;
    // Accumulate stats ONLY for the identified local player: once a battleTag is
    // known, match against it — so a second or mis-flagged `is_local` entry can't
    // interleave a stranger's cumulative stats into the per-hero deltas. Before a
    // battleTag is known, trust the `is_local` flag to bootstrap identity.
    const isLocalPlayer = rec.battleTag ? isLocal(player.battleTag, rec.battleTag) : Boolean(player.isLocal);
    if (!isLocalPlayer) return;

    // heroes[]/heroRole are derived from the surviving perHero segments in
    // finalize() — a spawn-only swap must never appear in either (guardrail
    // against the eager, unfiltered writes this replaced).

    const r = this.current.rosterLocal;
    this.current.rosterLocal = {
      kills: player.kills ?? r.kills,
      deaths: player.deaths ?? r.deaths,
      assists: player.assists ?? r.assists,
      damage: player.damage ?? r.damage,
      healing: player.healing ?? r.healing,
      mitigation: player.mitigation ?? r.mitigation,
    };

    this.trackHero(player);
  }

  /**
   * Build per-hero stats by delta-tracking the roster. GEP roster stats are
   * match-cumulative (across hero swaps), so a hero's stats = cumulative when it
   * was swapped out − cumulative when it was swapped in. This cumulative model is
   * the one assumption to verify against a real capture; deltas are floored at 0.
   */
  private trackHero(player: RosterPlayer): void {
    const c = this.current;
    if (player.heroName && player.heroName !== c.currentHero) {
      const nowMs = this.now();
      // Must read before closeCurrentHeroSegment (it never touches currentHeroStartMs,
      // but this keeps the "is this the very first hero" check explicit and ordered).
      // undefined here means no hero has ever been current — true regardless of
      // whether earlier segments qualified as played, unlike a perHero.length check
      // would be (that would wrongly re-anchor to match start after any exclusion).
      const isFirstHero = c.currentHeroStartMs === undefined;
      this.closeCurrentHeroSegment(nowMs);
      c.currentHero = player.heroName;
      c.currentRole = player.heroRole ?? c.currentRole;
      c.heroStart = { ...c.lastCum }; // new hero starts at the swap-point cumulative
      // First hero's clock starts at match start; later heroes at the swap moment.
      c.currentHeroStartMs = isFirstHero && c.record.startedAt != null ? c.record.startedAt : nowMs;
    } else if (player.heroRole) {
      c.currentRole = player.heroRole;
    }
    c.lastCum = {
      eliminations: player.kills ?? c.lastCum.eliminations,
      deaths: player.deaths ?? c.lastCum.deaths,
      assists: player.assists ?? c.lastCum.assists,
      damage: player.damage ?? c.lastCum.damage,
      healing: player.healing ?? c.lastCum.healing,
      mitigation: player.mitigation ?? c.lastCum.mitigation,
    };
  }

  /**
   * Close the currently active hero segment, if any, keeping it only when
   * {@link isPlayedSegment} confirms real evidence of play. Shared by the
   * mid-match swap branch ({@link trackHero}) and the final-hero close
   * ({@link finalize}) so the two can never drift apart.
   */
  private closeCurrentHeroSegment(endMs: number): void {
    const c = this.current;
    if (!c.currentHero) return;
    // Only the raw span and the stat delta are banked here. Minutes are timed
    // once, in finalize(), against the COMPLETE round list — a segment that
    // closed before the first round_start would otherwise be timed on the wall
    // clock while its siblings were clipped to the play windows, leaving one
    // record with hero minutes on two different bases.
    c.segments.push({
      hero: c.currentHero,
      role: c.currentRole,
      startMs: c.currentHeroStartMs ?? endMs,
      endMs,
      start: c.heroStart,
      end: { ...c.lastCum },
    });
  }

  /**
   * Time every banked segment and keep the ones {@link isPlayedSegment} confirms
   * as real play. With round events a hero's minutes are PLAYED minutes — the
   * segment clipped to the rounds' play windows, so hero select, the setup locks
   * and the post-match scoreboard fall outside them. Without them (older feeds)
   * the wall-clock span is kept exactly as before. Note the sped-up dev
   * simulation DOES emit rounds, but they are shorter than a real setup lock, so
   * its segments clip to zero — `OW_SYNC_SIM_SPEED=1` to exercise this.
   */
  private closeSegments(rounds: RoundSpan[]): HeroStat[] {
    const windows = rounds.length ? playWindowsOf(rounds, this.mapModeOf(this.current.record.mapName ?? '')) : [];
    return this.current.segments
      .map((s) => {
        const minutes = rounds.length
          ? overlapMinutes(s.startMs, s.endMs, windows)
          : Math.max(0, (s.endMs - s.startMs) / 60000);
        return closeHero(s.hero, s.role, s.start, s.end, minutes);
      })
      .filter(isPlayedSegment);
  }

  private tallyRound(outcome: string | undefined): void {
    const o = (outcome ?? '').toLowerCase();
    if (o.includes('win') || o.includes('victory')) this.current.roundWins++;
    else if (o.includes('los') || o.includes('defeat')) this.current.roundLosses++;
  }

  // --- start/end detection ---------------------------------------------------

  private finalize(): MatchRecord | null {
    const rec = this.current.record;
    const endedAt = this.now();
    rec.endedAt = endedAt;
    if (rec.startedAt != null) {
      // Wall clock, rounded — the displayed match length for a feed that sent
      // no rounds; the round time below replaces it when rounds were seen.
      // NOT the per-10 divisor.
      rec.durationMinutes = Math.max(0, Math.round((endedAt - rec.startedAt) / 60000));
    }

    // Prefer roster-derived local stats; fall back to match-level counters.
    const r = this.current.rosterLocal;
    rec.eliminations = r.kills ?? this.current.matchElims;
    rec.deaths = r.deaths ?? this.current.matchDeaths;
    rec.assists = r.assists ?? this.current.matchAssists;
    rec.damage = r.damage;
    rec.healing = r.healing;
    rec.mitigation = r.mitigation;

    if (!rec.finalScore && (this.current.roundWins || this.current.roundLosses)) {
      rec.finalScore = `${this.current.roundWins}–${this.current.roundLosses}`;
    }

    // Rounds → played time. A round still open at match end (its round_end was
    // never delivered) closes at the outcome, which arrives a few ms before the
    // final round_end in real captures — else at match end. Closed BEFORE the
    // final hero segment so its minutes are clipped against every round.
    let rounds: RoundSpan[] = [];
    if (this.current.rounds.length) {
      const open = openRound(this.current.rounds);
      if (open) open.endedAt = this.current.outcomeAt ?? endedAt;
      rounds = this.current.rounds.map((r) => ({ startedAt: r.startedAt, endedAt: r.endedAt ?? endedAt }));
      rec.rounds = rounds;
      const played = windowMinutes(playWindowsOf(rounds, this.mapModeOf(rec.mapName ?? '')));
      if (played > 0) rec.playedMinutes = played;
      // The displayed match length is the ROUND time — what Overwatch's own
      // clock counts. It is stopped through hero select (~28 s before the first
      // round) and each ~1 s round change, and the post-match scoreboard falls
      // after the last round. Checked against a match the game reported as
      // 20:06. The per-10 divisor above is separate and stays as it was.
      const roundMinutes = windowMinutes(rounds);
      if (roundMinutes > 0) rec.durationMinutes = Math.round(roundMinutes);
    }

    this.closeCurrentHeroSegment(endedAt);
    // Time every segment against the finished round list, then collapse same-hero
    // swaps (Tracer → Genji → Tracer) into one line each and derive
    // heroes[]/heroRole from what survived, in the first-seen order mergeHeroStats
    // preserves — heroes[]/perHero[]/heroRole can never drift apart (spawn-only
    // swaps are dropped here, so a match with none left keeps its default empty
    // heroes[] and an unset heroRole).
    const played = this.closeSegments(rounds);
    if (played.length) {
      rec.perHero = mergeHeroStats(played);
      rec.heroes = rec.perHero.map((h) => h.hero);
      // Last QUALIFYING segment, not the merged/first-seen order — heroRole means
      // "the hero the player actually ended the match on".
      rec.heroRole = played[played.length - 1].role;
    }

    if (this.current.rosterAll.size) {
      rec.roster = [...this.current.rosterAll.entries()]
        .sort(([a], [b]) => slotOf(a) - slotOf(b))
        .map(([, player]) =>
          player.isLocal || isLocal(player.battleTag, rec.battleTag) ? { ...player, isLocal: true } : player,
        );
    }

    if (!rec.matchId) {
      // No pseudo_match_id seen — synthesize so dedupe still has a key this session.
      rec.matchId = `synthetic-${rec.startedAt ?? rec.endedAt}-${++this.synthetic}`;
    }

    const finished = rec;
    this.current = newMutable();
    return finished;
  }
}

// --- start/end detection (exported: the GEP status monitor shares these so
// "a match is in progress" can never drift between pipeline and indicator) ----

/** True when the message marks a match beginning. */
export function isMatchStartMessage(msg: GepMessage): boolean {
  return msg.kind === 'event' && nameMatches(msg, 'match_start');
}

/**
 * True when the feed reports a match RUNNING (`game_info.game_state =
 * match_in_progress`). Unlike `match_start` this is state, not an event: GEP
 * re-sends it in the snapshot it delivers on attach, so it is the only signal
 * left when the app (or GEP) attaches to a match already under way — the
 * `match_start` event fired before anyone was listening.
 */
export function isMatchInProgressMessage(msg: GepMessage): boolean {
  return (
    msg.feature?.toLowerCase() === K.gameInfo &&
    msg.key?.toLowerCase() === K.gameState &&
    asString(msg.value)?.toLowerCase() === 'match_in_progress'
  );
}

/** True when the message marks a GEP round beginning (`match_info.round_start`). */
export function isRoundStartMessage(msg: GepMessage): boolean {
  return msg.kind === 'event' && nameMatches(msg, K.roundStart);
}

/** True when the message marks a GEP round ending (`match_info.round_end`). */
export function isRoundEndMessage(msg: GepMessage): boolean {
  return msg.kind === 'event' && nameMatches(msg, K.roundEnd);
}

/** True when the message marks a match ending (event or game_state fallback). */
export function isMatchEndMessage(msg: GepMessage): boolean {
  if (msg.kind === 'event' && nameMatches(msg, 'match_end')) return true;
  // Fallback: game_info.game_state transitioning to an "ended" value.
  return (
    msg.feature?.toLowerCase() === K.gameInfo &&
    msg.key?.toLowerCase() === K.gameState &&
    /ended|finished|complete/i.test(asString(msg.value) ?? '')
  );
}

// --- internal mutable state ---------------------------------------------------

/** How old a checkpoint may be and still be the match running now — longer than any real match. */
export const RESUME_MAX_AGE_MS = 90 * 60_000;

/** The match in progress, serialized by {@link MatchAggregator.checkpoint}. */
export interface AggregatorCheckpoint {
  version: 1;
  /** ms epoch the checkpoint was taken. */
  savedAt: number;
  /** The in-progress state, with the roster map as entries. Opaque to callers. */
  match: Omit<MutableMatch, 'rosterAll'> & { rosterAll: Array<[string, RosterPlayer]> };
}

function isCheckpoint(cp: unknown): cp is AggregatorCheckpoint {
  const c = cp as AggregatorCheckpoint | null;
  return Boolean(
    c && c.version === 1 && typeof c.savedAt === 'number' && c.match &&
    typeof c.match.gameMatchId === 'string' && c.match.record && Array.isArray(c.match.rounds) &&
    Array.isArray(c.match.segments) && Array.isArray(c.match.rosterAll),
  );
}

interface MutableMatch {
  record: MatchRecord;
  /** The game's own `match_id` — stable across an app restart, unlike anything Vantage generates. */
  gameMatchId?: string;
  rosterLocal: Pick<
    RosterPlayer,
    'kills' | 'deaths' | 'assists' | 'damage' | 'healing' | 'mitigation'
  >;
  /** Latest roster snapshot per `roster_N` key — the whole reported scoreboard. */
  rosterAll: Map<string, RosterPlayer>;
  matchElims?: number;
  matchDeaths?: number;
  matchAssists?: number;
  roundWins: number;
  roundLosses: number;
  /** Every GEP round observed (`round_start` → `round_end`), in order; the last may still be open. */
  rounds: Array<{ startedAt: number; endedAt?: number }>;
  /** When `match_outcome` arrived — closes a round whose `round_end` never came. */
  outcomeAt?: number;
  // per-hero tracking
  /** Raw hero spans, banked as they close and timed once in finalize() against the finished round list. */
  segments: Array<{ hero: string; role?: string; startMs: number; endMs: number; start: Snap; end: Snap }>;
  currentHero?: string;
  currentRole?: string;
  /** Wall-clock ms the current hero segment began (match start for the first hero). */
  currentHeroStartMs?: number;
  heroStart: Snap;
  lastCum: Snap;
}

interface Snap {
  eliminations: number;
  deaths: number;
  assists: number;
  damage: number;
  healing: number;
  mitigation: number;
}

function zeroSnap(): Snap {
  return { eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0 };
}

function newMutable(): MutableMatch {
  return { record: emptyMatch(''), rosterLocal: {}, rosterAll: new Map(), roundWins: 0, roundLosses: 0, rounds: [], segments: [], heroStart: zeroSnap(), lastCum: zeroSnap() };
}

/** The round still running (no `endedAt` yet), if any — always the last one pushed. */
function openRound(rounds: MutableMatch['rounds']): MutableMatch['rounds'][number] | undefined {
  const last = rounds[rounds.length - 1];
  return last && last.endedAt === undefined ? last : undefined;
}

/**
 * True when a roster snapshot carries anything worth retaining — identity, a
 * hero, or any stat. A slot cleared to `{}` at match teardown has none of these,
 * so it is skipped rather than overwriting the previous rich snapshot. `team`
 * alone doesn't count: it never arrives without the rest of a real row.
 *
 * GEP's "not revealed" sentinel — `hero_name`/`hero_role: "UNKNOWN"`, observed
 * resetting every roster slot (including the local player's) on a real
 * teardown broadcast — doesn't count as content either. `heroName` is already
 * normalized to undefined for this by {@link resolveHeroName}; `heroRole` is
 * raw text here, so it needs the same check inline.
 */
function hasRosterContent(p: RosterPlayer): boolean {
  return Boolean(p.battleTag || p.heroName || (p.heroRole && !isUnknownToken(p.heroRole))) ||
    p.kills != null || p.deaths != null || p.assists != null ||
    p.damage != null || p.healing != null || p.mitigation != null;
}

function isUnknownToken(value: string): boolean {
  return value.trim().toUpperCase() === 'UNKNOWN';
}

/** Numeric slot of a `roster_N` key, for stable scoreboard ordering. */
function slotOf(key: string): number {
  const n = Number(key.slice(key.lastIndexOf('_') + 1));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * A hero's stats = cumulative-out − cumulative-in, floored at 0. `minutes` is the
 * timed segment length; it's only attached when positive, so a degenerate 0-length
 * segment stays absent and consumers fall back to an equal split.
 */
function closeHero(hero: string, role: string | undefined, start: Snap, end: Snap, minutes: number): HeroStat {
  const stat: HeroStat = {
    hero,
    role: toRole(role),
    eliminations: Math.max(0, end.eliminations - start.eliminations),
    deaths: Math.max(0, end.deaths - start.deaths),
    assists: Math.max(0, end.assists - start.assists),
    damage: Math.max(0, end.damage - start.damage),
    healing: Math.max(0, end.healing - start.healing),
    mitigation: Math.max(0, end.mitigation - start.mitigation),
  };
  if (minutes > 0) stat.minutes = minutes;
  return stat;
}

function toRole(raw: string | undefined): Role | undefined {
  switch ((raw ?? '').toLowerCase()) {
    case 'tank': return 'tank';
    case 'damage': case 'dps': case 'offense': return 'damage';
    case 'support': case 'healer': return 'support';
    default: return undefined;
  }
}

// --- helpers ------------------------------------------------------------------

/** GEP reports 0 (and 1) for a solo queue; both mean a group of one. */
function normalizePartyCount(n: number): number {
  return n <= 1 ? 1 : n;
}

function nameMatches(msg: GepMessage, name: string): boolean {
  return msg.key?.toLowerCase() === name || msg.feature?.toLowerCase() === name;
}

function isLocal(playerTag: string | undefined, localTag: string | undefined): boolean {
  if (!playerTag || !localTag) return false;
  const a = battleTagName(playerTag);
  return a === battleTagName(localTag) && a.length > 0;
}
