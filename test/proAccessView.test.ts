import { describe, it, expect } from 'vitest';
import { proAccess } from '../src/core/entitlement';
import {
  daysLeft, isLockedView, proViewOf, purchaseAvailable, showsProBadge, targetsReadOnly, tierLabel, tierDetail,
} from '../renderer/src/proAccess';

const free = proAccess({ tier: 'free' }, false, 'none');
const lapsed = proAccess({ tier: 'lapsed' }, false, 'none');
const pro = proAccess({ tier: 'pro' }, false, 'simulated');
const trial = proAccess({ tier: 'trial', until: 3 * 86_400_000 }, false, 'simulated');
const demo = proAccess({ tier: 'free' }, true, 'none');

describe('renderer Pro access', () => {
  it('maps the target drill-down onto Targets, and free screens onto nothing', () => {
    expect(proViewOf('targetDetail')).toBe('targets');
    expect(proViewOf('readiness')).toBe('readiness');
    expect(proViewOf('overview')).toBeNull();
    expect(proViewOf('focus')).toBeNull();
  });

  it('free locks Readiness, Mental and Targets; free screens never lock', () => {
    for (const v of ['readiness', 'mental', 'targets', 'targetDetail'] as const) expect(isLockedView(v, free), v).toBe(true);
    for (const v of ['overview', 'matches', 'maps', 'heroes', 'trends', 'focus', 'review'] as const) expect(isLockedView(v, free), v).toBe(false);
  });

  it('lapsed keeps Targets open (read-only) but locks Readiness and Mental', () => {
    expect(isLockedView('targets', lapsed)).toBe(false);
    expect(isLockedView('targetDetail', lapsed)).toBe(false);
    expect(targetsReadOnly(lapsed)).toBe(true);
    expect(isLockedView('readiness', lapsed)).toBe(true);
    expect(isLockedView('mental', lapsed)).toBe(true);
  });

  it('trial, pro and the demo dataset lock nothing and show no badge', () => {
    for (const a of [trial, pro, demo]) {
      for (const v of ['readiness', 'mental', 'targets'] as const) {
        expect(isLockedView(v, a)).toBe(false);
        expect(showsProBadge(v, a)).toBe(false);
      }
    }
  });

  it('badges only the three Pro nav items', () => {
    expect(showsProBadge('readiness', free)).toBe(true);
    expect(showsProBadge('targets', lapsed)).toBe(true);
    expect(showsProBadge('targetDetail', free)).toBe(false);
    expect(showsProBadge('overview', free)).toBe(false);
  });

  it('purchases are unavailable until a real source exists', () => {
    expect(purchaseAvailable(free)).toBe(false);
    expect(purchaseAvailable(pro)).toBe(true);
    expect(purchaseAvailable({ ...pro, source: 'developer' })).toBe(false);
  });

  it('labels the tier with days left', () => {
    expect(daysLeft(undefined, 0)).toBeNull();
    expect(daysLeft(3 * 86_400_000, 1)).toBe(3);
    expect(tierLabel(trial, 0)).toBe('Vantage Pro trial · 3 days left');
    expect(tierLabel(free, 0)).toBe('Free');
    expect(tierLabel(lapsed, 0)).toMatch(/ended/);
  });

  it('words the tier detail line', () => {
    expect(tierDetail(free)).toContain('Tracking, stats and matches stay free');
    expect(tierDetail(lapsed)).toContain('kept');
    expect(tierDetail(trial)).toMatch(/^Trial ends on /);
    expect(tierDetail({ ...pro, until: 5 * 86_400_000 })).toMatch(/^Renews\/ends on /);
    expect(tierDetail({ ...pro, until: undefined, graceEndsAt: 5 * 86_400_000 })).toMatch(/^Works offline until /);
  });
});
