import { emptyMatch, type GepMessage, type HeroStat, type MatchRecord, type Role, type RosterPlayer } from './model';

/**
 * Accumulates the GEP message stream into one {@link MatchRecord} per match.
 *
 * GEP delivers flat `{ feature, category, key, value }` items. We keep the latest
 * value per (feature,key), resolve the local player out of the roster by BattleTag,
 * and emit a finished record when the match ends.
 *
 * NOTE: GEP feature/key spellings for Overwatch 2 can shift between game patches.
 * All names we depend on are centralized in the `K` table below so they are easy to
 * adjust after inspecting a real capture (every raw message is logged by the app).
 */
const K = {
  gameInfo: 'game_info',
  matchInfo: 'match_info',
  roster: 'roster',
  battleTag: 'battle_tag',
  gameType: 'game_type',
  queueType: 'game_queue_type',
  gameState: 'game_state',
  partySize: 'party_player_count',
  map: 'map',
  pseudoMatchId: 'pseudo_match_id',
  matchId: 'match_id',
  outcome: 'match_outcome',
  roundOutcome: 'round_outcome',
  eliminations: 'eliminations',
  deaths: 'deaths',
  assists: 'assists',
  damage: 'damage',
  healing: 'healing',
  mitigation: 'mitigation',
  score: 'score',
} as const;

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
    if (this.isMatchStart(msg)) {
      this.current = newMutable();
      this.current.record.startedAt = this.now();
      return null;
    }

    this.apply(msg);

    if (this.isMatchEnd(msg)) {
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
      if (key === K.map) rec.mapName = asString(msg.value) ?? rec.mapName;
      else if (key === K.pseudoMatchId || key === K.matchId)
        rec.matchId = asString(msg.value) ?? rec.matchId;
      else if (key === K.outcome) rec.outcome = asString(msg.value) ?? rec.outcome;
      else if (key === K.score) rec.finalScore = asString(msg.value) ?? rec.finalScore;
      else if (key === K.roundOutcome) this.tallyRound(asString(msg.value));
      else if (key === K.eliminations) this.current.matchElims = asNumber(msg.value);
      else if (key === K.deaths) this.current.matchDeaths = asNumber(msg.value);
      else if (key === K.assists) this.current.matchAssists = asNumber(msg.value);
      else if (key.startsWith(K.roster)) this.applyRoster(msg.value);
      return;
    }
  }

  private applyRoster(value: unknown): void {
    const player = parseRoster(value);
    if (!player) return;
    if (!isLocal(player.battleTag, this.current.record.battleTag)) return;

    const rec = this.current.record;
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

  private isMatchStart(msg: GepMessage): boolean {
    return msg.kind === 'event' && nameMatches(msg, 'match_start');
  }

  private isMatchEnd(msg: GepMessage): boolean {
    if (msg.kind === 'event' && nameMatches(msg, 'match_end')) return true;
    // Fallback: game_info.game_state transitioning to an "ended" value.
    return (
      msg.feature?.toLowerCase() === K.gameInfo &&
      msg.key?.toLowerCase() === K.gameState &&
      /ended|finished|complete/i.test(asString(msg.value) ?? '')
    );
  }

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

    if (!rec.matchId) {
      // No pseudo_match_id seen — synthesize so dedupe still has a key this session.
      rec.matchId = `synthetic-${rec.startedAt ?? rec.endedAt}-${++this.synthetic}`;
    }

    const finished = rec;
    this.current = newMutable();
    return finished;
  }
}

// --- internal mutable state ---------------------------------------------------

interface MutableMatch {
  record: MatchRecord;
  rosterLocal: Pick<
    RosterPlayer,
    'kills' | 'deaths' | 'assists' | 'damage' | 'healing' | 'mitigation'
  >;
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
  return { record: emptyMatch(''), rosterLocal: {}, roundWins: 0, roundLosses: 0, perHero: [], heroStart: zeroSnap(), lastCum: zeroSnap() };
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
  const a = nameOf(playerTag);
  const b = nameOf(localTag);
  return a === b && a.length > 0;
}

function nameOf(tag: string): string {
  const hash = tag.indexOf('#');
  return (hash >= 0 ? tag.slice(0, hash) : tag).trim().toLowerCase();
}

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

export function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[, ]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
