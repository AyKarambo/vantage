import { describe, it, expect } from 'vitest';
import { seasonStart, currentSeason, SEASON_CADENCE_MS } from '../src/core/season';

const at = (iso: string) => Date.parse(iso);
const DAY = 86_400_000;

describe('season window', () => {
  it('returns the table start when now sits exactly on a boundary', () => {
    expect(seasonStart(at('2026-06-16'))).toBe(at('2026-06-16'));
  });

  it('returns the containing season for a mid-season now', () => {
    // 2025-05-01 is between S16 (2025-04-22) and S17 (2025-06-24).
    const { start, end } = currentSeason(at('2025-05-01'));
    expect(start).toBe(at('2025-04-22'));
    expect(end).toBe(at('2025-06-24'));
  });

  it('does not advance to the next season until its boundary is reached', () => {
    // The day before S17 still belongs to S16.
    expect(seasonStart(at('2025-06-23'))).toBe(at('2025-04-22'));
    // On the S17 boundary it flips.
    expect(seasonStart(at('2025-06-24'))).toBe(at('2025-06-24'));
  });

  it('extrapolates by a whole cadence past the last known season', () => {
    const last = at('2026-06-16');
    // One cadence + 5 days past the last table entry → exactly one cadence forward.
    const now = last + SEASON_CADENCE_MS + 5 * DAY;
    const { start, end } = currentSeason(now);
    expect(start).toBe(last + SEASON_CADENCE_MS);
    expect(end).toBe(last + 2 * SEASON_CADENCE_MS);
    expect(start).toBeLessThanOrEqual(now);
  });

  it('stays on the last known season within its first cadence', () => {
    const last = at('2026-06-16');
    expect(seasonStart(last + 10 * DAY)).toBe(last);
  });

  it('is defensive for a now that precedes the table', () => {
    const first = at('2024-08-20');
    const now = at('2024-01-01');
    const start = seasonStart(now);
    expect(start).toBeLessThanOrEqual(now);
    expect(now - start).toBeLessThan(SEASON_CADENCE_MS);
    // Aligned to the table's cadence grid.
    expect((first - start) % SEASON_CADENCE_MS).toBe(0);
  });

  it('never returns a start after now', () => {
    for (const iso of ['2024-09-01', '2025-01-15', '2025-12-31', '2026-07-05']) {
      expect(seasonStart(at(iso))).toBeLessThanOrEqual(at(iso));
    }
  });
});
