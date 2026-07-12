import { describe, it, expect } from 'vitest';
import { MatchAggregator, parseRoster } from '../src/core/matchAggregator';
import type { GepMessage } from '../src/core/model';
import { resolveRole } from '../src/core/resolvers/role';
import { resolveResult } from '../src/core/resolvers/result';
import { buildCompetitiveMatch } from '../src/main/simulate';
import { matchToGame } from '../src/core/gameRecord';

const info = (feature: string, key: string, value: unknown): GepMessage => ({
  kind: 'info',
  feature,
  key,
  value,
});
const event = (key: string, value: unknown = true): GepMessage => ({
  kind: 'event',
  feature: 'match_info',
  key,
  value,
});

describe('MatchAggregator', () => {
  it('assembles one competitive match with a hero swap', () => {
    let clock = 1_000_000;
    const agg = new MatchAggregator(() => (clock += 60_000)); // +1 min per call

    const sequence: GepMessage[] = [
      event('match_start'),
      info('game_info', 'battle_tag', 'Karambo#21234'),
      info('game_info', 'game_type', 'Competitive'),
      info('game_info', 'game_queue_type', 'role'),
      info('game_info', 'party_player_count', 2),
      info('match_info', 'map', "King's Row"),
      info('match_info', 'pseudo_match_id', 'abc-123'),
      info(
        'roster',
        'roster_0',
        JSON.stringify({
          name: 'Karambo#21234',
          hero: 'Tracer',
          role: 'damage',
          kills: 20,
          deaths: 5,
          assists: 7,
          damage: 9000,
        }),
      ),
      // an enemy/teammate row that must be ignored
      info('roster', 'roster_1', { name: 'SomeoneElse#1', hero: 'Mercy', kills: 2 }),
      // hero swap — only kills + hero update; other stats must be retained
      info('roster', 'roster_0', { name: 'Karambo#21234', hero: 'Genji', kills: 25 }),
      info('match_info', 'match_outcome', 'Victory'),
    ];

    let finished = null;
    for (const m of sequence) finished = agg.handle(m) ?? finished;
    expect(finished).toBeNull(); // not done until match_end

    const record = agg.handle(event('match_end'));
    expect(record).not.toBeNull();
    if (!record) return;

    expect(record.matchId).toBe('abc-123');
    expect(record.battleTag).toBe('Karambo#21234');
    expect(record.gameType).toBe('Competitive');
    expect(record.queueType).toBe('role');
    expect(record.groupSize).toBe(2);
    expect(record.mapName).toBe("King's Row");
    expect(record.outcome).toBe('Victory');
    expect(record.heroes).toEqual(['Tracer', 'Genji']);
    expect(record.heroRole).toBe('damage');
    expect(record.eliminations).toBe(25);
    expect(record.deaths).toBe(5);
    expect(record.assists).toBe(7);
    expect(record.damage).toBe(9000);
    expect(record.durationMinutes).toBeGreaterThan(0);

    // downstream resolvers
    expect(resolveRole(record.queueType, record.heroRole)).toBe('damage');
    expect(resolveResult(record.outcome)).toBe('Win');
  });

  it('synthesizes a match id when none is reported', () => {
    const agg = new MatchAggregator(() => 5000);
    agg.handle(event('match_start'));
    const record = agg.handle(event('match_end'));
    expect(record?.matchId).toMatch(/^synthetic-/);
  });

  it('falls back to game_state ended as match end', () => {
    const agg = new MatchAggregator(() => 5000);
    agg.handle(info('match_info', 'pseudo_match_id', 'xyz'));
    const record = agg.handle(info('game_info', 'game_state', 'ended'));
    expect(record?.matchId).toBe('xyz');
  });
});

describe('MatchAggregator per-hero stats', () => {
  it('splits cumulative roster stats per hero across a swap', () => {
    const agg = new MatchAggregator(() => 1000);
    const seq: GepMessage[] = [
      event('match_start'),
      info('game_info', 'battle_tag', 'Player#1'),
      info('match_info', 'pseudo_match_id', 'mh1'),
      info('roster', 'roster_0', { name: 'Player#1', hero: 'Tracer', role: 'damage', kills: 10, deaths: 2, assists: 3, damage: 4000 }),
      info('roster', 'roster_0', { name: 'Player#1', hero: 'Genji', role: 'damage', kills: 18, deaths: 4, assists: 5, damage: 9000 }),
      info('roster', 'roster_0', { name: 'Player#1', hero: 'Genji', kills: 25, deaths: 6, assists: 7, damage: 14000 }),
      info('match_info', 'match_outcome', 'Victory'),
    ];
    let rec = null;
    for (const m of seq) rec = agg.handle(m) ?? rec;
    rec = agg.handle(event('match_end'));
    expect(rec?.perHero).toBeDefined();
    const ph = Object.fromEntries((rec!.perHero ?? []).map((h) => [h.hero, h]));
    expect(ph.Tracer).toMatchObject({ eliminations: 10, deaths: 2, assists: 3, damage: 4000, role: 'damage' });
    expect(ph.Genji).toMatchObject({ eliminations: 15, deaths: 4, assists: 4, damage: 10000 });
  });
});

