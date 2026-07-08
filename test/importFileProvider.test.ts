import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import type { GameRecord } from '../src/core/analytics';

/** An import-envelope game row (as the PowerShell script emits). */
function row(matchId: string, over: Record<string, unknown> = {}) {
  return {
    matchId, timestamp: 1_700_000_000_000, account: 'Lampenlicht', role: 'tank',
    map: 'Busan', result: 'Loss', gameType: 'Competitive', source: 'manual', heroes: ['Winston'], ...over,
  };
}

/**
 * In-memory harness: a real `parseVantageImport` runs inside the provider, so we
 * feed it whole envelopes. History dedupes by matchId and is importSource-aware,
 * mirroring the real store's scoped clear/count.
 */
function harness(pick: () => Promise<unknown>, initialAccounts: Record<string, string> = {}) {
  const stored: GameRecord[] = [];
  let accounts = { ...initialAccounts };
  const anchors: Record<string, { account: string; role: string; setAt: number }> = {};
  const set = vi.fn((rec: { account: string; role: string; setAt: number }) => { anchors[`${rec.account}::${rec.role}`] = rec; });
  const seedAnchor = (rec: { account: string; role: string; setAt: number }) => { anchors[`${rec.account}::${rec.role}`] = rec; };
  const clearExports = vi.fn();
  const persistAccounts = vi.fn((a: Record<string, string>) => { accounts = a; });
  const deps = {
    importFile: { pick },
    rankAnchors: { set, get: (account: string, role: string) => anchors[`${account}::${role}`] },
    notion: { clearExports },
    getConfig: () => ({ accounts }),
    persistAccounts,
    history: {
      all: () => [...stored],
      addMany: (gs: GameRecord[]) => {
        let imported = 0;
        for (const g of gs) {
          if (!stored.some((s) => s.matchId === g.matchId)) { stored.push(g); imported++; }
        }
        return { imported, skipped: gs.length - imported };
      },
      removeImported: (source: 'notion' | 'file') => {
        const removed = stored.filter((g) => g.importedAt != null && (g.importSource ?? 'notion') === source);
        for (const r of removed) stored.splice(stored.indexOf(r), 1);
        return removed;
      },
      importedCount: (source: 'notion' | 'file') =>
        stored.filter((g) => g.importedAt != null && (g.importSource ?? 'notion') === source).length,
    },
  } as unknown as DataProviderDeps;
  return { provider: createDataProvider(deps), set, seedAnchor, clearExports, persistAccounts, getStored: () => stored, getAccounts: () => accounts };
}

const envelope = (games: unknown[], extra: Record<string, unknown> = {}) => ({ vantageImport: 1, account: 'Lampenlicht', games, ...extra });

describe('importFromFile — ingest + idempotency (AC7)', () => {
  it('adds every game once and marks them file-imported', async () => {
    const h = harness(async () => envelope([row('a'), row('b')]));
    const res = await h.provider.importFromFile();
    expect(res).toMatchObject({ imported: 2, skipped: 0, invalid: 0 });
    expect(h.getStored().map((g) => g.matchId).sort()).toEqual(['a', 'b']);
    expect(h.getStored().every((g) => g.importSource === 'file' && typeof g.importedAt === 'number')).toBe(true);
  });

  it('re-importing the same file adds nothing (idempotent dedup)', async () => {
    const h = harness(async () => envelope([row('a'), row('b')]));
    await h.provider.importFromFile();
    const res = await h.provider.importFromFile();
    expect(res).toMatchObject({ imported: 0, skipped: 2 });
    expect(h.getStored()).toHaveLength(2);
  });
});

