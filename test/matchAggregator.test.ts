import { describe, it, expect } from 'vitest';
import { MatchAggregator, parseRoster } from '../src/core/matchAggregator';
import type { GepMessage } from '../src/core/model';
import { resolveRole } from '../src/core/resolvers/role';
import { resolveResult } from '../src/core/resolvers/result';
import { buildCompetitiveMatch } from '../src/main/simulate';

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

  it('records on-hero minutes and merges same-hero swap segments into one line', () => {
    let t = 0;
    const agg = new MatchAggregator(() => t);
    const at = (ms: number, m: GepMessage) => {
      t = ms;
      return agg.handle(m);
    };
    at(0, event('match_start'));
    agg.handle(info('game_info', 'battle_tag', 'P#1'));
    agg.handle(info('match_info', 'pseudo_match_id', 'm-merge'));
    // Tracer 60s in, swap to Genji at 3 min, back to Tracer at 5 min, end at 10 min.
    at(60_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', role: 'damage', kills: 10, deaths: 2, assists: 3, damage: 4000 }));
    at(180_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Genji', role: 'damage', kills: 18, deaths: 4, assists: 5, damage: 9000 }));
    at(300_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', kills: 25, deaths: 5, assists: 7, damage: 12000 }));
    agg.handle(info('match_info', 'match_outcome', 'Victory'));
    const rec = at(600_000, event('match_end'));

    expect(rec?.perHero).toHaveLength(2); // Tracer collapsed from two segments
    const ph = Object.fromEntries((rec!.perHero ?? []).map((h) => [h.hero, h]));
    // First hero clock starts at match start (0): Tracer 0→3min + 5→10min = 8 min.
    expect(ph.Tracer).toMatchObject({ eliminations: 17, deaths: 3, assists: 5, damage: 7000, minutes: 8 });
    expect(ph.Genji).toMatchObject({ eliminations: 8, deaths: 2, assists: 2, damage: 5000, minutes: 2 });
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

describe('parseRoster', () => {
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
