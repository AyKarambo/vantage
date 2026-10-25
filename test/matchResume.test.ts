import { describe, it, expect } from 'vitest';
import { MatchAggregator, RESUME_MAX_AGE_MS } from '../src/core/matchAggregator';
import { CHECKPOINT_INTERVAL_MS, createMatchPipeline, type MatchPipelineDeps } from '../src/main/matchPipeline';
import type { GepMessage } from '../src/core/model';

/**
 * Restart-resume: the match in progress is checkpointed, and a restart that
 * attaches to the SAME match (by the game's own match_id) carries on from it
 * instead of recording only the part seen after the restart.
 */

const MIN = 60_000;
const info = (feature: string, key: string, value: unknown): GepMessage => ({ kind: 'info', feature, key, value });
const event = (key: string): GepMessage => ({ kind: 'event', feature: 'match_info', key, value: null });
const roster = (p: Record<string, unknown>): GepMessage => info('roster', 'roster_0', p);

function clocked() {
  let t = 0;
  const agg = new MatchAggregator(() => t);
  const at = (ms: number, m: GepMessage) => {
    t = ms;
    return agg.handle(m);
  };
  return { agg, at };
}

/** A King's Row-shaped match up to just before a restart: start, hero select, two rounds, a third running. */
function playUntilRestart(at: (ms: number, m: GepMessage) => unknown): void {
  at(0, event('match_start'));
  at(1, info('match_info', 'pseudo_match_id', 'pseudo-1'));
  at(2, info('match_info', 'match_id', '3858793788'));
  at(3, info('match_info', 'map', '212'));
  at(4, info('game_info', 'game_type', 'RANKED'));
  at(5, info('game_info', 'battle_tag', 'Karambo#21442'));
  at(10_000, roster({ battlenet_tag: 'Karambo#21442', is_local: true, hero_name: 'CASSIDY', hero_role: 'DAMAGE', kills: 0, deaths: 0, damage: 0 }));
  at(28_000, event('round_start'));
  at(28_000 + 8 * MIN, event('round_end'));
  at(29_000 + 8 * MIN, event('round_start'));
  at(29_000 + 15 * MIN, event('round_end'));
  at(30_000 + 15 * MIN, event('round_start'));
  at(30_000 + 17 * MIN, roster({ battlenet_tag: 'Karambo#21442', is_local: true, hero_name: 'CASSIDY', kills: 22, deaths: 9, damage: 9000 }));
}

/** What GEP sends on attach after the restart: the match facts, the state, then the id. */
function attachAfterRestart(at: (ms: number, m: GepMessage) => unknown, t: number, id = '3858793788'): void {
  at(t, info('game_info', 'game_type', 'RANKED'));
  at(t + 1, info('match_info', 'map', '212'));
  at(t + 2, info('game_info', 'battle_tag', 'Karambo#21442'));
  at(t + 3, info('game_info', 'game_state', 'match_in_progress'));
  at(t + 4, info('match_info', 'match_id', id));
}

describe('MatchAggregator — checkpoint', () => {
  it('has nothing to checkpoint before a match is running and named', () => {
    const { agg, at } = clocked();
    expect(agg.checkpoint()).toBeNull();
    at(0, event('match_start'));
    expect(agg.checkpoint()).toBeNull(); // not named yet — nothing a restart could match it by
    at(1, info('match_info', 'match_id', '42'));
    expect(agg.checkpoint()).toMatchObject({ version: 1, savedAt: 1 });
  });

  it('survives a JSON round trip (it is written to disk)', () => {
    const { agg, at } = clocked();
    playUntilRestart(at);
    const cp = agg.checkpoint();
    expect(JSON.parse(JSON.stringify(cp))).toEqual(cp);
  });
});

