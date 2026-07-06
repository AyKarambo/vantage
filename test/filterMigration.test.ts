import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Renderer filter-bar rework (W3-D1 / spec D1-D4): persisted-filter migration
 * (`store.ts`) and preset/log-prefill migration (`prefs.ts`). These modules
 * are DOM-free (only `localStorage`), so — unlike `view.ts`/`log-match.ts`,
 * which pull in `dom.ts` and touch `document` at import time — they can be
 * exercised directly under the node vitest environment with a tiny
 * `localStorage` polyfill, following this repo's existing `vi.resetModules()`
 * + fresh-import pattern (see `appsettings.test.ts`).
 */

/** Minimal synchronous localStorage polyfill — Node has no global localStorage. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}

beforeEach(() => {
  vi.resetModules();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

afterEach(() => {
  delete (globalThis as { localStorage?: MemoryStorage }).localStorage;
  vi.restoreAllMocks();
});

describe('store.ts — persisted vantageFilters migration (spec D1/D2)', () => {
  it('FILTER_DEFAULTS has no mode key', async () => {
    const { FILTER_DEFAULTS } = await import('../renderer/src/store');
    expect(FILTER_DEFAULTS).toEqual({ account: 'all', role: 'all', days: 30 });
    expect('mode' in FILTER_DEFAULTS).toBe(false);
  });

  it('a persisted mode + legacy "season" sentinel: mode is dropped, "season" maps to the current named season, no crash', async () => {
    localStorage.setItem('vantageFilters', JSON.stringify({ mode: 'Quick Play', days: 'season', role: 'tank' }));
    const { store } = await import('../renderer/src/store');
    const { currentSeasonWindow } = await import('../src/core/season');

    const filters = store.get().filters;
    expect((filters as Record<string, unknown>).mode).toBeUndefined();
    expect(filters.role).toBe('tank');
    expect(filters.days).toEqual({ season: currentSeasonWindow(Date.now()).id });
  });

  it('a clean persisted filter set loads unchanged (mode absent, days a plain number)', async () => {
    localStorage.setItem('vantageFilters', JSON.stringify({ role: 'support', days: 7 }));
    const { store } = await import('../renderer/src/store');
    expect(store.get().filters).toEqual({ account: 'all', role: 'support', days: 7 });
  });

  it('an unparsable/missing persisted value falls back to FILTER_DEFAULTS without throwing', async () => {
    localStorage.setItem('vantageFilters', '{not json');
    const { store, FILTER_DEFAULTS } = await import('../renderer/src/store');
    expect(store.get().filters).toEqual(FILTER_DEFAULTS);
  });

  it('reconciles an unlistable persisted season id to the default 30-day window on the first payload', async () => {
    localStorage.setItem('vantageFilters', JSON.stringify({ days: { season: 'S:2020-01-01' } }));
    vi.doMock('../renderer/src/bridge', () => ({
      bridge: {
        getDashboard: vi.fn().mockResolvedValue({
          isSample: false, generatedAt: Date.now(), overall: { games: 0 },
          filters: { account: 'all', role: 'all', days: { season: 'S:2020-01-01' } },
          options: { accounts: [], roles: [], seasons: [{ id: 'S:2026-06-16', label: '2026 Season 3' }] },
        }),
      },
    }));
    const { store, FILTER_DEFAULTS } = await import('../renderer/src/store');
    await store.refresh();

    expect(store.get().filters.days).toBe(FILTER_DEFAULTS.days);
    // Persisted too, so a reload doesn't need to re-reconcile.
    const persisted = JSON.parse(localStorage.getItem('vantageFilters') ?? '{}');
    expect(persisted.days).toBe(30);
  });

  it('leaves a listed season id untouched on the first payload', async () => {
    localStorage.setItem('vantageFilters', JSON.stringify({ days: { season: 'S:2026-06-16' } }));
    vi.doMock('../renderer/src/bridge', () => ({
      bridge: {
        getDashboard: vi.fn().mockResolvedValue({
          isSample: false, generatedAt: Date.now(), overall: { games: 0 },
          filters: { account: 'all', role: 'all', days: { season: 'S:2026-06-16' } },
          options: { accounts: [], roles: [], seasons: [{ id: 'S:2026-06-16', label: '2026 Season 3' }] },
        }),
      },
    }));
    const { store } = await import('../renderer/src/store');
    await store.refresh();

    expect(store.get().filters.days).toEqual({ season: 'S:2026-06-16' });
  });

  it('does not re-reconcile on a later (non-cold) refresh', async () => {
    vi.doMock('../renderer/src/bridge', () => ({
      bridge: {
        getDashboard: vi.fn().mockResolvedValue({
          isSample: false, generatedAt: Date.now(), overall: { games: 0 },
          filters: { account: 'all', role: 'all', days: 30 },
          options: { accounts: [], roles: [], seasons: [{ id: 'S:2026-06-16', label: '2026 Season 3' }] },
        }),
      },
    }));
    const { store } = await import('../renderer/src/store');
    await store.refresh(); // cold — establishes data

    // Now the user picks a season that (for whatever reason) isn't in a later
    // payload's list; a background refresh must not silently override the
    // filter the user just chose out from under them.
    store.setFilters({ days: { season: 'S:2099-01-01' } });
    await Promise.resolve();
    expect(store.get().filters.days).toEqual({ season: 'S:2099-01-01' });
  });
});

describe('prefs.ts — filter preset + log-prefill migration (spec D4)', () => {
  it('MATCH_COLUMNS_DEFAULT covers every MatchColumnKey (F\'s PrefsShape additions land here too)', async () => {
    const { MATCH_COLUMNS_DEFAULT } = await import('../renderer/src/prefs');
    const keys: Array<keyof typeof MATCH_COLUMNS_DEFAULT> = ['role', 'heroes', 'account', 'srDelta', 'duration', 'finalScore'];
    for (const k of keys) expect(MATCH_COLUMNS_DEFAULT[k]).toMatch(/^(hidden|inline|column)$/);
  });

  it('prefs.get("matchColumns") merges a partial stored value over the defaults', async () => {
    localStorage.setItem('vantagePref.matchColumns', JSON.stringify({ role: 'column' }));
    const { prefs, MATCH_COLUMNS_DEFAULT } = await import('../renderer/src/prefs');
    expect(prefs.get('matchColumns')).toEqual({ ...MATCH_COLUMNS_DEFAULT, role: 'column' });
  });

  it('an old preset with mode+account applies role+days only: account is absent, mode is gone', async () => {
    localStorage.setItem('vantagePref.filterPresets', JSON.stringify([
      { name: 'Grind', filters: { mode: 'Competitive', account: 'Smurf', role: 'damage', days: 7 } },
    ]));
    const { prefs } = await import('../renderer/src/prefs');
    const presets = prefs.get('filterPresets')!;

    expect(presets).toHaveLength(1);
    expect(presets[0].filters).toEqual({ role: 'damage', days: 7 });
    expect('mode' in presets[0].filters).toBe(false);
    expect('account' in presets[0].filters).toBe(false);
  });

  it('rewrites the migrated preset to storage immediately (no mode/account left lingering)', async () => {
    localStorage.setItem('vantagePref.filterPresets', JSON.stringify([
      { name: 'Grind', filters: { mode: 'Competitive', account: 'Smurf', role: 'damage', days: 7 } },
    ]));
    const { prefs } = await import('../renderer/src/prefs');
    prefs.get('filterPresets'); // triggers the eager rewrite

    const raw = JSON.parse(localStorage.getItem('vantagePref.filterPresets')!);
    expect(raw[0].filters).toEqual({ role: 'damage', days: 7 });
  });

  it('a preset already in the new shape round-trips without rewriting storage', async () => {
    const clean = [{ name: 'Grind', filters: { role: 'damage', days: 7 } }];
    localStorage.setItem('vantagePref.filterPresets', JSON.stringify(clean));
    const { prefs } = await import('../renderer/src/prefs');
    expect(prefs.get('filterPresets')).toEqual(clean);
  });

  it('LogPrefillPref has no mode field', async () => {
    localStorage.setItem('vantagePref.logPrefill', JSON.stringify({ role: 'tank', account: 'Main' }));
    const { prefs } = await import('../renderer/src/prefs');
    const prefill = prefs.get('logPrefill');
    expect(prefill).toEqual({ role: 'tank', account: 'Main' });
    expect((prefill as Record<string, unknown>).mode).toBeUndefined();
  });
});
