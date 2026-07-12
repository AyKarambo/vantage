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
import { battleTagName, emptyMatch, type GepMessage, type HeroStat, type MatchRecord, type Role, type RosterPlayer } from '../model';
import { K } from './keys';
import { asNumber, asString, parseRoster } from './gepValues';
import { resolveMapId } from '../resolvers/mapId';

/** The stateful accumulator: feed messages to `handle`, receive a finished record on match end. */
export class MatchAggregator {
  private now: () => number;
  private synthetic = 0;
  private current: MutableMatch = newMutable();

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  reset(): void {
    this.current = newMutable();
  }

  /** Feed one normalized GEP message. Returns a finished record on match end. */
  handle(msg: GepMessage): MatchRecord | null {
    if (isMatchStartMessage(msg)) {
      this.current = newMutable();
      this.current.record.startedAt = this.now();
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
        case K.partySize:
          rec.groupSize = asNumber(msg.value) ?? rec.groupSize;
          break;
      }
      return;
    }

    if (feature === K.matchInfo || feature === K.roster) {
      if (key === K.map) rec.mapName = resolveMapId(asString(msg.value)) ?? rec.mapName;
      else if (key === K.pseudoMatchId || key === K.matchId)
        rec.matchId = asString(msg.value) ?? rec.matchId;
      else if (key === K.outcome) rec.outcome = asString(msg.value) ?? rec.outcome;
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

    if (player.heroName && !rec.heroes.includes(player.heroName)) rec.heroes.push(player.heroName);
    if (player.heroRole) rec.heroRole = player.heroRole;

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
      if (c.currentHero) c.perHero.push(closeHero(c.currentHero, c.currentRole, c.heroStart, c.lastCum));
      c.currentHero = player.heroName;
      c.currentRole = player.heroRole ?? c.currentRole;
      c.heroStart = { ...c.lastCum }; // new hero starts at the swap-point cumulative
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

  private tallyRound(outcome: string | undefined): void {
    const o = (outcome ?? '').toLowerCase();
    if (o.includes('win') || o.includes('victory')) this.current.roundWins++;
    else if (o.includes('los') || o.includes('defeat')) this.current.roundLosses++;
  }

  // --- start/end detection ---------------------------------------------------

  private finalize(): MatchRecord | null {
    const rec = this.current.record;
    rec.endedAt = this.now();
    if (rec.startedAt) {
      rec.durationMinutes = Math.max(0, Math.round((rec.endedAt - rec.startedAt) / 60000));
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

    if (this.current.currentHero) {
      this.current.perHero.push(
        closeHero(this.current.currentHero, this.current.currentRole, this.current.heroStart, this.current.lastCum),
      );
    }
    if (this.current.perHero.length) rec.perHero = this.current.perHero;

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

interface MutableMatch {
  record: MatchRecord;
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
  // per-hero tracking
  perHero: HeroStat[];
  currentHero?: string;
  currentRole?: string;
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
  return { record: emptyMatch(''), rosterLocal: {}, rosterAll: new Map(), roundWins: 0, roundLosses: 0, perHero: [], heroStart: zeroSnap(), lastCum: zeroSnap() };
}

/** Numeric slot of a `roster_N` key, for stable scoreboard ordering. */
function slotOf(key: string): number {
  const n = Number(key.slice(key.lastIndexOf('_') + 1));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** A hero's stats = cumulative-out − cumulative-in, floored at 0. */
function closeHero(hero: string, role: string | undefined, start: Snap, end: Snap): HeroStat {
  return {
    hero,
    role: toRole(role),
    eliminations: Math.max(0, end.eliminations - start.eliminations),
    deaths: Math.max(0, end.deaths - start.deaths),
    assists: Math.max(0, end.assists - start.assists),
    damage: Math.max(0, end.damage - start.damage),
    healing: Math.max(0, end.healing - start.healing),
    mitigation: Math.max(0, end.mitigation - start.mitigation),
  };
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

function nameMatches(msg: GepMessage, name: string): boolean {
  return msg.key?.toLowerCase() === name || msg.feature?.toLowerCase() === name;
}

function isLocal(playerTag: string | undefined, localTag: string | undefined): boolean {
  if (!playerTag || !localTag) return false;
  const a = battleTagName(playerTag);
  return a === battleTagName(localTag) && a.length > 0;
}
