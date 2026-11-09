import { describe, it, expect } from 'vitest';
import {
  NO_ENTITLEMENT, PRO_GRACE_MS, TRIAL_MS, nextRecord, nextTierChange, parseProSimulation, proAccess, resolveTier,
  resumeActivation,
} from '../src/core/entitlement';

const DAY = 86_400_000;
const NOW = 1_000_000_000_000;

describe('resolveTier', () => {
  it('a fresh install is free', () => {
    expect(resolveTier(undefined, NOW).tier).toBe('free');
    expect(resolveTier(NO_ENTITLEMENT, NOW).tier).toBe('free');
  });

  it('a started trial is `trial` for 14 days, then free', () => {
    const start = NOW;
    const rec = { plan: 'trial' as const, validUntil: start + TRIAL_MS, lastCheckedAt: start };
    expect(resolveTier(rec, start + 13 * DAY)).toEqual({ tier: 'trial', until: start + TRIAL_MS });
    // past day 14 — the cached record still says trial, but its period ran out
    expect(resolveTier({ ...rec, lastCheckedAt: start + 13 * DAY }, start + 15 * DAY).tier).toBe('free');
  });

  it('pro last checked 6 days ago with no network is still pro', () => {
    const rec = { plan: 'pro' as const, lastCheckedAt: NOW - 6 * DAY, everPro: true };
    const e = resolveTier(rec, NOW);
    expect(e.tier).toBe('pro');
    expect(e.graceEndsAt).toBe(NOW - 6 * DAY + PRO_GRACE_MS);
  });

  it('pro 8 days after the last successful check is lapsed', () => {
    expect(resolveTier({ plan: 'pro', lastCheckedAt: NOW - 8 * DAY, everPro: true }, NOW).tier).toBe('lapsed');
  });

  it('pro past its paid period is lapsed', () => {
    expect(resolveTier({ plan: 'pro', validUntil: NOW - 1, lastCheckedAt: NOW, everPro: true }, NOW).tier).toBe('lapsed');
  });

  it('no plan after having been pro is lapsed, not free', () => {
    expect(resolveTier({ plan: 'none', everPro: true }, NOW).tier).toBe('lapsed');
  });

  it('a lapsed user whose next check succeeds is pro again', () => {
    expect(resolveTier({ plan: 'pro', lastCheckedAt: NOW, everPro: true }, NOW).tier).toBe('pro');
  });
});

describe('proAccess', () => {
  it('trial and pro unlock everything', () => {
    for (const tier of ['trial', 'pro'] as const) {
      expect(proAccess({ tier }, false, 'none')).toMatchObject({ full: true, targets: 'full', demo: false });
    }
  });

  it('free is locked, lapsed keeps targets read-only', () => {
    expect(proAccess({ tier: 'free' }, false, 'none')).toMatchObject({ full: false, targets: 'locked' });
    expect(proAccess({ tier: 'lapsed' }, false, 'none')).toMatchObject({ full: false, targets: 'read-only' });
  });

  it('the demo dataset unlocks everything and says so', () => {
    expect(proAccess({ tier: 'free' }, true, 'none')).toMatchObject({ full: true, targets: 'full', demo: true });
    expect(proAccess({ tier: 'pro' }, true, 'none').demo).toBe(false);
  });
});

describe('parseProSimulation', () => {
  it('maps each simulated tier to a record that resolves to it', () => {
    for (const tier of ['free', 'trial', 'pro', 'lapsed'] as const) {
      const rec = parseProSimulation({ OW_PRO_SIMULATE: tier }, NOW);
      expect(rec).toBeDefined();
      expect(resolveTier(rec, NOW).tier).toBe(tier);
    }
  });

  it('ignores unset or unknown values', () => {
    expect(parseProSimulation({}, NOW)).toBeUndefined();
    expect(parseProSimulation({ OW_PRO_SIMULATE: 'gold' }, NOW)).toBeUndefined();
  });
});

describe('nextRecord — lapse bookkeeping', () => {
  it('stamps lapsedSince when pro access stops', () => {
    const prev = { plan: 'pro' as const, lastCheckedAt: NOW - DAY, everPro: true };
    const { record, resumedFrom } = nextRecord(prev, { plan: 'none', lastCheckedAt: NOW }, NOW);
    expect(record).toMatchObject({ plan: 'none', everPro: true, lapsedSince: NOW });
    expect(resumedFrom).toBeUndefined();
  });

  it('keeps the original lapse start across further checks', () => {
    const prev = { plan: 'none' as const, everPro: true, lapsedSince: NOW - 5 * DAY };
    expect(nextRecord(prev, { plan: 'none', lastCheckedAt: NOW }, NOW).record.lapsedSince).toBe(NOW - 5 * DAY);
  });

  it('reports the pause on lapsed → pro and clears lapsedSince', () => {
    const prev = { plan: 'none' as const, everPro: true, lapsedSince: NOW - 5 * DAY };
    const { record, resumedFrom } = nextRecord(prev, { plan: 'pro', lastCheckedAt: NOW }, NOW);
    expect(resumedFrom).toBe(NOW - 5 * DAY);
    expect(record.lapsedSince).toBeUndefined();
    expect(record.everPro).toBe(true);
  });

  it('a never-paid free user never gets a lapse stamp', () => {
    expect(nextRecord(NO_ENTITLEMENT, { plan: 'none', lastCheckedAt: NOW }, NOW).record.lapsedSince).toBeUndefined();
  });
});

describe('resumeActivation — staleness pauses while lapsed', () => {
  it('shifts activation forward by the lapse', () => {
    expect(resumeActivation(NOW - 10 * DAY, NOW - 5 * DAY, NOW)).toBe(NOW - 5 * DAY);
  });

  it('a target activated during the lapse is shifted only by the part after activation', () => {
    expect(resumeActivation(NOW - 2 * DAY, NOW - 5 * DAY, NOW)).toBe(NOW);
  });

  it('never moves backwards', () => {
    expect(resumeActivation(NOW, NOW - DAY, NOW - 2 * DAY)).toBe(NOW);
  });
});

describe('lapses caused by time alone (review fixes)', () => {
  it('dates an unannounced grace lapse from the record, and pauses staleness from there', () => {
    const prev = { plan: 'pro' as const, lastCheckedAt: NOW - 20 * DAY, everPro: true };
    const { resumedFrom } = nextRecord(prev, { plan: 'pro', lastCheckedAt: NOW }, NOW);
    expect(resumedFrom).toBe(NOW - 20 * DAY + PRO_GRACE_MS);
  });

  it('dates an unannounced period end from validUntil', () => {
    const prev = { plan: 'pro' as const, validUntil: NOW - 3 * DAY, lastCheckedAt: NOW - 4 * DAY, everPro: true };
    const { record } = nextRecord(prev, { plan: 'none', lastCheckedAt: NOW }, NOW);
    expect(record.lapsedSince).toBe(NOW - 3 * DAY);
  });

  it('nextTierChange names the trial end or the grace end, whichever is next', () => {
    expect(nextTierChange({ plan: 'trial', validUntil: NOW + DAY, lastCheckedAt: NOW }, NOW)).toBe(NOW + DAY);
    expect(nextTierChange({ plan: 'pro', lastCheckedAt: NOW }, NOW)).toBe(NOW + PRO_GRACE_MS);
    expect(nextTierChange({ plan: 'none' }, NOW)).toBeUndefined();
  });
});