describe('MatchAggregator roster retention', () => {
  it('keeps the latest snapshot per roster slot and marks the local player', () => {
    const agg = new MatchAggregator(() => 1000);
    const messages = buildCompetitiveMatch({ battleTag: 'Karambo#21234', map: "King's Row" }, 'ret-1');
    const matchEnd = messages[messages.length - 1];
    for (const m of messages.slice(0, -1)) agg.handle(m);

    // Late snapshots: slot 1 swaps hero and updates stats; a new slot 2 appears.
    agg.handle(info('roster', 'roster_1', { name: 'Someone#1234', hero: 'Ana', role: 'support', kills: 5, healing: 8000, team: 0 }));
    agg.handle(info('roster', 'roster_2', JSON.stringify({ name: 'Enemy#9', hero: 'Reinhardt', role: 'tank', kills: 12, team_id: 1 })));

    const record = agg.handle(matchEnd);
    expect(record?.roster).toBeDefined();
    const roster = record!.roster!;
    expect(roster).toHaveLength(3); // one entry per slot, in slot order

    // Slot 0 — the tracked player, flagged and untouched by other slots.
    expect(roster[0]).toMatchObject({ battleTag: 'Karambo#21234', heroName: 'Tracer', kills: 23, isLocal: true });
    // Slot 1 — the LATEST snapshot wins (Mercy → Ana), team alias parsed.
    expect(roster[1]).toMatchObject({ battleTag: 'Someone#1234', heroName: 'Ana', kills: 5, healing: 8000, team: 0 });
    expect(roster[1].isLocal).toBeFalsy();
    // Slot 2 — JSON string payload with a `team_id` alias.
    expect(roster[2]).toMatchObject({ battleTag: 'Enemy#9', heroName: 'Reinhardt', team: 1 });

    // The local player's own aggregation is unchanged by retention.
    expect(record!.eliminations).toBe(23);
    expect(record!.deaths).toBe(7);
    expect(record!.assists).toBe(9);
    expect(record!.damage).toBe(11000);
    expect(record!.heroes).toEqual(['Tracer']);
    expect(record!.finalScore).toBe('2–1');
  });

  it('emits no roster when no roster entries arrived', () => {
    const agg = new MatchAggregator(() => 1000);
    agg.handle(event('match_start'));
    agg.handle(info('match_info', 'pseudo_match_id', 'no-roster'));
    agg.handle(info('match_info', 'match_outcome', 'Victory'));
    const record = agg.handle(event('match_end'));
    expect(record?.roster).toBeUndefined();
  });
});

describe('MatchAggregator local player from roster is_local', () => {
  it('identifies the local player via the GEP is_local flag when game_info.battle_tag is absent', () => {
    const agg = new MatchAggregator(() => 1000);
    const seq: GepMessage[] = [
      event('match_start'),
      // NO game_info.battle_tag — exactly the situation that produced "Unknown".
      info('match_info', 'pseudo_match_id', 'loc-1'),
      info('match_info', 'map', 1207), // numeric map id
      // enemy team: numeric hero id, is_local 0 — must be ignored for local stats
      info('roster', 'roster_6', { player_name: 'ENEMY', battle_tag: 'Enemy#9', is_local: 0, is_myteam: 0, hero_name: 418, kills: 20, team: 0 }),
      // the local player: real GEP field names, is_local:1, string hero (own team)
      info('roster', 'roster_2', { player_name: 'KARAMBO', battle_tag: 'Karambo#21234', is_local: 1, is_myteam: 1, hero_name: 'Tracer', hero_role: 'DAMAGE', kills: 15, deaths: 4, assists: 6, damage: 9000, team: 1 }),
      info('match_info', 'match_outcome', 'Victory'),
    ];
    let rec = null;
    for (const m of seq) rec = agg.handle(m) ?? rec;
    rec = agg.handle(event('match_end'));
    expect(rec).not.toBeNull();

    // battleTag seeded from the local roster entry → no longer "Unknown".
    expect(rec!.battleTag).toBe('Karambo#21234');
    expect(rec!.mapName).toBe('Nepal'); // numeric map id resolved
    expect(rec!.heroes).toEqual(['Tracer']); // local per-hero accumulated
    expect(rec!.eliminations).toBe(15);

    // The local roster entry is flagged; the enemy is not.
    expect(rec!.roster!.find((p) => p.isLocal)?.battleTag).toBe('Karambo#21234');
    expect(rec!.roster!.find((p) => p.battleTag === 'Enemy#9')?.isLocal).toBeFalsy();

    // End-to-end: account resolves to the configured label (never "Unknown").
    const game = matchToGame(rec!, { 'Karambo#21234': 'Main' });
    expect(game?.account).toBe('Main');
    expect(game?.map).toBe('Nepal');
  });
});

