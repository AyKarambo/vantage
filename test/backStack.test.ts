import { describe, it, expect } from 'vitest';
import {
  ALL_PARAM_KEYS,
  MAX_DEPTH,
  PARAM_KINDS,
  back,
  entryLabel,
  pushEntry,
  resolveEntry,
  routeParams,
  sameEntry,
  sameParams,
  type BackEntry,
  type BackStack,
  type ResolveContext,
  type Resolver,
} from '../renderer/src/backStack';
import type { ViewId, ViewParams } from '../renderer/src/store';

/**
 * The back stack's rules are pure and DOM-free, so they run directly under the
 * node vitest environment (the `scrollNav` pattern). The renderer is not under
 * `src/core/`, so this file is where DoD 3 lands for navigation.
 */

const entry = (view: ViewId, params: ViewParams = {}): BackEntry => ({ view, params });

const resolvesAll: Resolver = () => true;
const resolvesNone: Resolver = () => false;

describe('routeParams / sameParams / sameEntry', () => {
  const full: ViewParams = {
    matchId: 'm1', day: '2026-08-01', flag: 'tilted', playerName: 'Nova#1111', targetId: 't1',
    highlight: 'Ilios', prefillName: 'Aim', editTargetId: 't9',
  };

  it('keeps route params and drops effect params', () => {
    expect(routeParams(full)).toEqual({
      matchId: 'm1', day: '2026-08-01', flag: 'tilted', playerName: 'Nova#1111', targetId: 't1',
    });
  });

  // Keeps routeParams' explicit field copies in step with the PARAM_KINDS table:
  // adding a param and forgetting to copy it (or copying an effect param) fails here.
  it('agrees with PARAM_KINDS for every single key', () => {
    for (const key of ALL_PARAM_KEYS) {
      const kept = routeParams({ [key]: 'x' } as ViewParams);
      expect(Object.keys(kept), `${key} is '${PARAM_KINDS[key]}'`)
        .toEqual(PARAM_KINDS[key] === 'route' ? [key] : []);
    }
  });

  it('returns a fresh object and never mutates its input', () => {
    const out = routeParams(full);
    expect(out).not.toBe(full);
    expect(full.highlight).toBe('Ilios');
  });

  it('sameParams compares by value across identities, and catches every key', () => {
    expect(sameParams({ ...full }, { ...full })).toBe(true);
    for (const key of ALL_PARAM_KEYS) {
      expect(sameParams(full, { ...full, [key]: 'changed' }), key).toBe(false);
    }
  });

  it('sameEntry ignores effect params but distinguishes route params and views', () => {
    expect(sameEntry(entry('targets'), entry('targets', { editTargetId: 't1' }))).toBe(true);
    expect(sameEntry(entry('matches'), entry('matches', { day: '2026-08-01' }))).toBe(false);
    expect(sameEntry(entry('matches'), entry('maps'))).toBe(false);
  });
});

describe('pushEntry', () => {
  it('appends in order without mutating the input', () => {
    const a: BackStack = [entry('overview')];
    const b = pushEntry(a, entry('matches'));
    expect(b.map((e) => e.view)).toEqual(['overview', 'matches']);
    expect(a).toHaveLength(1);
  });

  it('collapses a same-view run to where the run started', () => {
    let stack: BackStack = pushEntry([], entry('matches'));
    for (let i = 0; i < 200; i++) stack = pushEntry(stack, entry('matchDetail', { matchId: `m${i}` }));
    expect(stack).toHaveLength(2);
    expect(stack[1].params.matchId).toBe('m0');
  });

  it('only collapses against the top, so Match -> Player -> Match survives', () => {
    let stack: BackStack = pushEntry([], entry('matches'));
    stack = pushEntry(stack, entry('matchDetail', { matchId: 'A' }));
    stack = pushEntry(stack, entry('playerHistory', { playerName: 'P' }));
    stack = pushEntry(stack, entry('matchDetail', { matchId: 'B' }));
    expect(stack.map((e) => e.view)).toEqual(['matches', 'matchDetail', 'playerHistory', 'matchDetail']);
  });

  it('caps at MAX_DEPTH by dropping the oldest', () => {
    let stack: BackStack = [];
    for (let i = 0; i < MAX_DEPTH + 5; i++) {
      // Alternate views so nothing collapses.
      stack = pushEntry(stack, entry(i % 2 ? 'matches' : 'maps', { day: `d${i}` }));
    }
    expect(stack).toHaveLength(MAX_DEPTH);
    expect(stack[0].params.day).toBe('d5');
  });
});

