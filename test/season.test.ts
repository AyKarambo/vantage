import { describe, it, expect } from 'vitest';
import {
  seasonStart,
  currentSeason,
  SEASON_CADENCE_MS,
  currentSeasonWindow,
  seasonsForData,
  seasonWindowById,
  migrateLegacySeasonDays,
} from '../src/core/season';

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

describe('currentSeasonWindow', () => {
  it('labels the 2026 seasons with a per-year counter (S1/S2/S3)', () => {
    expect(currentSeasonWindow(at('2026-02-10')).label).toBe('2026 Season 1');
    expect(currentSeasonWindow(at('2026-03-01')).label).toBe('2026 Season 1');
    expect(currentSeasonWindow(at('2026-04-14')).label).toBe('2026 Season 2');
    expect(currentSeasonWindow(at('2026-06-16')).label).toBe('2026 Season 3');
  });

  it('gives the first extrapolated 2027 season "2027 Season 1", not a running total', () => {
    const s3 = at('2026-06-16');
    // Walk whole cadences forward from S3 until the extrapolated start crosses
    // into 2027 — that's the first 2027-labeled season.
    let start = s3;
    while (new Date(start).getUTCFullYear() < 2027) start += SEASON_CADENCE_MS;
    expect(new Date(start).getUTCFullYear()).toBe(2027);
    const w = currentSeasonWindow(start);
    expect(w.label).toBe('2027 Season 1');
    expect(w.year).toBe(2027);
    expect(w.seasonOfYear).toBe(1);
  });

  it('falls back to a date-range label for pre-2026 seasons', () => {
    const w = currentSeasonWindow(at('2024-09-01'));
    expect(w.label).toBe('Aug 20 – Oct 15, 2024');
    expect(w.year).toBe(2024);
  });

  it('includes both years in the label when the season spans a year boundary', () => {
    // S20: 2025-12-09 – 2026-02-10 — ends in a different year than it starts.
    const w = currentSeasonWindow(at('2026-01-01'));
    expect(w.start).toBe(at('2025-12-09'));
    expect(w.end).toBe(at('2026-02-10'));
    expect(w.label).toBe('Dec 9, 2025 – Feb 10, 2026');
  });

  it('does not throw for a now preceding the first known season, clamping to it', () => {
    const now = at('2020-01-01');
    const w = currentSeasonWindow(now);
    expect(w).toEqual(currentSeasonWindow(at('2024-08-20')));
    expect(w.id).toBe('S:2024-08-20');
  });

  it('produces a half-open [start, end) window', () => {
    const w = currentSeasonWindow(at('2026-05-01')); // inside S2
    expect(w.start).toBe(at('2026-04-14'));
    expect(w.end).toBe(at('2026-06-16'));
    expect(w.start).toBeLessThanOrEqual(at('2026-05-01'));
    expect(w.end).toBeGreaterThan(at('2026-05-01'));
  });
});

describe('seasonsForData', () => {
  it('keeps only seasons with >=1 timestamp, always includes the current one, newest first', () => {
    const now = at('2026-06-20'); // inside 2026 S3
    const timestamps = [
      at('2026-02-15'), // inside S1
      at('2026-02-20'), // also inside S1 (should not duplicate the window)
      at('2026-05-01'), // inside S2
      // no timestamps in S3, but it's current so must still be listed
    ];
    const windows = seasonsForData(timestamps, now);
    expect(windows.map((w) => w.label)).toEqual(['2026 Season 3', '2026 Season 2', '2026 Season 1']);
    // newest-first ordering by start.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i - 1].start).toBeGreaterThan(windows[i].start);
    }
  });

  it('returns just the current season on a fresh install (no timestamps)', () => {
    const now = at('2026-06-20');
    const windows = seasonsForData([], now);
    expect(windows).toHaveLength(1);
    expect(windows[0].label).toBe('2026 Season 3');
  });

  it('excludes seasons with data outside their [start, end) boundary', () => {
    const now = at('2026-06-20');
    // The instant S2 ends / S3 begins belongs to S3, not S2.
    const boundary = at('2026-06-16');
    const windows = seasonsForData([boundary], now);
    const labels = windows.map((w) => w.label);
    expect(labels).toContain('2026 Season 3');
    expect(labels).not.toContain('2026 Season 2');
  });

  it('does not require timestamps to be sorted or deduplicated', () => {
    const now = at('2026-06-20');
    const timestamps = [at('2026-05-01'), at('2026-02-15'), at('2026-05-02')];
    const windows = seasonsForData(timestamps, now);
    expect(windows.map((w) => w.label)).toEqual(['2026 Season 3', '2026 Season 2', '2026 Season 1']);
  });
});

describe('seasonWindowById', () => {
  it('round-trips the id produced by currentSeasonWindow', () => {
    const now = at('2026-05-01');
    const w = currentSeasonWindow(now);
    const found = seasonWindowById(w.id, now);
    expect(found).toEqual(w);
  });

  it('round-trips ids produced by seasonsForData', () => {
    const now = at('2026-06-20');
    const windows = seasonsForData([at('2026-02-15')], now);
    for (const w of windows) {
      expect(seasonWindowById(w.id, now)).toEqual(w);
    }
  });

  it('returns undefined for an unaddressable id', () => {
    expect(seasonWindowById('season', at('2026-06-20'))).toBeUndefined();
    expect(seasonWindowById('S:not-a-date', at('2026-06-20'))).toBeUndefined();
    expect(seasonWindowById('S:2026-06-17', at('2026-06-20'))).toBeUndefined(); // not a real boundary
  });
});

describe('migrateLegacySeasonDays', () => {
  it('translates the legacy sentinel to the current named season, addressable via seasonWindowById', () => {
    const now = at('2026-06-20');
    const migrated = migrateLegacySeasonDays(now);
    expect(migrated).toEqual({ season: currentSeasonWindow(now).id });
    expect(seasonWindowById(migrated.season, now)).toEqual(currentSeasonWindow(now));
  });
});