describe('importFromFile — rank anchor (AC10, AC11)', () => {
  it('anchors at the latest imported competitive match (not now) and seeds the account', async () => {
    const t1 = 1_700_000_000_000;
    const t2 = 1_700_000_500_000; // later
    const h = harness(async () => envelope(
      [row('a', { timestamp: t1 }), row('b', { timestamp: t2 })],
      { anchor: { role: 'tank', tier: 'Diamond', division: 3, progressPct: 45 } },
    ));
    const res = await h.provider.importFromFile();
    expect(res.anchorSet).toBe(true);
    expect(res.accountsAdded).toBe(1);
    expect(h.set).toHaveBeenCalledTimes(1);
    expect(h.set).toHaveBeenCalledWith({
      account: 'Lampenlicht', role: 'tank', tier: 'Diamond', division: 3, progressPct: 45, setAt: t2,
    });
    expect(h.getAccounts()).toEqual({ Lampenlicht: 'Lampenlicht' });
  });

  it('does not set an anchor when the envelope carries none', async () => {
    const h = harness(async () => envelope([row('a')]));
    const res = await h.provider.importFromFile();
    expect(res.anchorSet).toBe(false);
    expect(h.set).not.toHaveBeenCalled();
  });

  it('drops an invalid anchor (bad tier) but still imports the games', async () => {
    const h = harness(async () => envelope([row('a')], { anchor: { role: 'tank', tier: 'Wood', division: 3, progressPct: 45 } }));
    const res = await h.provider.importFromFile();
    expect(res.imported).toBe(1);
    expect(res.anchorSet).toBe(false);
    expect(h.set).not.toHaveBeenCalled();
  });

  it('does not backdate over a newer existing anchor (re-import guard)', async () => {
    const t2 = 1_700_000_500_000;
    const h = harness(async () => envelope(
      [row('a', { timestamp: 1_700_000_000_000 }), row('b', { timestamp: t2 })],
      { anchor: { role: 'tank', tier: 'Diamond', division: 3, progressPct: 45 } },
    ));
    // A newer anchor already exists (e.g. the player set their current rank by hand).
    h.seedAnchor({ account: 'Lampenlicht', role: 'tank', setAt: t2 + 1_000 });
    const res = await h.provider.importFromFile();
    expect(res.anchorSet).toBe(false);
    expect(h.set).not.toHaveBeenCalled();
  });
});

describe('importFromFile — invalid count is row-scoped', () => {
  it('counts only rejected rows, not a bad anchor', async () => {
    const h = harness(async () => envelope(
      [row('a'), { matchId: 'bad', timestamp: 1, map: 'Ilios' }], // second row has no result
      { anchor: { role: 'tank', tier: 'Bogus', division: 3, progressPct: 50 } },
    ));
    const res = await h.provider.importFromFile();
    expect(res.imported).toBe(1);
    expect(res.invalid).toBe(1);       // only the resultless row — not the bad anchor
    expect(res.anchorSet).toBe(false);
  });
});

describe('importFromFile — cancel + malformed (AC12)', () => {
  it('reports cancelled and writes nothing when the picker is dismissed', async () => {
    const h = harness(async () => undefined);
    const res = await h.provider.importFromFile();
    expect(res).toMatchObject({ cancelled: true, imported: 0 });
    expect(h.getStored()).toHaveLength(0);
    expect(h.set).not.toHaveBeenCalled();
  });

  it('rejects a non-envelope file with an error and writes nothing', async () => {
    const h = harness(async () => 'not an envelope');
    const res = await h.provider.importFromFile();
    expect(res.imported).toBe(0);
    expect(res.error).toBeTruthy();
    expect(h.getStored()).toHaveLength(0);
  });

  it('surfaces a read/parse failure as an error result', async () => {
    const h = harness(async () => { throw new Error('bad json'); });
    const res = await h.provider.importFromFile();
    expect(res.error).toMatch(/bad json/);
    expect(h.getStored()).toHaveLength(0);
  });
});

describe('deleteFileImports — independent clear (AC8, AC9)', () => {
  it('removes only file-imported games and re-import reflects the new file', async () => {
    let current = envelope([row('a'), row('b')]);
    const h = harness(async () => current);
    await h.provider.importFromFile();
    // A live game and a Notion-imported game must survive the file wipe.
    h.getStored().push({ ...(row('live') as unknown as GameRecord) });
    h.getStored().push({ ...(row('notion') as unknown as GameRecord), importedAt: 1, importSource: 'notion' });

    expect(await h.provider.fileImportedCount()).toBe(2);
    const del = h.provider.deleteFileImports();
    expect(del).toEqual({ deleted: 2 });
    expect(h.getStored().map((g) => g.matchId).sort()).toEqual(['live', 'notion']);
    expect(h.clearExports).toHaveBeenCalledWith(['a', 'b']);

    // Re-sync: the vault dropped 'b' and added 'c'.
    current = envelope([row('a'), row('c')]);
    const res = await h.provider.importFromFile();
    expect(res.imported).toBe(2);
    expect(h.getStored().map((g) => g.matchId).sort()).toEqual(['a', 'c', 'live', 'notion']);
  });
});