describe('back', () => {
  it('pops the newest entry and returns the remainder', () => {
    const stack: BackStack = [entry('overview'), entry('matches')];
    const r = back(stack, entry('matchDetail', { matchId: 'm1' }), resolvesAll);
    expect(r.entry).toEqual(entry('matches'));
    expect(r.stack.map((e) => e.view)).toEqual(['overview']);
  });

  it('skips unresolvable entries and consumes them', () => {
    const stack: BackStack = [entry('matches'), entry('matchDetail', { matchId: 'gone' })];
    const resolver: Resolver = (e) => e.params.matchId !== 'gone';
    const r = back(stack, entry('playerHistory', { playerName: 'P' }), resolver);
    expect(r.entry).toEqual(entry('matches'));
    expect(r.stack).toHaveLength(0);
  });

  it('skips an entry equal to where we already stand', () => {
    const stack: BackStack = [entry('overview'), entry('targets')];
    const r = back(stack, entry('targets'), resolvesAll);
    expect(r.entry).toEqual(entry('overview'));
  });

  it('returns the ORIGINAL stack by reference on a total miss', () => {
    const stack: BackStack = [entry('matchDetail', { matchId: 'a' })];
    const r = back(stack, entry('matches'), resolvesNone);
    expect(r.entry).toBeNull();
    // Non-destructive: a 12s Undo can revive those entries.
    expect(r.stack).toBe(stack);
  });

  it('reports nothing to go back to on an empty stack', () => {
    const r = back([], entry('overview'), resolvesAll);
    expect(r.entry).toBeNull();
    expect(r.stack).toHaveLength(0);
  });

  it('never mutates the stack it is given', () => {
    const stack: BackStack = [entry('overview'), entry('matches')];
    back(stack, entry('maps'), resolvesAll);
    expect(stack).toHaveLength(2);
  });
});

describe('resolveEntry', () => {
  const ctx = (over: Partial<ResolveContext> = {}): ResolveContext =>
    ({ targets: null, deletedMatchIds: new Set(), ...over });

  it('treats a match as gone only on positive evidence of deletion', () => {
    const e = entry('matchDetail', { matchId: 'm1' });
    expect(resolveEntry(e, ctx())).toBe(true);
    expect(resolveEntry(e, ctx({ deletedMatchIds: new Set(['m1']) }))).toBe(false);
  });

  it('still resolves a match the current filters exclude', () => {
    // The regression this predicate exists to prevent: filtering is not deleting.
    // There is deliberately no snapshot input here to consult.
    expect(resolveEntry(entry('matchDetail', { matchId: 'june' }), ctx())).toBe(true);
  });

  it('resolves a live target, and refuses a missing or archived one', () => {
    const targets = [{ id: 't1' }, { id: 't2', archivedAt: 1_700_000_000_000 }];
    expect(resolveEntry(entry('targetDetail', { targetId: 't1' }), ctx({ targets }))).toBe(true);
    expect(resolveEntry(entry('targetDetail', { targetId: 't2' }), ctx({ targets }))).toBe(false);
    expect(resolveEntry(entry('targetDetail', { targetId: 'nope' }), ctx({ targets }))).toBe(false);
  });

  it('never skips on ignorance — before the first snapshot everything resolves', () => {
    expect(resolveEntry(entry('targetDetail', { targetId: 't1' }), ctx({ targets: null }))).toBe(true);
  });

  it('always resolves non-parameterized screens and the player drill-down', () => {
    expect(resolveEntry(entry('overview'), ctx())).toBe(true);
    expect(resolveEntry(entry('matches', { day: '2026-08-01' }), ctx())).toBe(true);
    expect(resolveEntry(entry('playerHistory', { playerName: 'Ghost#1' }), ctx())).toBe(true);
  });
});

describe('entryLabel', () => {
  it('names the player for a player drill-down', () => {
    expect(entryLabel(entry('playerHistory', { playerName: 'Nova#1111' }))).toBe('Nova#1111');
  });

  it('falls back to the screen title', () => {
    expect(entryLabel(entry('playerHistory'))).toBe('the player');
    expect(entryLabel(entry('matches'))).toBe('Matches');
    expect(entryLabel(entry('matchDetail', { matchId: 'm1' }))).toBe('the match');
  });
});
