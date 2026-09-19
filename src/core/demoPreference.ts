/**
 * The user's first-run demo-data choice. `'unset'` means they have not been
 * asked yet (triggers the first-run prompt); `'on'`/`'off'` are their answer.
 * Pure and Electron-free so both the main-process config and the IPC contract
 * can share one definition (mirrors how BreakReminderSettings is shared).
 */
export type DemoPreference = 'unset' | 'on' | 'off';

/**
 * The demo facts the dashboard view-model needs, computed once at the main-process
 * edge so `active` is never re-derived (and can never drift from the badge).
 */
export interface DemoContext {
  /** Effective demo display (see {@link effectiveDemo}). */
  active: boolean;
  /** The raw first-run choice, surfaced so the renderer can show the prompt. */
  preference: DemoPreference;
  /** Whether real tracked matches exist (independent of the sample season). */
  hasRealHistory: boolean;
}

/**
 * Whether sample/demo data is actually shown. Demo yields to real data: it is
 * displayed only when the user opted in AND has no real tracked history, so the
 * moment they log a real match the demo season retires automatically.
 */
export function effectiveDemo(pref: DemoPreference, historyCount: number): boolean {
  return pref === 'on' && historyCount === 0;
}

/**
 * Whether `isSample` just flipped between two consecutive reads (F2) — drives
 * the one-time "your first tracked game is in" announcement (`'demo-retired'`)
 * and its silent-by-design reverse (`'demo-restored'`, already handled by
 * `matchActions.ts`'s delete-toast). `prev` is `undefined` for the very first
 * observation (nothing to compare against yet), which never counts as either.
 */
export type DemoTransition = 'demo-retired' | 'demo-restored' | null;

export function demoTransition(prevIsSample: boolean | undefined, nextIsSample: boolean): DemoTransition {
  if (prevIsSample === undefined) return null;
  if (prevIsSample && !nextIsSample) return 'demo-retired';
  if (!prevIsSample && nextIsSample) return 'demo-restored';
  return null;
}