describe('MatchAggregator — resume after a restart', () => {
  it('carries the SAME match on: start, rounds and stats from before the restart are kept', () => {
    const before = clocked();
    playUntilRestart(before.at);
    const cp = JSON.parse(JSON.stringify(before.agg.checkpoint()));

    // A new app process: a fresh aggregator, the checkpoint armed from disk.
    const after = clocked();
    after.at(30_000 + 17 * MIN + 30_000, info('game_info', 'party_player_count', 1)); // any message; sets the clock
    after.agg.armResume(cp);
    attachAfterRestart(after.at, 31_000 + 18 * MIN);
    expect(after.agg.hasPendingResume()).toBe(false);
    after.at(31_000 + 19 * MIN, roster({ battlenet_tag: 'Karambo#21442', is_local: true, hero_name: 'CASSIDY', kills: 26, deaths: 11, damage: 11034 }));
    after.at(30_000 + 20 * MIN, info('match_info', 'match_outcome', 'victory'));
    after.at(30_003 + 20 * MIN, event('round_end'));
    const rec = after.at(70_000 + 20 * MIN, event('match_end'))!;

    expect(rec.matchId).toBe('3858793788');
    expect(rec.startedAt).toBe(0);
    expect(rec.rounds).toHaveLength(3);
    // Round time 8 + 7 + 5 min = 20 — the game's own clock — not the ~2 min seen after the restart.
    expect(rec.durationMinutes).toBe(20);
    expect(rec.eliminations).toBe(26);
    expect(rec.perHero?.[0]).toMatchObject({ hero: 'Cassidy', eliminations: 26, deaths: 11 });
  });

  it('drops the checkpoint for a DIFFERENT match, which starts clean', () => {
    const before = clocked();
    playUntilRestart(before.at);
    const cp = before.agg.checkpoint();
    const after = clocked();
    after.at(100, event('match_start'));
    after.agg.armResume(cp);
    after.at(200, info('match_info', 'match_id', '999'));
    expect(after.agg.hasPendingResume()).toBe(false);
    after.at(28_200, event('round_start'));
    after.at(28_200 + 5 * MIN, info('match_info', 'match_outcome', 'defeat'));
    const rec = after.at(30_000 + 5 * MIN, event('match_end'))!;
    expect(rec.matchId).toBe('999');
    expect(rec.startedAt).toBe(100);
    expect(rec.rounds).toHaveLength(1);
  });

  it('never overwrites a match this session already started', () => {
    const before = clocked();
    playUntilRestart(before.at);
    const cp = before.agg.checkpoint();
    const after = clocked();
    after.agg.armResume(cp);
    after.at(500, event('match_start'));
    after.at(600, info('match_info', 'match_id', '3858793788'));
    expect(after.agg.checkpoint()?.match.rounds).toEqual([]);
    expect(after.agg.checkpoint()?.match.record.startedAt).toBe(500);
  });

  it('ignores a checkpoint too old to be the match still running, and anything unreadable', () => {
    const before = clocked();
    playUntilRestart(before.at);
    const cp = before.agg.checkpoint()!;
    const after = clocked();
    after.at(cp.savedAt + RESUME_MAX_AGE_MS + 1, info('game_info', 'party_player_count', 1));
    after.agg.armResume(cp);
    expect(after.agg.hasPendingResume()).toBe(false);
    for (const junk of [undefined, null, 42, 'x', {}, { version: 2 }, { version: 1, savedAt: 0, match: {} }]) {
      after.agg.armResume(junk);
      expect(after.agg.hasPendingResume()).toBe(false);
    }
  });
});

describe('matchPipeline — checkpoint persistence', () => {
  /** A pipeline over a scripted aggregator, recording what reached the store. */
  function harness(opts: { pendingResume?: boolean } = {}) {
    let t = 0;
    let running: unknown = null;
    let finish = false;
    const writes: unknown[] = [];
    let clears = 0;
    const logs: unknown[][] = [];
    const deps = {
      history: { add: () => true, all: () => [], addPending: () => true, takePending: () => undefined, removePending: () => false },
      aggregator: {
        handle: () => (finish ? ({ matchId: 'x', heroes: [] } as never) : null),
        checkpoint: () => running as never,
        hasPendingResume: () => opts.pendingResume ?? false,
      },
      getConfig: () => ({ accounts: {}, breakReminder: { enabled: false } }) as never,
      notify: () => {},
      log: (...a: unknown[]) => logs.push(a),
      checkpoints: { save: (cp: unknown) => writes.push(cp), clear: () => { clears++; } },
      now: () => t,
    } as unknown as MatchPipelineDeps;
    const pipeline = createMatchPipeline(deps);
    return {
      feed: (ms: number, msg: GepMessage) => { t = ms; pipeline.feed(msg); },
      setRunning: (cp: unknown) => { running = cp; },
      endNext: () => { finish = true; },
      writes, logs, clearCount: () => clears, deps,
    };
  }
  const tick = info('roster', 'roster_0', '{}');

  it('writes on every round boundary and otherwise at most once per interval', () => {
    const h = harness();
    h.setRunning({ v: 1 });
    h.feed(0, tick); // first write
    h.feed(1_000, tick); // throttled
    h.feed(1_500, event('round_start')); // boundary → written
    h.feed(2_000, tick); // throttled
    h.feed(1_500 + CHECKPOINT_INTERVAL_MS, tick); // interval elapsed → written
    expect(h.writes).toHaveLength(3);
  });

  it('removes the file once the match is recorded', () => {
    const h = harness();
    h.setRunning({ v: 1 });
    h.feed(0, tick);
    h.endNext();
    h.setRunning(null);
    h.feed(100, event('match_end'));
    expect(h.clearCount()).toBe(1);
  });

  it('keeps a leftover file while its resume is still pending, then removes it when there is no match', () => {
    const h = harness({ pendingResume: true });
    h.feed(0, tick);
    expect(h.clearCount()).toBe(0); // the aggregator still waits for the match to be named
    (h.deps.aggregator as { hasPendingResume: () => boolean }).hasPendingResume = () => false;
    h.feed(CHECKPOINT_INTERVAL_MS, tick);
    expect(h.clearCount()).toBe(1);
    h.feed(2 * CHECKPOINT_INTERVAL_MS, tick);
    expect(h.clearCount()).toBe(1); // nothing left to clear
  });

  it('logs a failed write and keeps the pipeline running', () => {
    const h = harness();
    h.setRunning({ v: 1 });
    (h.deps.checkpoints as { save: () => void }).save = () => { throw new Error('disk full'); };
    expect(() => h.feed(0, tick)).not.toThrow();
    expect(h.logs[0]).toEqual(['match checkpoint failed', 'Error: disk full']);
  });
});
