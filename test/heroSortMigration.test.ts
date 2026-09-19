import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `heroSort`'s one-time direction-inversion migration (K1): a value persisted
 * before the dataTable comparator fix means the opposite of what `dir` says
 * today, so the first read after upgrading must invert it once — and never
 * again, so a fresh choice made after upgrading isn't flipped right back.
 * Same node-environment + localStorage-polyfill pattern as
 * matchColumnsPrefs.test.ts (prefs.ts is DOM-free).
 */

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

describe('prefs.ts — heroSort migration (K1)', () => {
  it('inverts a pre-fix persisted value on first read', async () => {
    localStorage.setItem('vantagePref.heroSort', JSON.stringify({ key: 'games', dir: -1 }));
    const { prefs } = await import('../renderer/src/prefs');
    expect(prefs.get('heroSort')).toEqual({ key: 'games', dir: 1 });
  });

  it('persists the inversion so it does not flip again on a later read', async () => {
    localStorage.setItem('vantagePref.heroSort', JSON.stringify({ key: 'games', dir: -1 }));
    const { prefs } = await import('../renderer/src/prefs');
    prefs.get('heroSort'); // first read: migrates
    expect(prefs.get('heroSort')).toEqual({ key: 'games', dir: 1 }); // second read: unchanged
    expect(JSON.parse(localStorage.getItem('vantagePref.heroSort')!)).toEqual({ key: 'games', dir: 1 });
  });

  it('does not touch a value the user sets AFTER the migration has already run once', async () => {
    // No stored value at all yet — the very first read (even of nothing) must
    // still arm the migrated flag, or a value set moments later would look
    // "unmigrated" to a subsequent read and get wrongly inverted.
    const { prefs } = await import('../renderer/src/prefs');
    expect(prefs.get('heroSort')).toBeUndefined();
    prefs.set('heroSort', { key: 'winrate', dir: -1 });
    expect(prefs.get('heroSort')).toEqual({ key: 'winrate', dir: -1 });
  });

  it('leaves other prefs keys alone', async () => {
    localStorage.setItem('vantagePref.minGames', JSON.stringify(5));
    const { prefs } = await import('../renderer/src/prefs');
    expect(prefs.get('minGames')).toBe(5);
  });
});
