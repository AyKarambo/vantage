/**
 * Pure window-bounds fitting (W7) — no Electron. `dashboardWindow.ts` supplies
 * the live `screen.getPrimaryDisplay().workArea` / `screen.getDisplayMatching(...)`
 * rect; this just does the rect math, so it's unit-testable without a real
 * display and can't silently drift between the first-launch and restore paths
 * (both go through the same function).
 */

/** A window's saved placement (subset {@link ../config WindowBounds} needs here). */
export interface SavedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** A rectangle — a display's usable work area (screen minus taskbar), or a window's own bounds. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The window's default size + absolute floor. */
export interface WindowSpec {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/** What `open()` should actually create the `BrowserWindow` with. */
export interface FittedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * True when the caller should call `win.maximize()` instead of trusting
   * x/y/width/height as a normal (restored) window — either the saved state
   * was itself maximized, or the work area is too small to fit even the
   * minimums (a small or heavily-scaled display), in which case width/height
   * here are just the floor, not a meaningful placement.
   */
  maximize: boolean;
}

/**
 * Fit a window into `workArea`, honest about three cases in one place instead
 * of three call sites that could drift:
 *
 * - **Work area smaller than the minimums** (a small or heavily-scaled
 *   display): `maximize: true` — trying to place a "normal" window here would
 *   either violate the floor or overflow the screen, so maximizing is the
 *   only real fit.
 * - **No saved bounds** (first launch): the spec's preferred size, clamped
 *   down to the work area when it's smaller, centered within it.
 * - **Saved bounds** (a relaunch): the saved size, clamped to [min, work
 *   area] so a size saved on a bigger display never overflows a smaller one,
 *   with x/y shifted (not re-centered — the user's own placement is kept
 *   where possible) to land fully inside the work area — handles OS display
 *   scaling and undocking from a second monitor, where the old bounds could
 *   otherwise land off-screen or overlapping the taskbar.
 */
export function fitBounds(saved: SavedBounds | undefined, workArea: Rect, spec: WindowSpec): FittedBounds {
  if (workArea.width < spec.minWidth || workArea.height < spec.minHeight) {
    return { x: workArea.x, y: workArea.y, width: spec.minWidth, height: spec.minHeight, maximize: true };
  }
  if (saved?.maximized) {
    // The exact rect barely matters once maximize() runs, but still needs to
    // be a valid, on-screen rect for the brief moment before that happens.
    return { x: workArea.x, y: workArea.y, width: spec.minWidth, height: spec.minHeight, maximize: true };
  }

  const width = Math.min(workArea.width, Math.max(spec.minWidth, saved?.width ?? spec.width));
  const height = Math.min(workArea.height, Math.max(spec.minHeight, saved?.height ?? spec.height));

  let x: number;
  let y: number;
  if (saved) {
    // Shift (never re-center) so a deliberate placement survives a restore —
    // only clamped in when it would otherwise land outside the work area.
    x = Math.min(Math.max(saved.x, workArea.x), workArea.x + workArea.width - width);
    y = Math.min(Math.max(saved.y, workArea.y), workArea.y + workArea.height - height);
  } else {
    x = workArea.x + Math.round((workArea.width - width) / 2);
    y = workArea.y + Math.round((workArea.height - height) / 2);
  }

  return { x, y, width, height, maximize: false };
}
