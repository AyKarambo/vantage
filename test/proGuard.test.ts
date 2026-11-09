import { describe, it, expect } from 'vitest';
import { createEntitlementService } from '../src/main/entitlement/service';
import { PRO_TARGET_WRITES, ProRequiredError } from '../src/main/entitlement/guard';
import { createDispatcher, McpOpError } from '../src/main/mcp/dispatch';
import { READ_OPS, ADDITIVE_WRITE_OPS, DESTRUCTIVE_OPS, type McpOp } from '../src/shared/mcp/ops';
import type { EntitlementRecord } from '../src/core/entitlement';
import type { GameRecord } from '../src/core/analytics';
import { generateSampleGames } from '../src/core/sampleData';
import { fixedSource, providerHarness } from './providerFixtures';
import { dashboardRead, matchDetailRead } from '../src/main/dashboard/reads';

const NOW = Date.now();
const FREE: EntitlementRecord = { plan: 'none', lastCheckedAt: NOW };
const LAPSED: EntitlementRecord = { plan: 'none', everPro: true, lastCheckedAt: NOW };
const PRO: EntitlementRecord = { plan: 'pro', lastCheckedAt: NOW };

function harness(record: EntitlementRecord, games: GameRecord[] = generateSampleGames(40, 3)) {
  const entitlement = createEntitlementService({
    source: fixedSource(record), doc: { read: () => record, write: () => {} },
  });
  return providerHarness({ games, deps: { entitlement } });
}

const target = { name: 'Use cover', mode: 'self' as const, rule: 'x' };

describe('provider write guard', () => {
  it('free and lapsed: every target write throws ProRequiredError and changes nothing', () => {
    for (const record of [FREE, LAPSED]) {
      const { provider, manual } = harness(record);
      manual.addTarget({ id: 't1', createdAt: 1, isActive: true, scope: 'season', ...target });
      const before = JSON.stringify(manual.targets());
      for (const name of PRO_TARGET_WRITES) {
        const fn = provider[name] as (...a: unknown[]) => unknown;
        expect(() => fn.call(provider, 't1', true), name).toThrow(ProRequiredError);
      }
      expect(JSON.stringify(manual.targets())).toBe(before);
    }
  });

  it('pro: target writes go through', () => {
    const { provider, manual } = harness(PRO);
    provider.saveTarget(target);
    expect(manual.targets()).toHaveLength(1);
  });

  it('free: a review still saves its flags and slider, without grades or focus', () => {
    const { provider, history } = harness(FREE);
    const id = history.all()[0].matchId;
    const res = provider.saveReview({
      matchId: id, grades: { t1: 'hit' }, flags: { tilt: true }, performance: 70, focusTargetIds: ['t1'],
    });
    expect(res.saved).toBe(true);
    const g = history.all().find((x) => x.matchId === id)!;
    expect(g.review?.flags).toEqual({ tilt: true });
    expect(g.review?.grades).toEqual({});
    expect(g.review?.focusTargetIds).toBeUndefined();
    expect(g.performance).toBe(70);
  });

  it('lapsed: re-saving a review keeps the grades it got while Pro', () => {
    const games = generateSampleGames(40, 3);
    const id = games[0].matchId;
    games[0] = { ...games[0], review: { at: 1, grades: { t1: 'hit' }, flags: {}, focusTargetIds: ['t1'] } };
    const { provider, history } = harness(LAPSED, games);
    provider.saveReview({ matchId: id, grades: {}, flags: { tilt: true } });
    const g = history.all().find((x) => x.matchId === id)!;
    expect(g.review?.grades).toEqual({ t1: 'hit' });
    expect(g.review?.focusTargetIds).toEqual(['t1']);
    expect(g.review?.flags).toEqual({ tilt: true });
  });
});

describe('MCP pro-required guard', () => {
  const allOps: McpOp[] = [...READ_OPS, ...ADDITIVE_WRITE_OPS, ...DESTRUCTIVE_OPS];

  it('free and lapsed: every op is refused with pro-required', async () => {
    for (const record of [FREE, LAPSED]) {
      const dispatch = createDispatcher(harness(record).provider);
      for (const op of allOps) {
        let code: string | undefined;
        try { await dispatch(op, { confirm: true }); } catch (e) { code = e instanceof McpOpError ? e.code : 'other'; }
        expect(code, op).toBe('pro-required');
      }
    }
  });

  it('pro: reads are served', async () => {
    const dispatch = createDispatcher(harness(PRO).provider);
    await expect(Promise.resolve(dispatch('dashboard', {}))).resolves.toBeDefined();
  });
});

describe('review-fix regressions', () => {
  it('lapsed: re-saving keeps a stored break mark', () => {
    const games = generateSampleGames(40, 3);
    const id = games[0].matchId;
    games[0] = { ...games[0], review: { at: 1, grades: {}, flags: {}, breakBefore: true } };
    const { provider, history } = harness(LAPSED, games);
    provider.saveReview({ matchId: id, grades: {}, flags: { tilt: true } });
    expect(history.all().find((x) => x.matchId === id)!.review?.breakBefore).toBe(true);
  });

  it('free: Pro-only settings writes are refused', () => {
    const { provider } = harness(FREE);
    expect(() => provider.setStaleness({ staleAfterDays: 3, staleAfterMatches: 3 })).toThrow(ProRequiredError);
  });

  it('free: match detail carries no stored self-grades', () => {
    const games = generateSampleGames(40, 3);
    games[0] = { ...games[0], review: { at: 1, grades: { t1: 'hit' }, flags: { tilt: true }, focusTargetIds: ['t1'] } };
    const { provider } = harness(FREE, games);
    const d = matchDetailRead(provider, games[0].matchId, {});
    expect(d?.review?.grades).toEqual({});
    expect(d?.review?.focusTargetIds).toBeUndefined();
    expect(d?.review?.flags).toEqual({ tilt: true });
  });

  it('free: the main-account pick survives the readiness gate', () => {
    const { provider } = harness(FREE);
    const d = dashboardRead(provider, {});
    expect(d.readiness.mainAccount).not.toBeNull();
  });
});
