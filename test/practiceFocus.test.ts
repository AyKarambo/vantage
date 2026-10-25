import { describe, it, expect } from 'vitest';
import {
  autoBreakBefore, breakBefore, focusGamesSince, focusOf, focusPreselection, gameContexts, practiceFocusOn, sittingsOf,
} from '../src/core/practice';
import { DEFAULT_COACHING, type CoachingSettings } from '../src/core/coachingSettings';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets/notionBookkeeping';
import type { GameRecord, MatchReview, TargetGrade } from '../src/core/analytics';
import type { SessionCheckIn } from '../src/core/checkIn';

// ---- fixtures ---------------------------------------------------------------

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 20, 18, 0);
let seq = 0;

/** A 10-minute game ending `endMin` minutes after T0. */
function game(endMin: number, review?: Partial<MatchReview>): GameRecord {
  return {
    matchId: `m${seq++}`,
    timestamp: T0 + endMin * MIN,
    account: 'Main',
    role: 'damage',
    map: 'Ilios',
    result: 'Win',
    gameType: 'Competitive',
    heroes: ['Genji'],
    durationMinutes: 10,
    ...(review ? { review: { at: T0 + endMin * MIN + 1, grades: {}, flags: {}, ...review } } : {}),
  };
}

const grades = (g: Record<string, TargetGrade>): Partial<MatchReview> => ({ grades: g });
const settings = (p: Partial<CoachingSettings> = {}): CoachingSettings => ({ ...DEFAULT_COACHING, ...p });

// ---- focusOf -----------------------------------------------------------------

describe('focusOf', () => {
  it('reads a legacy review (no focusTargetIds) as its graded targets (AC10)', () => {
    expect(focusOf({ at: 1, grades: { a: 'hit', b: 'missed' }, flags: {} }).sort()).toEqual(['a', 'b']);
  });

  it('keeps an explicit "Nothing specific" choice empty (AC4)', () => {
    expect(focusOf({ at: 1, grades: {}, flags: {}, focusTargetIds: [] })).toEqual([]);
  });

  it('unites the chosen set with graded targets and drops the Notion bookkeeping id', () => {
    const r: MatchReview = { at: 1, grades: { b: 'hit', [NOTION_IMPROVEMENT_TARGET_ID]: 'hit' }, flags: {}, focusTargetIds: ['a'] };
    expect(focusOf(r).sort()).toEqual(['a', 'b']);
    expect(focusOf(undefined)).toEqual([]);
  });
});

// ---- practiceFocusOn -----------------------------------------------------------

describe('practiceFocusOn', () => {
  const active = [{ isActive: true }];
  it('auto follows active, non-archived targets (AC1)', () => {
    expect(practiceFocusOn({ practiceFocus: 'auto' }, active)).toBe(true);
    expect(practiceFocusOn({ practiceFocus: 'auto' }, [])).toBe(false);
    expect(practiceFocusOn({ practiceFocus: 'auto' }, [{ isActive: true, archivedAt: 5 }, { isActive: false }])).toBe(false);
  });

  it('on/off override the targets (AC2)', () => {
    expect(practiceFocusOn({ practiceFocus: 'off' }, [...active, ...active, ...active])).toBe(false);
    expect(practiceFocusOn({ practiceFocus: 'on' }, [])).toBe(true);
  });
});

// ---- focusPreselection ---------------------------------------------------------

