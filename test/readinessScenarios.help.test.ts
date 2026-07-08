/**
 * T1 — curated scenario library: shape + drift guard. The library is trimmed
 * (9, not 29) and grouped, and every archetype's declared match signature must
 * still agree with the engine (band-group, regime, and matchable-vs-suppressed
 * confidence), so it can't silently rot as the model retunes.
 */
import { describe, it, expect } from 'vitest';
import { computeReadiness, CURATED_SCENARIOS, bandGroupFor } from '../src/core/readiness';
import type { ScenarioGroup } from '../src/core/readiness';
import { HELP_FIXTURES } from './readinessHelpFixtures';

describe('curated scenario library (readiness-help-docs)', () => {
  it('is trimmed to exactly 9 archetypes with unique ids', () => {
    expect(CURATED_SCENARIOS.length).toBe(9);
    const ids = CURATED_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(9);
  });

  it('populates all four plain-language groups', () => {
    const groups: ScenarioGroup[] = ['healthy', 'recovery', 'overload', 'guardrail'];
    for (const g of groups) {
      expect(CURATED_SCENARIOS.some((s) => s.group === g)).toBe(true);
    }
  });

  it('exactly the two recovery archetypes are library-only', () => {
    const libraryOnly = CURATED_SCENARIOS.filter((s) => s.libraryOnly).map((s) => s.id).sort();
    expect(libraryOnly).toEqual(['eight-day-layoff-rust', 'rest-day-3-supercompensation-peak']);
  });

  // Drift guard: each fixture's engine read must still land in the band-group /
  // regime its curated signature claims — and matchable vs suppressed must match
  // the confidence the model actually produces.
  for (const [key, f] of Object.entries(HELP_FIXTURES)) {
    it(`${key} — engine read agrees with its declared signature`, () => {
      const r = computeReadiness(f.games, f.now, f.ctx);
      expect(r.band).toBe(f.expect.band);
      expect(r.regime).toBe(f.expect.regime);
      expect(r.confidence).toBe(f.expect.confidence);

      if (f.curatedId === null) {
        // Suppressed fixtures must be genuinely un-personalizable.
        expect(r.score === null || r.band === 'insufficient-data' || r.confidence === 'low').toBe(true);
        return;
      }
      const scenario = CURATED_SCENARIOS.find((s) => s.id === f.curatedId);
      expect(scenario, `curated scenario ${f.curatedId} exists`).toBeDefined();
      expect(bandGroupFor(r.band)).toBe(scenario!.match.bandGroup);
      if (scenario!.match.regime) expect(r.regime).toBe(scenario!.match.regime);
      expect(r.confidence).not.toBe('low');
    });
  }
});
