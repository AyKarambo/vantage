import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GameRecord, MatchMental, MatchReview, TargetGrade } from '../src/core/analytics';
import type { Result } from '../src/core/model';
import { buildTargets, type AuthoredTarget } from '../src/core/targets';
import { mentalSummary } from '../src/core/mental';
import { computeDashboard } from '../src/core/dashboardData';
import { HistoryStore } from '../src/store/history';

let seq = 0;

function game(p: Partial<GameRecord> & { result: Result }): GameRecord {
  seq += 1;
  return {
    matchId: `m-${seq}`,
    timestamp: Date.now() - seq * 60000,
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

function review(grades: Record<string, TargetGrade>, flags: MatchMental = {}): MatchReview {
  return { at: Date.now(), grades, flags };
}

function authored(id: string, p: Partial<AuthoredTarget> = {}): AuthoredTarget {
  return { id, name: id, mode: 'self', rule: 'You grade it', createdAt: 1000, isActive: true, ...p };
}

describe('buildTargets — grade scoring', () => {
  it('counts attempts and hits from review grades; partial is an attempt, not a hit', () => {
    const games = [
      game({ result: 'Win', review: review({ t1: 'hit' }) }),
      game({ result: 'Win', review: review({ t1: 'hit' }) }),
      game({ result: 'Loss', review: review({ t1: 'partial' }) }),
      game({ result: 'Loss', review: review({ t1: 'missed' }) }),
      game({ result: 'Win' }), // ungraded — not an attempt
    ];
    const [t] = buildTargets(games, false, [authored('t1')]);
    expect(t.attempts).toBe(4);
    expect(t.hits).toBe(2);
    expect(t.hitRate).toBe(0.5);
    expect(t.winWhenHit).toBe(1); // both hit games were wins
    expect(t.winWhenMissed).toBe(0); // partial + missed games were losses
  });

  it('falls back to the player baseline while a win-split side has no games', () => {
    const games = [
      game({ result: 'Win', review: review({ t1: 'hit' }) }),
      game({ result: 'Loss' }),
      game({ result: 'Loss' }),
      game({ result: 'Loss' }),
    ];
    const base = 0.25; // 1 win / 4 decided
    const [t] = buildTargets(games, false, [authored('t1')]);
    expect(t.winWhenHit).toBe(1);
    expect(t.winWhenMissed).toBe(base); // no partial/missed games yet
  });

  it('shows a fresh target as New: 0/0 with both splits at baseline and a zero spark', () => {
    const games = [game({ result: 'Win' }), game({ result: 'Loss' })];
    const [t] = buildTargets(games, false, [authored('t1')]);
    expect(t.attempts).toBe(0);
    expect(t.hits).toBe(0);
    expect(t.hitRate).toBe(0);
    expect(t.winWhenHit).toBe(0.5);
    expect(t.winWhenMissed).toBe(0.5);
    expect(t.spark).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('builds the spark from the last 8 attempts chronologically, left-padded with 0', () => {
    // 10 graded games, oldest first: H H H H H H H H P M — the spark must keep
    // only the newest 8 (drop the two oldest hits) in play order.
    const grades: TargetGrade[] = ['hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'partial', 'missed'];
    const games = grades.map((g, i) =>
      game({ result: 'Win', timestamp: 1000 + i, review: review({ t1: g }) }));
    // Shuffle input order to prove scoring sorts by timestamp itself.
    const shuffled = [games[4], games[9], games[0], games[7], games[2], games[5], games[8], games[1], games[6], games[3]];
    const [t] = buildTargets(shuffled, false, [authored('t1')]);
    expect(t.spark).toEqual([1, 1, 1, 1, 1, 1, 0.5, 0]);

    const three = games.slice(7); // H P M → left-padded
    const [padded] = buildTargets(three, false, [authored('t1')]);
    expect(padded.spark).toEqual([0, 0, 0, 0, 0, 1, 0.5, 0]);
  });

  it('ignores grades keyed to a deleted target id', () => {
    const games = [game({ result: 'Win', review: review({ gone: 'hit', t1: 'missed' }) })];
    const out = buildTargets(games, false, [authored('t1')]);
    expect(out).toHaveLength(1);
    expect(out[0].attempts).toBe(1);
    expect(out[0].hits).toBe(0);
  });

  it('keeps archived targets in the output, flagged, so the renderer can offer Restore', () => {
    const out = buildTargets([], false, [authored('live'), authored('gone', { archivedAt: 123 })]);
    expect(out).toHaveLength(2);
    expect(out.find((t) => t.id === 'live')?.archivedAt).toBeUndefined();
    expect(out.find((t) => t.id === 'gone')?.archivedAt).toBe(123);
  });

  it('returns an empty list in real mode when no authored targets exist (B1)', () => {
    expect(buildTargets([game({ result: 'Win' })], false)).toEqual([]);
    // Both the omitted-arg and the explicit-empty-array paths (production passes `manual?.targets`, i.e. []).
    expect(buildTargets([game({ result: 'Win' })], false, [])).toEqual([]);
    // Archiving every target still yields the archived one, never the demo library.
    const onlyArchived = buildTargets([], false, [authored('t1', { archivedAt: 5 })]);
    expect(onlyArchived).toHaveLength(1);
    expect(onlyArchived[0].id).toBe('t1');
  });

  it('shows the sample library only in demo mode with zero authored targets (B2)', () => {
    const sample = buildTargets([game({ result: 'Win' })], true);
    expect(sample).toHaveLength(4);
    expect(sample.every((t) => t.isActive)).toBe(true);
    // Explicit empty-array path also yields the sample library in demo mode.
    expect(buildTargets([game({ result: 'Win' })], true, [])).toHaveLength(4);
  });

  it('lets authored targets win over the sample library in either mode (B3)', () => {
    const demo = buildTargets([game({ result: 'Win' })], true, [authored('t1')]);
    expect(demo).toHaveLength(1);
    expect(demo[0].id).toBe('t1');
    const real = buildTargets([game({ result: 'Win' })], false, [authored('t1')]);
    expect(real).toHaveLength(1);
    expect(real[0].id).toBe('t1');
  });
});

describe('mentalSummary — review-flag merge', () => {
  it('counts flags coming only from review flags', () => {
    const games = [
      game({ result: 'Win', review: review({}, { positiveComms: true }) }),
      game({ result: 'Loss', review: review({}, { tilt: true, toxicMates: true }) }),
      game({ result: 'Loss', review: review({}, { tilt: true, leaver: true }) }),
    ];
    const m = mentalSummary(games);
    expect(m.flags).toEqual({ tilt: 2, toxicMates: 1, leaver: 1, leaverMyTeam: 1, leaverEnemyTeam: 0, positiveComms: 1 });
    expect(m.winWhenTilted).toBe(0);
    expect(m.winWhenCalm).toBe(1);
  });

  it('still counts quick-log mental flags alone (regression)', () => {
    const games = [
      game({ result: 'Win', mental: { positiveComms: true } }),
      game({ result: 'Loss', mental: { tilt: true } }),
    ];
    const m = mentalSummary(games);
    expect(m.flags.tilt).toBe(1);
    expect(m.flags.positiveComms).toBe(1);
  });

  it('OR-merges both sources on one game without double-counting', () => {
    const games = [
      game({
        result: 'Loss',
        mental: { tilt: true, leaver: true },
        review: review({}, { tilt: true, toxicMates: true }),
      }),
    ];
    const m = mentalSummary(games);
    expect(m.flags).toEqual({ tilt: 1, toxicMates: 1, leaver: 1, leaverMyTeam: 1, leaverEnemyTeam: 0, positiveComms: 0 });
  });

  it('includes games tilted via either source in winWhenTilted', () => {
    const games = [
      game({ result: 'Loss', mental: { tilt: true } }),
      game({ result: 'Loss', review: review({}, { tilt: true }) }),
      game({ result: 'Win' }),
    ];
    const m = mentalSummary(games);
    expect(m.flags.tilt).toBe(2);
    expect(m.winWhenTilted).toBe(0);
    expect(m.winWhenCalm).toBe(1);
  });
});

describe('computeDashboard — review inbox decoupled from filters', () => {
  it('keeps old ungraded games in the inbox and badge while matches respects the range', () => {
    const old = game({ result: 'Win', timestamp: Date.now() - 30 * 86400000 });
    const gradedRecent = game({ result: 'Win', timestamp: Date.now() - 1000, review: review({}) });
    const recent = game({ result: 'Loss', timestamp: Date.now() - 2000 });
    const d = computeDashboard([old, gradedRecent, recent], { days: 7 }, { active: false, preference: 'off', hasRealHistory: true });

    expect(d.matches.map((m) => m.matchId)).not.toContain(old.matchId);
    const inboxIds = d.reviewInbox.map((m) => m.matchId);
    expect(inboxIds).toContain(old.matchId);
    expect(inboxIds).toContain(recent.matchId);
    expect(inboxIds).not.toContain(gradedRecent.matchId); // graded games leave the inbox
    expect(d.pendingReviews).toBe(2);
    expect(d.reviewInbox[0].matchId).toBe(recent.matchId); // newest first
  });

  it('counts pendingReviews past the inbox row cap', () => {
    const games = Array.from({ length: 160 }, () => game({ result: 'Win' }));
    const d = computeDashboard(games, {}, { active: false, preference: 'off', hasRealHistory: true });
    expect(d.reviewInbox).toHaveLength(150);
    expect(d.pendingReviews).toBe(160);
  });
});

describe('HistoryStore — review persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-history-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('setReview attaches to a known match and survives re-instantiation', () => {
    const store = new HistoryStore(dir);
    const g = game({ result: 'Win' });
    store.add(g);
    const r = review({ t1: 'hit' }, { tilt: true });
    expect(store.setReview(g.matchId, r)).toBe(true);
    const reloaded = new HistoryStore(dir).all().find((x) => x.matchId === g.matchId);
    expect(reloaded?.review).toEqual(r);
  });

  it('setReview returns false for an unknown match id', () => {
    const store = new HistoryStore(dir);
    expect(store.setReview('nope', review({}))).toBe(false);
  });

  it('setReviews bulk-imports, skipping unknown ids and existing reviews', () => {
    const store = new HistoryStore(dir);
    const fresh = game({ result: 'Win' });
    const already = game({ result: 'Loss', review: review({ t1: 'missed' }) });
    store.add(fresh);
    store.add(already);

    const result = store.setReviews([
      { matchId: fresh.matchId, review: review({ t1: 'hit' }) },
      { matchId: already.matchId, review: review({ t1: 'hit' }) },
      { matchId: 'unknown', review: review({}) },
    ]);
    expect(result).toEqual({ imported: 1, skipped: 2 });

    const reloaded = new HistoryStore(dir).all();
    expect(reloaded.find((g) => g.matchId === fresh.matchId)?.review?.grades.t1).toBe('hit');
    // The existing review is never overwritten.
    expect(reloaded.find((g) => g.matchId === already.matchId)?.review?.grades.t1).toBe('missed');
  });
});