describe('focusPreselection', () => {
  const selectable = new Set(['a', 'b']);

  it('"this sitting" carries the choice within a sitting, not into the next one (AC6)', () => {
    const g1 = game(0, { ...grades({ a: 'hit' }), focusTargetIds: ['a'] });
    const g2 = game(15);
    const next = game(15 + 200); // a 200-minute gap starts a new sitting
    const all = [g1, g2, next];
    expect(focusPreselection(all, g2, 'sitting', [], selectable)).toEqual(['a']);
    expect(focusPreselection(all, next, 'sitting', [], selectable)).toEqual([]);
  });

  it('"this game" never carries over; "until I change it" carries across sittings (AC7)', () => {
    const g1 = game(0, { ...grades({ b: 'partial' }), focusTargetIds: ['b'] });
    const later = game(600);
    expect(focusPreselection([g1, later], later, 'game', [], selectable)).toEqual([]);
    expect(focusPreselection([g1, later], later, 'sticky', [], selectable)).toEqual(['b']);
  });

  it('"until I change it" follows the most recently SAVED choice', () => {
    const old = game(0, { focusTargetIds: ['a'], grades: { a: 'hit' } });
    const newer = game(10, { focusTargetIds: ['b'], grades: { b: 'hit' } });
    old.review!.at = T0 + 999 * MIN; // graded last, although played first
    const g = game(900);
    expect(focusPreselection([old, newer, g], g, 'sticky', [], selectable)).toEqual(['a']);
  });

  it('a hero-scoped pick survives a game it was out of scope for', () => {
    // 'a' is Genji-only; 'b' applies everywhere. A Sojourn game in between can
    // only offer 'b', so its pick must not overwrite the Genji choice.
    const scopes = new Map([['a', { heroScope: ['Genji'] }]]);
    const g1 = game(0, { focusTargetIds: ['a'], grades: { a: 'hit' } });
    const sojourn = { ...game(15, { focusTargetIds: ['b'], grades: { b: 'hit' } }), heroes: ['Sojourn'] };
    const g3 = game(30);
    const all = [g1, sojourn, g3];
    for (const mode of ['sitting', 'sticky'] as const) {
      expect(focusPreselection(all, g3, mode, [], selectable, undefined, scopes)).toEqual(['a']);
      // Without scopes it is the old nearest/latest read.
      expect(focusPreselection(all, g3, mode, [], selectable)).toEqual(['b']);
    }
    // The next Sojourn game still takes the latest choice — the Sojourn one.
    const sojourn2 = { ...game(45), heroes: ['Sojourn'] };
    expect(focusPreselection([...all, sojourn2], sojourn2, 'sticky', [], selectable, undefined, scopes)).toEqual(['b']);
  });

  it('falls back to the check-in\'s today\'s focus for that sitting only (AC8)', () => {
    const g = game(30);
    const nextSitting = game(400);
    const checkIns: SessionCheckIn[] = [{ at: T0, mood: 'calm', focusTargetIds: ['b'] }];
    expect(focusPreselection([g, nextSitting], g, 'sitting', checkIns, selectable)).toEqual(['b']);
    expect(focusPreselection([g, nextSitting], nextSitting, 'sitting', checkIns, selectable)).toEqual([]);
  });

  it('a no-read review is not a choice, and inactive targets are never pre-selected', () => {
    const noRead = game(0, { grades: {} });
    const g = game(15);
    expect(focusPreselection([noRead, g], g, 'sitting', [], selectable)).toEqual([]);
    const gone = game(0, { focusTargetIds: ['archived'] });
    expect(focusPreselection([gone, g], g, 'sitting', [], selectable)).toEqual([]);
  });
});

// ---- breaks ----------------------------------------------------------------------

describe('breaks', () => {
  it('auto detection reads the gap from the previous end to this game\'s start (AC21)', () => {
    const prev = game(0);
    const quick = game(15); // starts 5 min after prev ended
    const rested = game(27); // starts 17 min after prev ended
    expect(autoBreakBefore(quick, prev, settings())).toBe(false);
    expect(autoBreakBefore(rested, prev, settings())).toBe(true);
    expect(autoBreakBefore(rested, null, settings())).toBe(false);
  });

  it('manual mode only counts the player\'s mark (AC21a)', () => {
    const prev = game(0);
    const long = game(50);
    expect(breakBefore(long, prev, settings({ breakDetection: 'manual' }))).toBe(false);
    const marked = game(12, { breakBefore: true });
    expect(breakBefore(marked, prev, settings({ breakDetection: 'manual' }))).toBe(true);
  });

  it('the player can remove an auto-detected break (AC21b)', () => {
    const prev = game(0);
    const unmarked = game(30, { breakBefore: false });
    expect(breakBefore(unmarked, prev, settings())).toBe(false);
  });

  it('gameContexts tracks position, breaks and the run without a break', () => {
    const gs = [game(0), game(12), game(24), game(53), game(65)];
    const ctx = gameContexts(gs, [], settings());
    expect(gs.map((g) => ctx.get(g.matchId)!.position)).toEqual([1, 2, 3, 4, 5]);
    expect(gs.map((g) => ctx.get(g.matchId)!.afterBreak)).toEqual([false, false, false, true, true]);
    expect(gs.map((g) => ctx.get(g.matchId)!.run)).toEqual([1, 2, 3, 1, 2]);
  });
});

// ---- sittings + staleness ---------------------------------------------------------

describe('sittingsOf / focusGamesSince', () => {
  it('cuts sittings on a gap over 90 minutes', () => {
    expect(sittingsOf([game(0), game(90), game(181)]).map((s) => s.length)).toEqual([2, 1]);
  });

  it('counts only the games the target was worked on (AC11)', () => {
    const gs: GameRecord[] = [];
    for (let i = 0; i < 40; i++) gs.push(game(i * 20, i < 12 ? { focusTargetIds: ['a'], grades: { a: 'hit' } } : { grades: { b: 'hit' } }));
    expect(focusGamesSince(gs, 'a', T0)).toBe(12);
    expect(focusGamesSince(gs, 'b', T0)).toBe(28);
  });
});

// ---- review fixes ------------------------------------------------------------------

describe('review fixes (#321)', () => {
  it('a Notion-import-only review is not a focus choice', () => {
    const notion = game(0, { grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'hit' } });
    const g = game(15);
    const checkIns: SessionCheckIn[] = [{ at: T0 - MIN, mood: 'calm', focusTargetIds: ['b'] }];
    expect(focusPreselection([notion, g], g, 'sitting', checkIns, new Set(['a', 'b']))).toEqual(['b']);
  });

  it('auto practice focus ignores measured-only target sets', () => {
    expect(practiceFocusOn({ practiceFocus: 'auto' }, [{ isActive: true, mode: 'measured' }])).toBe(false);
    expect(practiceFocusOn({ practiceFocus: 'auto' }, [{ isActive: true, mode: 'self' }])).toBe(true);
  });
});
