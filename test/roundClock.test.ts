import { describe, it, expect } from 'vitest';
import { DOORS_FALLBACK_MS, clockStartOf, noteDoors, revealsOpponentHero, roundClockMs } from '../src/core/roundClock';

/**
 * When the match clock runs inside a GEP round: from round_start for a match's
 * first round, from the doors opening (the opponents' heroes appearing) for
 * every round after a round change.
 */

describe('revealsOpponentHero — the doors-open signal', () => {
  // Shapes from a real capture (2026-10-25), trimmed.
  it('is an opponent with a hero_id — the name is still null when the doors open', () => {
    expect(revealsOpponentHero('{"hero_name":null,"team":0,"hero_id":9,"is_teammate":false,"is_local":false}')).toBe(true);
  });

  it('is not an opponent still masked through hero select', () => {
    expect(revealsOpponentHero({ hero_name: 'UNKNOWN', team: 0, hero_id: 0, is_teammate: false })).toBe(false);
    expect(revealsOpponentHero({ hero_name: null, team: 0, hero_id: 0, is_teammate: false })).toBe(false);
  });

  it('is not a teammate or the local player picking a hero', () => {
    expect(revealsOpponentHero({ hero_name: 'CASSIDY', team: 1, hero_id: 66, is_teammate: true, is_local: true })).toBe(false);
    expect(revealsOpponentHero({ hero_name: 'GENJI', team: 1, hero_id: 41, is_teammate: true })).toBe(false);
  });

  it('falls back to the local team when the tick has no is_teammate', () => {
    expect(revealsOpponentHero({ team: 0, hero_id: 9 }, 1)).toBe(true);
    expect(revealsOpponentHero({ team: 1, hero_id: 9 }, 1)).toBe(false);
    expect(revealsOpponentHero({ team: 0, hero_id: 9 })).toBe(false); // no side known — no guess
  });

  it('ignores what is not a roster object', () => {
    expect(revealsOpponentHero(null)).toBe(false);
    expect(revealsOpponentHero('not json')).toBe(false);
  });
});

describe('clockStartOf / roundClockMs', () => {
  it('a first round runs from its start', () => {
    expect(clockStartOf({ startedAt: 1000 })).toBe(1000);
    expect(roundClockMs({ startedAt: 1000, endedAt: 61_000 })).toBe(60_000);
  });

  it('a round after a round change runs from its doors', () => {
    expect(roundClockMs({ startedAt: 0, endedAt: 300_000, waitsForDoors: true, doorsAt: 49_000 })).toBe(251_000);
  });

  it('without a reveal it falls back to a fixed start, and never goes negative', () => {
    expect(clockStartOf({ startedAt: 0, waitsForDoors: true })).toBe(DOORS_FALLBACK_MS);
    expect(roundClockMs({ startedAt: 0, endedAt: 30_000, waitsForDoors: true })).toBe(0);
  });
});

describe('noteDoors', () => {
  const reveal = { team: 0, hero_id: 9, is_teammate: false };

  it('stamps the first reveal on a waiting round', () => {
    expect(noteDoors({ startedAt: 0, waitsForDoors: true }, reveal, 49_000)).toEqual({ startedAt: 0, waitsForDoors: true, doorsAt: 49_000 });
  });

  it('returns the same round when there is nothing to note', () => {
    const first = { startedAt: 0 };
    const opened = { startedAt: 0, waitsForDoors: true, doorsAt: 49_000 };
    const closed = { startedAt: 0, endedAt: 10_000, waitsForDoors: true };
    expect(noteDoors(first, reveal, 5)).toBe(first);
    expect(noteDoors(opened, reveal, 60_000)).toBe(opened);
    expect(noteDoors(closed, reveal, 20_000)).toBe(closed);
    expect(noteDoors(undefined, reveal, 5)).toBeUndefined();
  });
});
