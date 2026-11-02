import { describe, it, expect } from 'vitest';
import { createEntitlementService } from '../src/main/entitlement/service';
import { simulatedSource } from '../src/main/entitlement/source';
import { PRO_TARGET_WRITES, ProRequiredError } from '../src/main/entitlement/guard';
import { createDispatcher, McpOpError } from '../src/main/mcp/dispatch';
import { READ_OPS, ADDITIVE_WRITE_OPS, DESTRUCTIVE_OPS, type McpOp } from '../src/shared/mcp/ops';
import type { EntitlementRecord } from '../src/core/entitlement';
import type { GameRecord } from '../src/core/analytics';
import { generateSampleGames } from '../src/core/sampleData';
import { providerHarness } from './providerFixtures';

const NOW = Date.now();
const FREE: EntitlementRecord = { plan: 'none', lastCheckedAt: NOW };
const LAPSED: EntitlementRecord = { plan: 'none', everPro: true, lastCheckedAt: NOW };
const PRO: EntitlementRecord = { plan: 'pro', lastCheckedAt: NOW };

function harness(record: EntitlementRecord, games: GameRecord[] = generateSampleGames(40, 3)) {
  const entitlement = createEntitlementService({
    source: simulatedSource(record), doc: { read: () => record, write: () => {} },
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
