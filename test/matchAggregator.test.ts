import { describe, it, expect } from 'vitest';
import { MatchAggregator, isRoundEndMessage, isRoundStartMessage, parseRoster } from '../src/core/matchAggregator';
import type { GepMessage } from '../src/core/model';
import { resolveRole } from '../src/core/resolvers/role';
import { resolveResult } from '../src/core/resolvers/result';
import { buildCompetitiveMatch, buildCompetitiveTimeline, SIM_TIMING } from '../src/main/simulate';
import { matchToGame } from '../src/core/gameRecord';
import { ROUND_SETUP_SECONDS } from '../src/core/playedTime';

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

  it('drops a spawn-only hero swap (short, all-zero segment) from heroes and perHero', () => {
    let t = 0;
    const agg = new MatchAggregator(() => t);
    const at = (ms: number, m: GepMessage) => {
      t = ms;
      return agg.handle(m);
    };
    at(0, event('match_start'));
    agg.handle(info('game_info', 'battle_tag', 'P#1'));
    agg.handle(info('match_info', 'pseudo_match_id', 'm-spawn'));
    // Ana picked in spawn, untouched, swapped off 15s later with zero stats.
    at(0, info('roster', 'roster_0', { name: 'P#1', hero: 'Ana', role: 'support', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    at(15_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', role: 'damage', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    // Tracer actually plays: real stats accrue over the next 5 minutes.
    at(315_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', kills: 12, deaths: 3, assists: 4, damage: 8000 }));
    agg.handle(info('match_info', 'match_outcome', 'Victory'));
    const rec = at(315_000, event('match_end'));

    expect(rec?.heroes).toEqual(['Tracer']); // Ana never counted as played
    expect(rec?.perHero).toHaveLength(1);
    const ph = Object.fromEntries((rec!.perHero ?? []).map((h) => [h.hero, h]));
    expect(ph.Ana).toBeUndefined();
    // Tracer's clock is anchored to the swap at 15s, NOT match start (0) — the
    // excluded Ana segment must not inflate Tracer's minutes.
    expect(ph.Tracer).toMatchObject({ eliminations: 12, deaths: 3, assists: 4, damage: 8000 });
    expect(ph.Tracer.minutes).toBeCloseTo(5, 5); // (315_000 - 15_000) / 60_000
  });

  it('keeps a short hero swap when it shows any evidence of real activity', () => {
    let t = 0;
    const agg = new MatchAggregator(() => t);
    const at = (ms: number, m: GepMessage) => {
      t = ms;
      return agg.handle(m);
    };
    at(0, event('match_start'));
    agg.handle(info('game_info', 'battle_tag', 'P#1'));
    agg.handle(info('match_info', 'pseudo_match_id', 'm-brief-active'));
    at(0, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', role: 'damage', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    // Died 10s in, still on Tracer — a real (if brief) engagement.
    at(10_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', deaths: 1 }));
    // Swapped off 15s in, having done nothing more — the trailing stub (Genji) stays excluded.
    at(15_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Genji', role: 'damage' }));
    agg.handle(info('match_info', 'match_outcome', 'Defeat'));
    const rec = at(15_000, event('match_end'));

    expect(rec?.heroes).toEqual(['Tracer']);
    expect(rec?.perHero).toHaveLength(1);
    expect(rec!.perHero![0]).toMatchObject({ hero: 'Tracer', deaths: 1 });
    expect(rec!.perHero![0].minutes).toBeCloseTo(0.25, 5); // 15s tracked, kept despite being under 60s
  });

  it('keeps the match record with an empty heroes list when every segment is spawn-only', () => {
    let t = 0;
    const agg = new MatchAggregator(() => t);
    const at = (ms: number, m: GepMessage) => {
      t = ms;
      return agg.handle(m);
    };
    at(0, event('match_start'));
    agg.handle(info('game_info', 'battle_tag', 'P#1'));
    agg.handle(info('match_info', 'pseudo_match_id', 'm-all-spawn'));
    at(0, info('roster', 'roster_0', { name: 'P#1', hero: 'Ana', role: 'support', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    at(5_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Mercy', role: 'support', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    agg.handle(info('match_info', 'match_outcome', 'Defeat'));
    const rec = at(8_000, event('match_end'));

    expect(rec).not.toBeNull();
    expect(rec?.heroes).toEqual([]);
    expect(rec?.perHero).toBeUndefined();
    expect(rec?.heroRole).toBeUndefined(); // nothing was really played, so no role is known
    expect(rec?.outcome).toBe('Defeat'); // the match itself is still recorded
  });

  it('does not let a trailing spawn-only swap flip the recorded heroRole', () => {
    let t = 0;
    const agg = new MatchAggregator(() => t);
    const at = (ms: number, m: GepMessage) => {
      t = ms;
      return agg.handle(m);
    };
    at(0, event('match_start'));
    agg.handle(info('game_info', 'battle_tag', 'P#1'));
    agg.handle(info('match_info', 'pseudo_match_id', 'm-trailing-swap'));
    // Genji, played for real: substantial stats over 5 minutes.
    at(0, info('roster', 'roster_0', { name: 'P#1', hero: 'Genji', role: 'damage', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    at(300_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Genji', kills: 10, deaths: 2, assists: 3, damage: 9000 }));
    // Browsing hero-select on the post-round screen: swap to Mercy, zero stats, match ends 0.5s later.
    at(300_500, info('roster', 'roster_0', { name: 'P#1', hero: 'Mercy', role: 'support', kills: 10, deaths: 2, assists: 3, damage: 9000 }));
    agg.handle(info('match_info', 'match_outcome', 'Victory'));
    const rec = at(300_500, event('match_end'));

    expect(rec?.heroes).toEqual(['Genji']); // Mercy excluded — spawn-only, zero stats
    expect(rec?.perHero).toHaveLength(1);
    // heroRole must track the last hero that actually counted as played (Genji,
    // damage), not the raw last-seen roster role (Mercy, support) — otherwise a
    // harmless post-round browse would misclassify the whole match's role.
    expect(rec?.heroRole).toBe('damage');
  });
});

describe('MatchAggregator round timing (played time)', () => {
  const MIN = 60_000;
  /** Real captures deliver the round events as `match_info` events with a null value. */
  const round = (key: 'round_start' | 'round_end'): GepMessage => ({ kind: 'event', feature: 'match_info', key, value: null });

  /** An aggregator driven by an explicit clock: `at(ms, msg)` sets the time, then feeds. */
  function clocked(options?: ConstructorParameters<typeof MatchAggregator>[1]) {
    let t = 0;
    const agg = new MatchAggregator(() => t, options);
    const at = (ms: number, m: GepMessage) => {
      t = ms;
      return agg.handle(m);
    };
    return { agg, at };
  }

  function start(at: (ms: number, m: GepMessage) => unknown, map: string, id: string): void {
    at(0, event('match_start'));
    at(100, info('game_info', 'battle_tag', 'P#1'));
    at(200, info('match_info', 'map', map));
    at(300, info('match_info', 'pseudo_match_id', id));
  }

  it('measures playedMinutes from round_start/round_end, excluding the pre-round hero select and the post-match tail', () => {
    // Real capture shape: match_start → round_start ~28 s (hero select);
    // round_end → next round_start ~1 s; outcome 3 ms before the final
    // round_end; match_end ~40 s after it (POTG + scoreboard).
    const { at } = clocked();
    start(at, 'Ilios', 'rt-1'); // Control: doors open at round start, ~15 s overlay before a later round
    at(10_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', role: 'damage', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    at(28_000, round('round_start'));
    at(28_000 + 5 * MIN, round('round_end'));
    at(29_000 + 5 * MIN, round('round_start'));
    at(29_000 + 9 * MIN, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', kills: 20, deaths: 5, assists: 7, damage: 9000 }));
    at(29_000 + 10 * MIN, info('match_info', 'match_outcome', 'victory'));
    at(29_003 + 10 * MIN, round('round_end'));
    const rec = at(69_003 + 10 * MIN, event('match_end'))!;

    expect(rec.rounds).toEqual([
      { startedAt: 28_000, endedAt: 28_000 + 5 * MIN },
      { startedAt: 29_000 + 5 * MIN, endedAt: 29_003 + 10 * MIN },
    ]);
    // Round 1 fully fightable (5 min); round 2 minus the 15 s round-change overlay.
    const played = (5 * MIN + (5 * MIN + 3 - 15_000)) / MIN;
    expect(rec.playedMinutes).toBeCloseTo(played, 9);
    // The wall clock stays the displayed duration: ~11.15 min → 11.
    expect(rec.durationMinutes).toBe(11);
    // The single hero's minutes are the played minutes (its segment ran from
    // match start to match end, clipped to the play windows).
    expect(rec.perHero).toHaveLength(1);
    expect(rec.perHero![0].minutes).toBeCloseTo(played, 9);
    expect(rec.perHero![0]).toMatchObject({ hero: 'Tracer', eliminations: 20, deaths: 5 });
    // Round-trips onto the analyzable game.
    const game = matchToGame(rec, {})!;
    expect(game.playedMinutes).toBeCloseTo(played, 9);
    expect(game.rounds).toHaveLength(2);
  });

  it("removes the Escort first-round setup lock (attackers behind doors) from the round's play window", () => {
    const { at } = clocked();
    start(at, 'Junkertown', 'rt-escort');
    at(28_000, round('round_start'));
    at(28_000 + 5 * MIN, info('match_info', 'match_outcome', 'defeat'));
    at(28_003 + 5 * MIN, round('round_end'));
    const rec = at(68_003 + 5 * MIN, event('match_end'))!;
    expect(rec.rounds).toHaveLength(1);
    expect(rec.playedMinutes).toBeCloseTo((5 * MIN + 3 - ROUND_SETUP_SECONDS.Escort.first * 1000) / MIN, 9);
    expect(ROUND_SETUP_SECONDS.Escort.first).toBe(45);
  });

  it('closes a round whose round_end never arrived at match_outcome, not at match_end', () => {
    const { at } = clocked();
    start(at, 'Ilios', 'rt-missed-end');
    at(28_000, round('round_start'));
    at(500_000, info('match_info', 'match_outcome', 'victory'));
    const rec = at(540_000, event('match_end'))!; // 40 s of scoreboard must not count
    expect(rec.rounds).toEqual([{ startedAt: 28_000, endedAt: 500_000 }]);
    expect(rec.playedMinutes).toBeCloseTo((500_000 - 28_000) / MIN, 9);
  });

  it('closes a round whose round_end never arrived at match_end when there was no outcome either', () => {
    const { at } = clocked();
    start(at, 'Ilios', 'rt-no-outcome');
    at(28_000, round('round_start'));
    const rec = at(300_000, event('match_end'))!;
    expect(rec.rounds).toEqual([{ startedAt: 28_000, endedAt: 300_000 }]);
    expect(rec.playedMinutes).toBeCloseTo((300_000 - 28_000) / MIN, 9);
  });

  it('a round_start while a round is still open closes the open one; a stray round_end is ignored', () => {
    const { at } = clocked();
    start(at, 'Ilios', 'rt-stray');
    at(5_000, round('round_end')); // nothing open yet → ignored
    at(28_000, round('round_start'));
    at(228_000, round('round_start')); // round 1's end was missed → closed here
    at(428_000, round('round_end'));
    const rec = at(468_000, event('match_end'))!;
    expect(rec.rounds).toEqual([{ startedAt: 28_000, endedAt: 228_000 }, { startedAt: 228_000, endedAt: 428_000 }]);
  });

  it('with no round events leaves playedMinutes/rounds absent and keeps the legacy wall-clock hero minutes exactly', () => {
    const { at } = clocked();
    start(at, 'Ilios', 'rt-none');
    at(60_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', role: 'damage', kills: 10, deaths: 2, assists: 3, damage: 4000 }));
    at(180_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Genji', role: 'damage', kills: 18, deaths: 4, assists: 5, damage: 9000 }));
    at(590_000, info('match_info', 'match_outcome', 'victory'));
    const rec = at(600_000, event('match_end'))!;
    expect(rec.rounds).toBeUndefined();
    expect(rec.playedMinutes).toBeUndefined();
    const ph = Object.fromEntries((rec.perHero ?? []).map((h) => [h.hero, h]));
    expect(ph.Tracer.minutes).toBeCloseTo(3, 9); // match start → swap at 3 min (wall clock)
    expect(ph.Genji.minutes).toBeCloseTo(7, 9); // swap → match end at 10 min (wall clock)
    expect(rec.durationMinutes).toBe(10);
  });

  it('clips hero segments to the play windows: a hero-select swap earns 0 minutes and is dropped, a mid-round swap splits at the swap', () => {
    const { at } = clocked();
    start(at, 'Junkertown', 'rt-clip'); // Escort: 45 s setup lock at the start of round 1
    // Ana picked during hero select, swapped off 22 s into the round — still
    // behind the spawn doors, so nothing was playable on her.
    at(5_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Ana', role: 'support', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    at(28_000, round('round_start'));
    at(50_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', role: 'damage', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    // Real stats accrue on Tracer, then a mid-round swap to Genji.
    at(199_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', kills: 10, deaths: 2, assists: 3, damage: 4000 }));
    at(200_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Genji', role: 'damage', kills: 10, deaths: 2, assists: 3, damage: 4000 }));
    at(328_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Genji', kills: 18, deaths: 4, assists: 5, damage: 9000 }));
    at(328_000, info('match_info', 'match_outcome', 'victory'));
    at(328_003, round('round_end'));
    const rec = at(368_003, event('match_end'))!;

    const windowStart = 28_000 + 45_000; // doors open
    expect(rec.heroes).toEqual(['Tracer', 'Genji']); // Ana: 0 played minutes, zero stats → spawn-only, dropped
    const ph = Object.fromEntries((rec.perHero ?? []).map((h) => [h.hero, h]));
    expect(ph.Tracer.minutes).toBeCloseTo((200_000 - windowStart) / MIN, 9); // clipped to the door-open instant
    expect(ph.Genji.minutes).toBeCloseTo((328_003 - 200_000) / MIN, 9); // the 40 s scoreboard tail excluded
    expect(ph.Tracer).toMatchObject({ eliminations: 10, deaths: 2 });
    expect(ph.Genji).toMatchObject({ eliminations: 8, deaths: 2 });
    // The hero minutes sum to the match's played minutes.
    expect(ph.Tracer.minutes! + ph.Genji.minutes!).toBeCloseTo(rec.playedMinutes!, 9);
    expect(rec.playedMinutes).toBeCloseTo((328_003 - windowStart) / MIN, 9);
    expect(rec.durationMinutes).toBe(6); // 6.13 min wall clock
  });

  it('a swap while a round is still open clips against the open round too (setup offset applied)', () => {
    const { at } = clocked();
    start(at, 'Junkertown', 'rt-open');
    at(28_000, round('round_start'));
    at(30_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', role: 'damage', kills: 0, deaths: 0, assists: 0, damage: 0 }));
    // Swap 2 min in — the round has no round_end yet when Tracer's segment closes.
    at(148_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Genji', role: 'damage', kills: 6, deaths: 1, assists: 1, damage: 3000 }));
    at(328_000, info('match_info', 'match_outcome', 'defeat'));
    at(328_003, round('round_end'));
    const rec = at(368_003, event('match_end'))!;
    const ph = Object.fromEntries((rec.perHero ?? []).map((h) => [h.hero, h]));
    expect(ph.Tracer.minutes).toBeCloseTo((148_000 - 73_000) / MIN, 9); // first hero from match start, doors at 73 s
  });

  it('times a segment that closed BEFORE the first round against the rounds, not the wall clock', () => {
    // Vantage attached mid-match, so the first round_start was never delivered
    // and Ana's segment closed before any round existed. Timing it there would
    // leave one record with hero minutes on two different bases — wall clock for
    // Ana, play windows for Tracer — summing past the match's own played time.
    const { at } = clocked();
    at(1_000, info('game_info', 'battle_tag', 'P#1'));
    at(1_100, info('match_info', 'map', 'Junkertown')); // Escort: 45 s first-round lock
    at(1_200, info('roster', 'roster_0', { name: 'P#1', hero: 'Ana', role: 'support', kills: 2, deaths: 1, assists: 4, damage: 900 }));
    at(180_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', role: 'damage', kills: 5, deaths: 2, assists: 4, damage: 3000 }));
    at(240_000, round('round_start'));
    at(660_000, info('roster', 'roster_0', { name: 'P#1', hero: 'Tracer', kills: 14, deaths: 5, assists: 6, damage: 9000 }));
    at(660_000, info('match_info', 'match_outcome', 'victory'));
    at(660_003, round('round_end'));
    const rec = at(700_003, event('match_end'))!;

    const ph = Object.fromEntries((rec.perHero ?? []).map((h) => [h.hero, h]));
    // Ana played entirely before the round we saw — no played minutes at all
    // (a zero-length segment records none), though her stats keep her row alive.
    expect(ph.Ana.minutes).toBeUndefined();
    expect(ph.Tracer.minutes).toBeCloseTo((660_003 - (240_000 + 45_000)) / MIN, 9);
    // The invariant that matters: hero minutes never exceed the match's own.
    const total = (rec.perHero ?? []).reduce((m, h) => m + (h.minutes ?? 0), 0);
    expect(total).toBeCloseTo(rec.playedMinutes!, 9);
  });

  it('accepts a custom map-mode resolver so user-catalog maps get the right setup lock', () => {
    const run = (mapModeOf?: (map: string) => 'Escort' | 'Push') => {
      const { at } = clocked(mapModeOf ? { mapModeOf } : undefined);
      start(at, 'Somewhere New', 'rt-resolver');
      at(28_000, round('round_start'));
      at(328_000, info('match_info', 'match_outcome', 'victory'));
      at(328_003, round('round_end'));
      return at(368_003, event('match_end'))!;
    };
    expect(run().playedMinutes).toBeCloseTo(300_003 / MIN, 9); // unknown map → no lock
    expect(run(() => 'Escort').playedMinutes).toBeCloseTo((300_003 - 45_000) / MIN, 9);
    expect(run(() => 'Push').playedMinutes).toBeCloseTo(300_003 / MIN, 9);
  });

  it('leaves playedMinutes absent when every round is shorter than its setup lock', () => {
    const { at } = clocked();
    start(at, 'Junkertown', 'rt-forfeit');
    at(28_000, round('round_start'));
    const rec = at(40_000, event('match_end'))!; // 12 s "round" — a forfeit in setup
    expect(rec.rounds).toEqual([{ startedAt: 28_000, endedAt: 40_000 }]);
    expect(rec.playedMinutes).toBeUndefined();
  });

  it('recognizes the round events with the same tolerance as match_start (event kind, key or feature)', () => {
    expect(isRoundStartMessage(round('round_start'))).toBe(true);
    expect(isRoundEndMessage(round('round_end'))).toBe(true);
    expect(isRoundStartMessage({ kind: 'event', feature: 'round_start', key: 'x', value: null })).toBe(true);
    expect(isRoundStartMessage({ kind: 'info', feature: 'match_info', key: 'round_start', value: null })).toBe(false);
    expect(isRoundStartMessage(round('round_end'))).toBe(false);
    expect(isRoundEndMessage(event('match_end'))).toBe(false);
  });

  it('the dev simulation timeline, replayed at its own pace, measures a positive played time on King\'s Row', () => {
    let t = 0;
    const agg = new MatchAggregator(() => t);
    let rec = null;
    for (const step of buildCompetitiveTimeline({ battleTag: 'Karambo#21234', map: "King's Row" }, 'sim-rt')) {
      t = step.at;
      rec = agg.handle(step.msg) ?? rec;
    }
    expect(rec).not.toBeNull();
    const roundMs = SIM_TIMING.roundEndMs - SIM_TIMING.roundStartMs;
    expect(rec!.rounds).toEqual([{ startedAt: SIM_TIMING.roundStartMs, endedAt: SIM_TIMING.roundEndMs }]);
    expect(rec!.playedMinutes).toBeCloseTo((roundMs - ROUND_SETUP_SECONDS.Hybrid.first * 1000) / MIN, 9);
    expect(rec!.perHero![0].minutes).toBeCloseTo(rec!.playedMinutes!, 9);
    expect(rec!.durationMinutes).toBe(Math.round((SIM_TIMING.roundEndMs + SIM_TIMING.matchEndAfterRoundEndMs) / MIN));
    expect(rec!.outcome).toBe('Victory');
    // The bare message list keeps match_end last (the roster-retention test slices it off).
    const messages = buildCompetitiveMatch({ battleTag: 'Karambo#21234', map: "King's Row" }, 'sim-rt');
    expect(messages[messages.length - 1].key).toBe('match_end');
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

  it('retains the last rich snapshot per slot when GEP masks the roster with "UNKNOWN" instead of {}', () => {
    // A real live capture: 10 roster rows stream in normally, then every slot
    // (including the local player's own) gets reset to hero_name "UNKNOWN" /
    // no battle_tag / no stats before match_end fires — a richer teardown shape
    // than the bare `{}` covered above, which slipped past hasRosterContent and
    // blanked the whole scoreboard to 10 "Unknown" rows with no isLocal player.
    const agg = new MatchAggregator(() => 1000);
    const seq: GepMessage[] = [
      event('match_start'),
      info('match_info', 'pseudo_match_id', 'mask-1'),
      info('match_info', 'map', 1207),
      info('roster', 'roster_9', { player_name: 'KARAMBO', battlenet_tag: 'Karambo#21442', is_local: true, hero_name: 'Shion', hero_role: 'DAMAGE', kills: 16, deaths: 4, assists: 2, damage: 8433, team: 1 }),
      info('roster', 'roster_1', { player_name: 'ADMONI', battlenet_tag: 'Admoni#1955', is_local: false, hero_name: 'Cassidy', hero_role: 'DAMAGE', kills: 16, deaths: 3, damage: 11334, team: 1 }),
      info('roster', 'roster_4', { player_name: 'ENEMY', battlenet_tag: 'Kittens#2693', is_local: false, hero_name: 'Roadhog', hero_role: 'TANK', kills: 11, deaths: 6, damage: 7895, team: 0 }),
      info('match_info', 'match_outcome', 'victory'),
      // Match teardown: every slot masked BEFORE match_end (the bug trigger).
      info('roster', 'roster_1', { hero_name: 'UNKNOWN', team: 1 }),
      info('roster', 'roster_4', { hero_name: 'UNKNOWN', team: 1 }),
      info('roster', 'roster_9', { hero_name: 'UNKNOWN', team: 1, is_local: false }),
    ];
    let rec = null;
    for (const m of seq) rec = agg.handle(m) ?? rec;
    rec = agg.handle(event('match_end'));
    expect(rec).not.toBeNull();

    // The full scoreboard survived the masking — one rich row per slot.
    expect(rec!.roster).toHaveLength(3);
    const bySlot = Object.fromEntries((rec!.roster ?? []).map((p) => [p.battleTag, p]));
    expect(bySlot['Karambo#21442']).toMatchObject({ heroName: 'Shion', kills: 16, isLocal: true });
    expect(bySlot['Admoni#1955']).toMatchObject({ heroName: 'Cassidy', kills: 16, team: 1 });
    expect(bySlot['Kittens#2693']).toMatchObject({ heroName: 'Roadhog', team: 0 });
    expect(bySlot['Kittens#2693'].isLocal).toBeFalsy();

    // The local player's own aggregated line is intact too.
    expect(rec!.battleTag).toBe('Karambo#21442');
    expect(rec!.heroes).toEqual(['Shion']);
    expect(rec!.eliminations).toBe(16);
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

  it("reads GEP's past-tense healed/mitigated roster keys", () => {
    // The exact shape from a live capture — a support's healing/mitigation would
    // otherwise be dropped from the scoreboard.
    const p = parseRoster({ player_name: 'HAYAA', battlenet_tag: 'hayaa#21775', hero_name: 'BRIGITTE', damage: 1562.64, healed: 5705.57, mitigated: 793.834 });
    expect(p?.healing).toBe(5705.57);
    expect(p?.mitigation).toBe(793.834);
    expect(p?.damage).toBe(1562.64);
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
