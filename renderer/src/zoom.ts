/**
 * Renderer-side mirror of the main process's text-size zoom factor (W7).
 * `AppUiSettings.uiZoom` is the source of truth (persisted, and what actually
 * drives `webContents.setZoomFactor`); this module just caches the current
 * value so the Ctrl+=/Ctrl+- shortcuts can compute the next step without an
 * async round-trip on every keypress, seeded once at startup the same way
 * devModeAuthStatus.ts/gepStatus.ts seed their own caches.
 */
import { bridge } from './bridge';
import { clampZoom, ZOOM_DEFAULT } from '../../src/core/zoom';

export { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from '../../src/core/zoom';
const ZOOM_STEP = 0.1;

export const ZOOM_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.9, label: '90%' },
  { value: 1, label: '100%' },
  { value: 1.1, label: '110%' },
  { value: 1.25, label: '125%' },
];

let current = ZOOM_DEFAULT;
let started = false;

/** Seed the cache from the persisted setting (idempotent). Call once from the shell. */
export function initZoom(): void {
  if (started) return;
  started = true;
  bridge.getAppSettings().then((s) => { current = s.uiZoom ?? ZOOM_DEFAULT; }).catch(() => {
    /* stays at the default until the next successful read */
  });
}

/** The cached current zoom factor (1 = 100%) — may briefly lag main right after a launch, before initZoom's read lands. */
export const getZoom = (): number => current;

/**
 * Apply a zoom factor: updates the local cache immediately (so a rapid second
 * Ctrl+= reads the right baseline without waiting on the round-trip) and
 * persists + live-applies it through `setAppSettings`.
 */
export function setZoom(factor: number): void {
  current = clampZoom(factor);
  void bridge.setAppSettings({ uiZoom: current });
}

/**
 * Cache-only update, no bridge call — for a caller (the Settings "Text size"
 * select) that already went through its OWN `setAppSettings` round-trip
 * (appBehaviorCard's `apply`, which also repaints the card) and just needs
 * the Ctrl+=/- shortcuts' baseline to stay in sync, without persisting twice.
 */
export function syncZoom(factor: number): void {
  current = clampZoom(factor);
}

export const zoomIn = (): void => setZoom(current + ZOOM_STEP);
export const zoomOut = (): void => setZoom(current - ZOOM_STEP);
export const zoomReset = (): void => setZoom(ZOOM_DEFAULT);
