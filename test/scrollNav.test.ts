import { describe, it, expect } from 'vitest';
import {
  PAGE_OVERLAP,
  isUpwardAction,
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
  // A non-scrolling host (Heroes/Logs: .content fits, the inner element scrolls).
  const snugHost = { scrollHeight: 600, clientHeight: 600, name: 'host' };

  it('prefers an overflowing inner scroller over a host that cannot scroll', () => {
    const table = { scrollHeight: 2000, clientHeight: 500, name: 'table' };
    expect(pickScroller([table], snugHost)).toBe(table);
  });

  it('picks the inner candidate with the most scrollable content', () => {
    const shortTable = { scrollHeight: 600, clientHeight: 500, name: 'short' };
    const logs = { scrollHeight: 9000, clientHeight: 500, name: 'logs' };
    expect(pickScroller([shortTable, logs], snugHost)).toBe(logs);
  });

  it('the host keeps the keys when it scrolls further than an inner table (chart card toggled to table view)', () => {
    const longHost = { scrollHeight: 3000, clientHeight: 600, name: 'host' };
    const chartTable = { scrollHeight: 850, clientHeight: 700, name: 'chart-table' };
    expect(pickScroller([chartTable], longHost)).toBe(longHost);
  });

  it('an inner scroller dominating a marginally-scrolling host wins (Heroes with a few px of .content overflow)', () => {
    const marginalHost = { scrollHeight: 640, clientHeight: 600, name: 'host' };
    const heroTable = { scrollHeight: 2500, clientHeight: 550, name: 'table' };
    expect(pickScroller([heroTable], marginalHost)).toBe(heroTable);
  });

  it('exactly-fitting or shorter candidates count as non-scrollable', () => {
    const snug = { scrollHeight: 500, clientHeight: 500, name: 'snug' };
    const shorter = { scrollHeight: 300, clientHeight: 500, name: 'shorter' };
    expect(pickScroller([snug, shorter], snugHost)).toBe(snugHost);
  });

  it('falls back to the host when no inner candidate exists', () => {
    expect(pickScroller([], snugHost)).toBe(snugHost);
  });
});

describe('isUpwardAction', () => {
  it('top and page-up move toward the top', () => {
    expect(isUpwardAction('top')).toBe(true);
    expect(isUpwardAction('page-up')).toBe(true);
  });

  it('bottom and page-down do not', () => {
    expect(isUpwardAction('bottom')).toBe(false);
    expect(isUpwardAction('page-down')).toBe(false);
  });
});
