import { describe, it, expect } from 'vitest';
import { fitBounds, type SavedBounds, type Rect } from '../src/main/dashboard/windowBounds';

const SPEC = { width: 1300, height: 840, minWidth: 960, minHeight: 640 };

/** A generous 1080p-ish work area (taskbar already excluded), origin at (0,0) unless overridden. */
function workArea(over: Partial<Rect> = {}): Rect {
  return { x: 0, y: 0, width: 1920, height: 1040, ...over };
}

function saved(over: Partial<SavedBounds> = {}): SavedBounds {
  return { x: 100, y: 100, width: 1300, height: 840, maximized: false, ...over };
}

describe('fitBounds — work area too small for the minimums', () => {
  it('returns maximize:true and the floor size when the work area is narrower than minWidth', () => {
    const r = fitBounds(undefined, workArea({ width: 800, height: 1040 }), SPEC);
    expect(r.maximize).toBe(true);
    expect(r.width).toBe(SPEC.minWidth);
    expect(r.height).toBe(SPEC.minHeight);
  });

  it('returns maximize:true when the work area is shorter than minHeight', () => {
    const r = fitBounds(undefined, workArea({ width: 1920, height: 500 }), SPEC);
    expect(r.maximize).toBe(true);
  });

  it('anchors the fallback rect at the work area origin, even off (0,0)', () => {
    const r = fitBounds(undefined, workArea({ x: 200, y: 50, width: 800, height: 1040 }), SPEC);
    expect(r.x).toBe(200);
    expect(r.y).toBe(50);
  });
});

describe('fitBounds — no saved bounds (first launch)', () => {
  it('uses the spec default size and centers it in a generous work area', () => {
    const r = fitBounds(undefined, workArea(), SPEC);
    expect(r).toMatchObject({ width: SPEC.width, height: SPEC.height, maximize: false });
    expect(r.x).toBe(Math.round((1920 - SPEC.width) / 2));
    expect(r.y).toBe(Math.round((1040 - SPEC.height) / 2));
  });

  it('clamps the default size down to a work area smaller than the default but still above the minimums', () => {
    const r = fitBounds(undefined, workArea({ width: 1100, height: 700 }), SPEC);
    expect(r.width).toBe(1100);
    expect(r.height).toBe(700);
    expect(r.maximize).toBe(false);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });
});

describe('fitBounds — saved bounds, everything fits', () => {
  it('keeps the saved size and position unchanged inside a generous work area', () => {
    const s = saved({ x: 300, y: 100, width: 1400, height: 900 });
    const r = fitBounds(s, workArea(), SPEC);
    expect(r).toEqual({ x: 300, y: 100, width: 1400, height: 900, maximize: false });
  });
});

describe('fitBounds — saved bounds needing clamping (OS scaling / a smaller display)', () => {
  it('shrinks an oversized saved size down to the work area, never below the minimums', () => {
    // Saved on a big display; now on a 1366x768-ish one.
    const s = saved({ x: 50, y: 50, width: 1800, height: 1100 });
    const r = fitBounds(s, workArea({ width: 1366, height: 728 }), SPEC);
    expect(r.width).toBe(1366);
    expect(r.height).toBe(728);
    expect(r.maximize).toBe(false);
  });

  it('never reports a size below minWidth/minHeight even when the saved size was smaller', () => {
    const s = saved({ width: 700, height: 500 });
    const r = fitBounds(s, workArea(), SPEC);
    expect(r.width).toBe(SPEC.minWidth);
    expect(r.height).toBe(SPEC.minHeight);
  });

  it('shifts (never re-centers) a saved position that would spill past the right/bottom edge', () => {
    const s = saved({ x: 1800, y: 1000, width: 1300, height: 840 });
    const r = fitBounds(s, workArea(), SPEC);
    // Pulled back just far enough to fit fully inside the work area.
    expect(r.x).toBe(1920 - 1300);
    expect(r.y).toBe(1040 - 840);
  });

  it('shifts a saved position that is off-screen to the left/top (e.g. undocked from a second monitor)', () => {
    const s = saved({ x: -500, y: -300, width: 1300, height: 840 });
    const r = fitBounds(s, workArea(), SPEC);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('handles a work-area origin that is not (0,0), e.g. a secondary monitor to the left', () => {
    const s = saved({ x: -3000, y: 100, width: 1300, height: 840 }); // stranded off the (now-gone) left monitor
    const r = fitBounds(s, workArea({ x: -1920, y: 0, width: 1920, height: 1040 }), SPEC);
    expect(r.x).toBeGreaterThanOrEqual(-1920);
    expect(r.x + r.width).toBeLessThanOrEqual(-1920 + 1920);
  });
});

describe('fitBounds — saved bounds with maximized:true', () => {
  it('returns maximize:true regardless of the saved size/position', () => {
    const s = saved({ x: 9999, y: 9999, width: 50, height: 50, maximized: true });
    const r = fitBounds(s, workArea(), SPEC);
    expect(r.maximize).toBe(true);
  });
});
