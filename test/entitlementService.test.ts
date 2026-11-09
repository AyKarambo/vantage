import { describe, it, expect, vi } from 'vitest';
import { createEntitlementService } from '../src/main/entitlement/service';
import { noneSource, type EntitlementSource } from '../src/main/entitlement/source';
import type { EntitlementRecord } from '../src/core/entitlement';
import { generateSampleGames } from '../src/core/sampleData';
import { dashboardRead, proPreviewRead, matchesPageRead } from '../src/main/dashboard/reads';
import { fixedSource, providerHarness } from './providerFixtures';

const DAY = 86_400_000;
const NOW = 1_000_000_000_000;

function memDoc(initial?: EntitlementRecord) {
  let value: unknown = initial;
  return { read: () => value, write: (v: unknown) => { value = v; }, get: () => value as EntitlementRecord | undefined };
}

describe('EntitlementService', () => {
  it('a fresh install with no source is free, and purchases are unavailable', async () => {
    const svc = createEntitlementService({ source: noneSource, doc: memDoc(), now: () => NOW });
    expect(svc.entitlement().tier).toBe('free');
    await svc.refresh();
    expect(svc.access(false)).toMatchObject({ tier: 'free', full: false, targets: 'locked', source: 'none' });
    expect(await svc.action('upgrade')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('the simulator drives the tier and the cache is written', async () => {
    const doc = memDoc();
    const svc = createEntitlementService({ source: fixedSource({ plan: 'pro', lastCheckedAt: NOW }), doc, now: () => NOW });
    await svc.refresh();
    expect(svc.entitlement().tier).toBe('pro');
    expect(doc.get()).toMatchObject({ plan: 'pro', everPro: true });
  });

  it('an unanswered check keeps the cached pro for the 7-day grace, then lapses', async () => {
    let now = NOW;
    const offline: EntitlementSource = { kind: 'overwolf', check: async () => undefined, action: async () => ({ ok: true }) };
    const svc = createEntitlementService({
      source: offline, doc: memDoc({ plan: 'pro', lastCheckedAt: NOW, everPro: true }), now: () => now,
    });
    now = NOW + 6 * DAY;
    await svc.refresh();
    expect(svc.entitlement().tier).toBe('pro');
    now = NOW + 8 * DAY;
    expect(svc.entitlement().tier).toBe('lapsed');
  });

  it('a throwing source is treated as offline', async () => {
    const broken: EntitlementSource = { kind: 'overwolf', check: async () => { throw new Error('net'); }, action: async () => ({ ok: true }) };
    const svc = createEntitlementService({ source: broken, doc: memDoc({ plan: 'pro', lastCheckedAt: NOW, everPro: true }), now: () => NOW });
    await expect(svc.refresh()).resolves.toMatchObject({ tier: 'pro' });
  });

  it('announces a tier change and pauses staleness on lapsed → pro', async () => {
    const onChange = vi.fn();
    const onResume = vi.fn();
    const svc = createEntitlementService({
      source: fixedSource({ plan: 'pro', lastCheckedAt: NOW }),
      doc: memDoc({ plan: 'none', everPro: true, lapsedSince: NOW - 3 * DAY }),
      now: () => NOW, onChange, onResume,
    });
    expect(svc.entitlement().tier).toBe('lapsed');
    await svc.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith(NOW - 3 * DAY, NOW);
  });

  it('ignores a malformed cache', () => {
    const svc = createEntitlementService({ source: noneSource, doc: { read: () => ({ plan: 'gold' }), write: () => {} }, now: () => NOW });
    expect(svc.entitlement().tier).toBe('free');
  });
});

describe('dashboard reads under Pro gating', () => {
  const games = generateSampleGames(120, 7);
  const target = { name: 'Use cover', mode: 'self' as const, rule: 'x' };

  function harness(record: EntitlementRecord | undefined) {
    const svc = record
      ? createEntitlementService({ source: fixedSource(record), doc: memDoc(record) })
      : undefined;
    return providerHarness({ games, deps: svc ? { entitlement: svc } : {} });
  }

  it('without an entitlement dep the provider stays ungated (tests, preview)', () => {
    const { provider } = harness(undefined);
    expect(provider.proAccess().full).toBe(true);
  });

  it('free: targets are withheld from the payload and target writes still exist in the store', () => {
    const { provider, manual } = harness({ plan: 'none', lastCheckedAt: Date.now() });
    manual.addTarget({ id: 't1', createdAt: 1, isActive: true, scope: 'season', ...target });
    const d = dashboardRead(provider, {});
    expect(d.pro).toMatchObject({ tier: 'free', full: false });
    expect(d.targets).toEqual([]);
    expect(manual.targets()).toHaveLength(1); // nothing deleted
    const rows = matchesPageRead(provider, { before: Date.now() + DAY, limit: 20 });
    expect(rows.every((r) => r.targetGrades === undefined && r.measuredGrades === undefined)).toBe(true);
  });

  it('lapsed keeps the targets list', () => {
    const { provider, manual } = harness({ plan: 'none', everPro: true, lastCheckedAt: Date.now() });
    manual.addTarget({ id: 't1', createdAt: 1, isActive: true, scope: 'season', ...target });
    const d = dashboardRead(provider, {});
    expect(d.pro.targets).toBe('read-only');
    expect(d.targets.map((t) => t.id)).toContain('t1');
  });

  it('pro sees everything', () => {
    const { provider, manual } = harness({ plan: 'pro', lastCheckedAt: Date.now() });
    manual.addTarget({ id: 't1', createdAt: 1, isActive: true, scope: 'season', ...target });
    const d = dashboardRead(provider, {});
    expect(d.pro.full).toBe(true);
    expect(d.targets.map((t) => t.id)).toContain('t1');
  });

  it('the demo preview renders every Pro screen for a free user with real history, read-only', () => {
    const { provider } = harness({ plan: 'none', lastCheckedAt: Date.now() });
    const d = proPreviewRead(provider, {});
    expect(d.isSample).toBe(true);
    expect(d.pro).toMatchObject({ full: true, demo: true, targets: 'read-only', tier: 'free' });
    expect(d.targets.length).toBeGreaterThan(0);
  });
});

describe('ManualStore.shiftActivations — the lapse pause', () => {
  it('re-stamps only active, unarchived targets', async () => {
    const { manual } = providerHarness();
    const base = { mode: 'self' as const, rule: 'x', scope: 'season' as const };
    manual.addTarget({ id: 'a', name: 'a', createdAt: 1, isActive: true, activatedAt: 100, ...base });
    manual.addTarget({ id: 'b', name: 'b', createdAt: 1, isActive: false, activatedAt: 100, ...base });
    manual.addTarget({ id: 'c', name: 'c', createdAt: 1, isActive: true, activatedAt: 100, archivedAt: 5, ...base });
    manual.shiftActivations((at) => at + 50);
    const by = Object.fromEntries(manual.targets().map((t) => [t.id, t.activatedAt]));
    expect(by).toEqual({ a: 150, b: 100, c: 100 });
  });
});

describe('EntitlementService.tick — time-only tier changes', () => {
  it('announces once when the grace runs out with no check', () => {
    let now = NOW;
    const onChange = vi.fn();
    const svc = createEntitlementService({
      source: noneSource, doc: memDoc({ plan: 'pro', lastCheckedAt: NOW, everPro: true }), now: () => now, onChange,
    });
    svc.tick();
    expect(onChange).not.toHaveBeenCalled();
    now = NOW + 8 * DAY;
    svc.tick();
    svc.tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(svc.nextChange()).toBeUndefined();
  });
});

describe('developer tier override (Settings › Developer)', () => {
  it('pins a tier on top of the real record and restores it when cleared', () => {
    const doc = memDoc();
    const onChange = vi.fn();
    const svc = createEntitlementService({ source: noneSource, doc, now: () => NOW, devOverrides: true, onChange });
    expect(svc.entitlement().tier).toBe('free');
    svc.setDevOverride('pro');
    expect(svc.devOverride()).toBe('pro');
    expect(svc.access(false)).toMatchObject({ tier: 'pro', full: true, source: 'simulated' });
    svc.setDevOverride(null);
    expect(svc.entitlement().tier).toBe('free');
    expect(svc.access(false).source).toBe('none');
    expect(doc.get()).toBeUndefined(); // the real cache was never written
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('starts on the initial override (OW_PRO_SIMULATE)', () => {
    const svc = createEntitlementService({ source: noneSource, doc: memDoc(), now: () => NOW, devOverrides: true, initialOverride: 'lapsed' });
    expect(svc.entitlement().tier).toBe('lapsed');
  });

  it('is a no-op without devOverrides (packaged build)', () => {
    const svc = createEntitlementService({ source: noneSource, doc: memDoc(), now: () => NOW, initialOverride: 'pro' });
    svc.setDevOverride('pro');
    expect(svc.devOverride()).toBeNull();
    expect(svc.entitlement().tier).toBe('free');
  });

  it('the provider refuses it unless devTools is on', () => {
    const svc = () => createEntitlementService({ source: noneSource, doc: memDoc(), devOverrides: true });
    const off = providerHarness({ deps: { entitlement: svc() } }).provider;
    expect(off.setDevProOverride('pro')).toEqual({ available: false, proOverride: null });
    expect(off.proAccess().full).toBe(false);
    const on = providerHarness({ deps: { entitlement: svc(), devTools: true } }).provider;
    expect(on.setDevProOverride('pro')).toEqual({ available: true, proOverride: 'pro' });
    expect(on.proAccess().full).toBe(true);
    expect(on.setDevProOverride('gold' as never)).toEqual({ available: true, proOverride: null });
  });
});
