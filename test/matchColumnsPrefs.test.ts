import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Matches-list per-field display prefs (`matchColumns`, issue #68): the
 * grades-oriented keys (performance / measuredGrades / flags) exist with a
 * `hidden` default, and a stored pref written before they existed still reads
 * safely — missing keys merge from `MATCH_COLUMNS_DEFAULT`. `prefs.ts` is
 * DOM-free (only `localStorage`), so it runs under the node vitest environment
 * with the same polyfill + fresh-import pattern as `filterMigration.test.ts`.
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

describe('prefs.ts — matchColumns defaults and merge (issue #68)', () => {
  it('MATCH_COLUMNS_DEFAULT keeps the six legacy defaults and adds the three grades fields as hidden', async () => {
    const { MATCH_COLUMNS_DEFAULT } = await import('../renderer/src/prefs');
    expect(MATCH_COLUMNS_DEFAULT).toEqual({
      heroes: 'inline', account: 'inline', srDelta: 'inline',
      role: 'hidden', duration: 'hidden', finalScore: 'hidden',
      performance: 'hidden', measuredGrades: 'hidden', flags: 'hidden',
    });
  });

  it('a stored pref from before the new keys existed reads them as hidden and keeps the stored six intact', async () => {
    // Exactly what an existing user's localStorage holds: six keys, no more.
    localStorage.setItem('vantagePref.matchColumns', JSON.stringify({
      role: 'column', heroes: 'hidden', account: 'inline',
      srDelta: 'inline', duration: 'inline', finalScore: 'column',
    }));
    const { prefs } = await import('../renderer/src/prefs');
    const columns = prefs.get('matchColumns')!;
    expect(columns.role).toBe('column');
    expect(columns.heroes).toBe('hidden');
    expect(columns.finalScore).toBe('column');
    expect(columns.performance).toBe('hidden');
    expect(columns.measuredGrades).toBe('hidden');
    expect(columns.flags).toBe('hidden');
  });

  it('a stored mode for a new key round-trips through set/get', async () => {
    const { prefs, MATCH_COLUMNS_DEFAULT } = await import('../renderer/src/prefs');
    prefs.set('matchColumns', { ...MATCH_COLUMNS_DEFAULT, flags: 'inline', performance: 'column' });
    const columns = prefs.get('matchColumns')!;
    expect(columns.flags).toBe('inline');
    expect(columns.performance).toBe('column');
    expect(columns.measuredGrades).toBe('hidden');
  });
});
