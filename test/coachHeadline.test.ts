import { describe, it, expect } from 'vitest';
import { coachHeadline } from '../renderer/src/coachHeadline';
import type { DashboardData, FocusEntry, Group } from '../src/shared/contract';

/**
 * `coachHeadline` is renderer-side (not `src/core/`) because it consumes the
 * contract's already-computed `DashboardData` directly and returns
 * navigation output shaped for `ViewId`/`ViewParams` — but it's still a pure
 * function, so it gets the same direct vitest coverage as any `src/core/`
 * analytics function (the `backStack.test.ts` pattern).
 */

const grp = (key: string, wins: number, losses: number): Group => {
  const decided = wins + losses;
  return { key, games: decided, wins, losses, draws: 0, winrate: decided ? wins / decided : 0 };
};

const roleEntry = (key: string, games: number, net: number): FocusEntry => ({
  key,
  dimension: 'role',
  games,
  wins: (games - net) / 2,
  losses: (games + net) / 2,
  draws: 0,
  winrate: (games - net) / 2 / games,
  net,
});

/** A minimal fixture: only the fields `coachHeadline` actually reads are meaningful. */
function baseData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    focusItems: [],
    byRole: [],
    sessionPosition: [],
    ...overrides,
  } as DashboardData;
}

describe('coachHeadline', () => {
  it('falls back when no signal qualifies', () => {
    expect(coachHeadline(baseData())).toEqual({ text: 'No strong signal yet — keep logging.' });
  });

  it('leads with rank movement once it clears the neutral band', () => {
    const d = baseData({
      primaryRank: { account: 'Karambo', role: 'tank', tier: 'Gold', division: 2, progressPct: 40, protected: false, movement: 22 },
    });
    const headline = coachHeadline(d);
    expect(headline.source).toBe('trends');
    expect(headline.text).toMatch(/up \+22%.*climbing/);
  });

  it('reads a negative movement as sliding, with the down arrow direction', () => {
    const d = baseData({
      primaryRank: { account: 'Karambo', role: 'tank', tier: 'Gold', division: 2, progressPct: 40, protected: false, movement: -15 },
    });
    expect(coachHeadline(d).text).toMatch(/down −15%.*sliding/);
  });

  it('stays silent on movement inside the neutral band (matches the Rank KPI arrow threshold)', () => {
    const d = baseData({
      primaryRank: { account: 'Karambo', role: 'tank', tier: 'Gold', division: 2, progressPct: 40, protected: false, movement: 7 },
    });
    expect(coachHeadline(d)).toEqual({ text: 'No strong signal yet — keep logging.' });
  });

  it('attributes the swing to whichever role is clearly carrying or dragging it', () => {
    const d = baseData({
      primaryRank: { account: 'Karambo', role: 'tank', tier: 'Gold', division: 2, progressPct: 40, protected: false, movement: 20 },
      byRole: [grp('tank', 3, 5), grp('damage', 2, 10)],
    });
    expect(coachHeadline(d).text).toContain('Damage is dragging it down');
  });

  it('omits attribution when no role clears its own sample/margin gate', () => {
    const d = baseData({
      primaryRank: { account: 'Karambo', role: 'tank', tier: 'Gold', division: 2, progressPct: 40, protected: false, movement: 20 },
      byRole: [grp('tank', 4, 5)],
    });
    expect(coachHeadline(d).text).not.toContain('—');
  });

  it('falls through to a well-evidenced role deficit when rank movement has nothing to say', () => {
    const d = baseData({
      focusItems: [roleEntry('support', 40, 8), roleEntry('damage', 35, 3)],
    });
    const headline = coachHeadline(d);
    expect(headline.source).toBe('focus');
    expect(headline.text).toBe('Support is costing you 8 net losses over 40 games this range.');
  });

  it('ignores a role deficit under the sample floor', () => {
    const d = baseData({
      focusItems: [roleEntry('support', 12, 6)],
    });
    expect(coachHeadline(d)).toEqual({ text: 'No strong signal yet — keep logging.' });
  });

  it('ignores a map/hero focus entry even with a huge net — role deficit only', () => {
    const d = baseData({
      focusItems: [{ ...roleEntry('Ilios', 40, 10), dimension: 'map' }],
    });
    expect(coachHeadline(d)).toEqual({ text: 'No strong signal yet — keep logging.' });
  });

  it('falls through to session fade as the last resort', () => {
    const d = baseData({
      sessionPosition: [
        grp('1', 3, 2),
        grp('2', 2, 3),
        grp('4', 1, 7),
      ],
    });
    const headline = coachHeadline(d);
    expect(headline.source).toBe('trends');
    expect(headline.text).toBe('You drop to 13% from game 4 on — ending sessions earlier is free rank.');
  });

  it('prioritizes rank movement over a real role deficit', () => {
    const d = baseData({
      primaryRank: { account: 'Karambo', role: 'tank', tier: 'Gold', division: 2, progressPct: 40, protected: false, movement: 30 },
      focusItems: [roleEntry('support', 40, 8)],
    });
    expect(coachHeadline(d).source).toBe('trends');
  });

  it('prioritizes a role deficit over session fade', () => {
    const d = baseData({
      focusItems: [roleEntry('support', 40, 8)],
      sessionPosition: [grp('1', 3, 2), grp('2', 2, 3), grp('4', 1, 7)],
    });
    expect(coachHeadline(d).source).toBe('focus');
  });
});
