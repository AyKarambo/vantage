/**
 * T2 — nearest-scenario matcher (AC6b / AC8). Golden: each matchable fixture's
 * live read resolves to the expected primary archetype, with 1–2 alternates and
 * deterministic output. Data-suppressed reads (low-confidence / insufficient)
 * return null — personalization stays honestly off.
 */
import { describe, it, expect } from 'vitest';
import { computeReadiness, matchScenarios } from '../src/core/readiness';
import { span, ts, CALM } from './readinessFixtures';
import { HELP_FIXTURES, MATCHABLE_FIXTURES, SUPPRESSED_FIXTURES } from './readinessHelpFixtures';

describe('matchScenarios — matchable reads', () => {
  for (const [key, f] of MATCHABLE_FIXTURES) {
    it(`${key} → primary ${f.curatedId} (+1–2 alternates, deterministic)`, () => {
      const r = computeReadiness(f.games, f.now, f.ctx);
      const result = matchScenarios(r);
      expect(result, `${key} should match`).not.toBeNull();
      expect(result!.primary.id).toBe(f.curatedId);

      // AC6b — always at least one, never more than two alternates, none the primary.
      expect(result!.alternates.length).toBeGreaterThanOrEqual(1);
      expect(result!.alternates.length).toBeLessThanOrEqual(2);
      expect(result!.alternates.some((a) => a.id === result!.primary.id)).toBe(false);
      const altIds = result!.alternates.map((a) => a.id);
      expect(new Set(altIds).size).toBe(altIds.length);

      // Deterministic: identical summary in → identical ranking out.
      const again = matchScenarios(computeReadiness(f.games, f.now, f.ctx));
      expect(again).toEqual(result);
    });
  }
});

describe('matchScenarios — data-suppressed reads return null', () => {
  for (const [key, f] of SUPPRESSED_FIXTURES) {
    it(`${key} → null`, () => {
      const r = computeReadiness(f.games, f.now, f.ctx);
      expect(matchScenarios(r)).toBeNull();
    });
  }
});

describe('matchScenarios — reads with no same-state archetype suppress (no cross-match)', () => {
  it('a rusty, medium-confidence read (week off, mental-logged, no stats) → null', () => {
    // ~3 weeks of mental-logged play, then a 7-day break: band 'rusty', regime
    // 'manual', confidence 'medium' (mental coverage), real score — so it clears the
    // confidence gate, but there is no matchable 'rusty' archetype, so matching a
    // rested player to a grind story would be backwards. Personalization must stay off.
    const games = span(0, 20, { perDay: 4, mental: CALM });
    const r = computeReadiness(games, ts(27, 20), { targets: [] });
    expect(r.band).toBe('rusty');
    expect(r.confidence).not.toBe('low');
    expect(r.score).not.toBeNull();
    expect(matchScenarios(r)).toBeNull();
  });
});

describe('matchScenarios — the dampener guard is signal-gated', () => {
  it('a loaded read without the target-focus signal never matches the dampened archetype', () => {
    // grind-all-manual is loaded/manual but carries no active-target grades.
    const f = HELP_FIXTURES['grind-all-manual'];
    const r = computeReadiness(f.games, f.now, f.ctx);
    expect(r.signals.some((s) => s.key === 'target-focus')).toBe(false);
    const result = matchScenarios(r)!;
    const ids = [result.primary.id, ...result.alternates.map((a) => a.id)];
    expect(ids).not.toContain('grind-wr-slump-dampened');
  });
});