describe('MatchAggregator roster teardown (slots cleared to {} before match_end)', () => {
  it('retains the last rich snapshot per slot when GEP blanks the roster at match end', () => {
    // Mirrors a real capture: full roster rows stream in, then every slot is
    // reset to `{}` as the scoreboard tears down — and only AFTER that does
    // match_end fire. The empty snapshots must not blank the scoreboard.
    const agg = new MatchAggregator(() => 1000);
    const seq: GepMessage[] = [
      event('match_start'),
      info('match_info', 'pseudo_match_id', 'td-1'),
      info('match_info', 'map', 1207),
      info('roster', 'roster_9', { player_name: 'KARAMBO', battlenet_tag: 'Karambo#21442', is_local: true, hero_name: 'Shion', hero_role: 'DAMAGE', kills: 16, deaths: 4, assists: 2, damage: 8433, team: 1 }),
      info('roster', 'roster_1', { player_name: 'ADMONI', battlenet_tag: 'Admoni#1955', is_local: false, hero_name: 'Cassidy', hero_role: 'DAMAGE', kills: 16, deaths: 3, damage: 11334, team: 1 }),
      info('roster', 'roster_4', { player_name: 'ENEMY', battlenet_tag: 'Kittens#2693', is_local: false, hero_name: 'Roadhog', hero_role: 'TANK', kills: 11, deaths: 6, damage: 7895, team: 0 }),
      info('match_info', 'match_outcome', 'victory'),
      // Match teardown: every slot blanked BEFORE match_end (the bug trigger).
      info('roster', 'roster_1', {}),
      info('roster', 'roster_4', {}),
      info('roster', 'roster_9', {}),
    ];
    let rec = null;
    for (const m of seq) rec = agg.handle(m) ?? rec;
    rec = agg.handle(event('match_end'));
    expect(rec).not.toBeNull();

    // The full scoreboard survived the blanking — one rich row per slot.
    expect(rec!.roster).toHaveLength(3);
    const bySlot = Object.fromEntries((rec!.roster ?? []).map((p) => [p.battleTag, p]));
    expect(bySlot['Karambo#21442']).toMatchObject({ heroName: 'Shion', kills: 16, isLocal: true });
    expect(bySlot['Admoni#1955']).toMatchObject({ heroName: 'Cassidy', kills: 16, team: 1 });
    expect(bySlot['Kittens#2693']).toMatchObject({ heroName: 'Roadhog', team: 0 });
    expect(bySlot['Kittens#2693'].isLocal).toBeFalsy();

    // The local player's own line is intact too (the blank {} for the local
    // slot must not zero out the aggregated stats).
    expect(rec!.battleTag).toBe('Karambo#21442');
    expect(rec!.mapName).toBe('Nepal');
    expect(rec!.heroes).toEqual(['Shion']);
    expect(rec!.eliminations).toBe(16);
    expect(rec!.deaths).toBe(4);
  });
});

describe('parseRoster', () => {
  it('parses the real GEP field names (battle_tag / battlenet_tag / player_name / is_local)', () => {
    const p = parseRoster({ player_name: 'KARAMBO', battle_tag: 'Karambo#21234', is_local: 1, hero_name: 'Tracer', hero_role: 'DAMAGE' });
    expect(p?.battleTag).toBe('Karambo#21234');
    expect(p?.isLocal).toBe(true);
    const q = parseRoster({ battlenet_tag: 'Chongy#21205', is_local: false, hero_name: 'CASSIDY' });
    expect(q?.battleTag).toBe('Chongy#21205');
    expect(q?.isLocal).toBe(false);
  });

  it('parses JSON strings and object values with field aliases', () => {
    const a = parseRoster('{"battletag":"A#1","hero_name":"Ana","hero_role":"support","healing_done":12000}');
    expect(a?.battleTag).toBe('A#1');
    expect(a?.heroName).toBe('Ana');
    expect(a?.heroRole).toBe('support');
    expect(a?.healing).toBe(12000);

    const b = parseRoster({ name: 'B#2', hero: 'Rein', role: 'tank', mitigation: 8000 });
    expect(b?.heroName).toBe('Rein');
    expect(b?.mitigation).toBe(8000);
  });

  it('returns undefined for non-roster values', () => {
    expect(parseRoster('not json')).toBeUndefined();
    expect(parseRoster(42)).toBeUndefined();
  });
});
