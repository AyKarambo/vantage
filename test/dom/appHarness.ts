/**
 * Mounts the real renderer shell in happy-dom over the real data layer — the
 * typed provider harness (real stores in memory) behind the dashboard handler
 * table, exactly as the browser preview wires it — and records every bridge
 * call, so a test can drive the UI by its DOM and pin what it sends.
 *
 * Characterization, not specification: these tests pin what the renderer does
 * TODAY, so a refactor that changes a payload or a navigation outcome fails.
 * Mount one app per test file (vitest isolates files); a second App in the
 * same document would double up the shell's document-level key handlers.
 */
import { vi } from 'vitest';
import type { OwStatsApi } from '../../src/shared/contract';
import { defaultConfig, type AppConfig } from '../../src/main/config/schema';
import type { GameRecord } from '../../src/core/analytics';
import { generateSampleGames } from '../../src/core/sampleData';
import { dashboardHandlers, type DashboardInvokers } from '../../src/main/dashboard/handlers';
import { providerHarness } from '../providerFixtures';

/** 2026-09-21 18:00 UTC — the same instant the visual regression run pins. */
export const NOW = Date.UTC(2026, 8, 21, 18, 0, 0);

export interface BridgeCall {
  method: string;
  args: unknown[];
}

export interface MountOptions {
  /** History to start from; defaults to a seeded 60-game sample season. */
  games?: GameRecord[];
  config?: Partial<AppConfig>;
}

export async function mountApp(opts: MountOptions = {}) {
  // Only Date is faked: the app's own setTimeout / rAF scheduling stays real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  const games = opts.games ?? generateSampleGames(60, 42);
  const accounts = Object.fromEntries([...new Set(games.map((g) => g.account))].map((n) => [`${n}#0000`, n]));
  const harness = providerHarness({
    games,
    config: {
      accounts,
      ...opts.config,
      // Real history, the tour already seen, this version's notes already read:
      // no first-run modal stands between the test and the screen.
      ui: { ...defaultConfig().ui, demoPreference: 'off', lastSeenVersion: 'test', ...opts.config?.ui },
    },
  });
  localStorage.setItem('vantageOnboarded', '1');

  const calls: BridgeCall[] = [];
  const handlers = dashboardHandlers(harness.provider) as unknown as Record<string, (...args: unknown[]) => unknown>;
  // Structured clone both ways, like IPC: the renderer never holds a live
  // reference into the stores, and a recorded payload is what crossed the wire.
  const invokers = Object.fromEntries(
    Object.entries(handlers).map(([method, handle]) => [
      method,
      async (...args: unknown[]) => {
        calls.push({ method, args: structuredClone(args) });
        return structuredClone(await handle(...structuredClone(args)));
      },
    ]),
  ) as unknown as DashboardInvokers;
  const off = () => () => {};
  const bridge: OwStatsApi = {
    ...invokers,
    onLogEntry: off,
    onGepStatus: off,
    onDevModeAuthStatus: off,
    onSyncProgress: off,
    onGameLogged: off,
    onPendingChanged: off,
    onLiveMatch: off,
    onDataChanged: off,
    window: { minimize: () => {}, toggleMaximize: () => {}, close: () => {} },
  };
  window.owstats = bridge;

  document.body.innerHTML = '<div id="app"></div>';
  const { App } = await import('../../renderer/src/app/shell');
  const { store } = await import('../../renderer/src/store');
  new App(document.querySelector<HTMLElement>('#app')!);
  await until(() => document.querySelector('.view .card, .view .empty, .view h1'));

  return {
    ...harness,
    games,
    calls,
    store,
    /** The recorded calls to one bridge method, in order. */
    callsTo: (method: string): unknown[][] => calls.filter((c) => c.method === method).map((c) => c.args),
  };
}

export type MountedApp = Awaited<ReturnType<typeof mountApp>>;

/** Poll until `probe` returns something truthy (real timers), or fail after `timeoutMs`. */
export async function until<T>(probe: () => T | null | undefined | false, timeoutMs = 3000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const hit = probe();
    if (hit) return hit;
    if (performance.now() - start > timeoutMs) throw new Error(`until: timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Let pending promise chains and a frame or two run. */
export async function flush(ms = 30): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// --- DOM driving ---------------------------------------------------------------

export function $(selector: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

/** The first `selector` element whose trimmed text is (or, with `contains`, includes) `text`. */
export function byText(selector: string, text: string, root: ParentNode = document, contains = false): HTMLElement {
  const el = [...root.querySelectorAll<HTMLElement>(selector)]
    .find((e) => (contains ? (e.textContent ?? '').includes(text) : (e.textContent ?? '').trim() === text));
  if (!el) throw new Error(`no ${selector} with text "${text}"`);
  return el;
}

export function click(el: HTMLElement): void {
  el.click();
}

/** Type into an input the way a player does: set the value, then fire input + change. */
export function type(el: HTMLElement, value: string): void {
  const input = el as HTMLInputElement;
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function key(target: EventTarget, keyName: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init }));
}

/** Click a sidebar item by its label. */
export function nav(label: string): void {
  const item = [...document.querySelectorAll<HTMLElement>('.nav-item')]
    .find((n) => n.querySelector('.nav-label')?.textContent?.trim() === label);
  if (!item) throw new Error(`no sidebar item "${label}"`);
  item.click();
}

/** The open modal panel, if any. */
export function modal(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.modal-card');
}
