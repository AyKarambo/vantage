import { describe, it, expect } from 'vitest';
import {
  PAGE_OVERLAP,
  nextScrollTop,
  pageStep,
  pickScroller,
  type ScrollMetrics,
} from '../renderer/src/scrollNav';

/**
 * The scroll-nav module's decidable logic is pure and DOM-free, so it runs
 * directly under the node vitest environment (same pattern as winrateScheme).
 * Covers the jump/paging math incl. clamping (spec #73 AC1/AC2) and the
 * inner-scroller selection rule (AC3).
 */

const metrics = (scrollTop: number, scrollHeight: number, clientHeight: number): ScrollMetrics =>
  ({ scrollTop, scrollHeight, clientHeight });

describe('pageStep', () => {
  it('travels one viewport minus the overlap', () => {
    expect(pageStep(600)).toBe(600 - PAGE_OVERLAP);
  });

  it('falls back to half a viewport for tiny panes (never a degenerate step)', () => {
    expect(pageStep(60)).toBe(30);
    expect(pageStep(PAGE_OVERLAP)).toBe(PAGE_OVERLAP / 2);
    // Half-viewport rounds up so an odd 1px pane still moves.
    expect(pageStep(1)).toBe(1);
  });
});

describe('nextScrollTop', () => {
  it('top jumps to 0 regardless of the current position', () => {
    expect(nextScrollTop('top', metrics(4321, 5000, 600))).toBe(0);
    expect(nextScrollTop('top', metrics(0, 5000, 600))).toBe(0);
  });

  it('bottom jumps to the maximum scrollable offset', () => {
    expect(nextScrollTop('bottom', metrics(0, 5000, 600))).toBe(4400);
    expect(nextScrollTop('bottom', metrics(4400, 5000, 600))).toBe(4400);
  });

  it('page-down advances by one page step and clamps at the end', () => {
    expect(nextScrollTop('page-down', metrics(0, 5000, 600))).toBe(560);
    expect(nextScrollTop('page-down', metrics(4000, 5000, 600))).toBe(4400);
    expect(nextScrollTop('page-down', metrics(4400, 5000, 600))).toBe(4400);
  });

  it('page-up retreats by one page step and clamps at the top', () => {
    expect(nextScrollTop('page-up', metrics(1000, 5000, 600))).toBe(440);
    expect(nextScrollTop('page-up', metrics(100, 5000, 600))).toBe(0);
    expect(nextScrollTop('page-up', metrics(0, 5000, 600))).toBe(0);
  });

  it('content shorter than the viewport pins every action to 0', () => {
    const short = metrics(0, 300, 600);
    for (const action of ['top', 'bottom', 'page-up', 'page-down'] as const) {
      expect(nextScrollTop(action, short)).toBe(0);
    }
  });
});

describe('pickScroller', () => {
  const host = { scrollHeight: 3000, clientHeight: 600, name: 'host' };

  it('prefers the first inner candidate that actually overflows', () => {
    const table = { scrollHeight: 2000, clientHeight: 500, name: 'table' };
    expect(pickScroller([table], host)).toBe(table);
  });

  it('skips inner candidates that do not overflow (short capped table)', () => {
    const shortTable = { scrollHeight: 400, clientHeight: 500, name: 'short' };
    const logs = { scrollHeight: 9000, clientHeight: 500, name: 'logs' };
    expect(pickScroller([shortTable, logs], host)).toBe(logs);
  });

  it('exactly-fitting candidates count as non-scrollable', () => {
    const snug = { scrollHeight: 500, clientHeight: 500, name: 'snug' };
    expect(pickScroller([snug], host)).toBe(host);
  });

  it('falls back to the host when no inner candidate exists', () => {
    expect(pickScroller([], host)).toBe(host);
  });
});
