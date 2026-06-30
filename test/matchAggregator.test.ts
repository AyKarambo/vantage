import { describe, it, expect } from 'vitest';
import { MatchAggregator, parseRoster } from '../src/core/matchAggregator';
import type { GepMessage } from '../src/core/model';
import { resolveRole } from '../src/core/resolvers/role';
import { resolveResult } from '../src/core/resolvers/result';

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
