import { describe, it, expect } from 'vitest';
import type { GameRecord, MatchReview } from '../src/core/analytics';
import type { AuthoredTarget } from '../src/core/targets';
import { computeDashboard } from '../src/core/dashboardData';
import { DEFAULT_COACHING } from '../src/core/coachingSettings';

const MIN = 60_000;
const NOW = Date.now();
let seq = 0;

/** A 10-minute Win ending `minAgo` minutes ago. */
function game(minAgo: number, review?: Partial<MatchReview>): GameRecord {
  return {
    matchId: `pd-${seq++}`,
    timestamp: NOW - minAgo * MIN,
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    result: 'Win',
    gameType: 'Competitive',
    heroes: ['Genji'],
    durationMinutes: 10,
    ...(review ? { review: { at: NOW, grades: {}, flags: {}, ...review } } : {}),
  };
}

function authored(id: string, p: Partial<AuthoredTarget> = {}): AuthoredTarget {
  return { id, name: id, mode: 'self', rule: 'You grade it', createdAt: 0, activatedAt: 0, isActive: true, ...p };
}

const demo = { active: false, preference: 'real' as const, hasRealHistory: true };

describe('computeDashboard — practice focus wiring (#321)', () => {
  it('a self-rated target ages only on the games it was worked on (AC11)', () => {
    const games: GameRecord[] = [];
    for (let i = 0; i < 40; i++) {
      games.push(game(4000 - i * 60, i < 12 ? { grades: { a: 'hit' }, focusTargetIds: ['a'] } : { grades: { b: 'hit' } }));
    }
    const d = computeDashboard(games, { days: 'all' }, demo, { targets: [authored('a'), authored('b')] });
    const byId = new Map(d.targets.map((t) => [t.id, t]));
    expect(byId.get('a')!.matchesSinceActive).toBe(12);
    expect(byId.get('b')!.matchesSinceActive).toBe(28);
  });

  it('inbox rows carry the pre-selected focus and the auto-detected break', () => {
    const graded = game(60, { grades: { a: 'hit' }, focusTargetIds: ['a'] });
    const rested = game(30); // starts 20 minutes after `graded` ended
    const d = computeDashboard([graded, rested], { days: 'all' }, demo, {
      targets: [authored('a'), authored('b')],
      coaching: { ...DEFAULT_COACHING, focusStickiness: 'sitting' },
    });
    const row = d.reviewInbox.find((r) => r.matchId === rested.matchId)!;
    expect(row.suggestedFocus).toEqual(['a']);
    expect(row.autoBreak).toBe(true);
  });

  it('stats-only players get no extras on their inbox rows (AC25)', () => {
    const d = computeDashboard([game(60), game(55)], { days: 'all' }, demo, {});
    for (const r of d.reviewInbox) {
      expect(r.suggestedFocus).toBeUndefined();
    }
  });
});
