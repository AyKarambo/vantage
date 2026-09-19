/**
 * The text-size zoom factor (W7): shared bounds + clamp so main (persisting +
 * applying `webContents.setZoomFactor`), the renderer's shortcut cache
 * (`renderer/src/zoom.ts`), and the browser preview harness can't drift on
 * what "in range" means. Pure — no Electron/DOM.
 */

/** 90%. */
export const ZOOM_MIN = 0.9;
/** 130%. */
export const ZOOM_MAX = 1.3;
/** 100% — the unset/reset value. */
export const ZOOM_DEFAULT = 1;

/** Clamp to [{@link ZOOM_MIN}, {@link ZOOM_MAX}], rounded to 2 decimals (whole percentage points). */
export function clampZoom(factor: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor)) * 100) / 100;
}
