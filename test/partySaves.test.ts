import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore } from '../src/store/history';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import { effectiveGroupSize } from '../src/core/party';
import { byGroupSize } from '../src/core/analytics';
import type { GameRecord } from '../src/core/analytics';
import type { PartyInput } from '../src/shared/contract';

const tmpDirs: string[] = [];
const stores: HistoryStore[] = [];
afterEach(() => {
  for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
  stores.length = 0;
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  tmpDirs.length = 0;
});

const g = (p: Partial<GameRecord> = {}): GameRecord => ({
  matchId: 'a', timestamp: 1, account: 'Main', role: 'damage', map: 'Ilios',
  result: 'Win', gameType: 'Competitive', heroes: [], ...p,
});

/** A provider over a real SQLite history, so the patch semantics are the store's own. */
function harness(...seed: GameRecord[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-party-'));
  tmpDirs.push(dir);
  const history = new HistoryStore(dir);
  stores.push(history);
  history.addMany(seed);
  const deps = {
    history,
    // The real pipeline's recordGame stores the game; mirror that.
    recordGame: (game: GameRecord) => history.add(game),
    getConfig: () => ({ accounts: { main: 'Main' } }),
  } as unknown as DataProviderDeps;
  const provider = createDataProvider(deps);
  const stored = (id = 'a') => history.all().find((x) => x.matchId === id)!;
  return { provider, history, stored };
}

describe('editManual — party', () => {
  it('sets a party and null deletes it', () => {
    const { history, stored } = harness(g());
    history.editManual('a', { party: { members: ['Ann'], source: 'manual' } });
    expect(stored().party).toEqual({ members: ['Ann'], source: 'manual' });
    history.editManual('a', { map: 'Nepal' });
    expect(stored().party).toEqual({ members: ['Ann'], source: 'manual' });
    history.editManual('a', { party: null });
    expect(stored().party).toBeUndefined();
  });
});

describe('editMatch — party', () => {
  it('stores two members as manual and the group size is 3 despite a GEP count of 2', () => {
    const { provider, stored } = harness(g({ groupSize: 2 }));
    provider.editMatch({ matchId: 'a', party: { members: ['Alice#1', 'Bob'] } });
    expect(stored().party).toEqual({ members: ['Alice#1', 'Bob'], source: 'manual' });
    expect(effectiveGroupSize(stored())).toBe(3);
  });

  it('Solo on a game with no GEP count is group size 1 and lands in the Solo bucket', () => {
    const { provider, stored } = harness(g());
    provider.editMatch({ matchId: 'a', party: { members: [] } });
    expect(effectiveGroupSize(stored())).toBe(1);
    expect(byGroupSize([stored()]).map((x) => x.key)).toEqual(['Solo']);
  });

  it('null clears and falls back to the GEP count, or Unknown', () => {
    const { provider, stored } = harness(
      g({ groupSize: 3, party: { members: [], source: 'manual' } }),
      g({ matchId: 'b', party: { members: [], source: 'manual' } }),
    );
    provider.editMatch({ matchId: 'a', party: null });
    provider.editMatch({ matchId: 'b', party: null });
    expect(stored('a').party).toBeUndefined();
    expect(effectiveGroupSize(stored('a'))).toBe(3);
    expect(effectiveGroupSize(stored('b'))).toBeUndefined();
  });

  it('turns an auto-labelled party into a manual one', () => {
    const { provider, stored } = harness(g({ groupSize: 2, party: { members: ['Ann'], source: 'auto' } }));
    provider.editMatch({ matchId: 'a', party: { members: ['Cy'] } });
    expect(stored().party).toEqual({ members: ['Cy'], source: 'manual' });
  });

  it('leaves the party alone when omitted, and never stamps factsEditedAt for a party-only change', () => {
    const { provider, stored } = harness(g({ party: { members: ['Ann'], source: 'manual' } }));
    provider.editMatch({ matchId: 'a', mental: { tilt: true } });
    expect(stored().party).toEqual({ members: ['Ann'], source: 'manual' });
    provider.editMatch({ matchId: 'a', party: { members: ['Bob'] } });
    expect(stored().factsEditedAt).toBeUndefined();
  });

  it('normalizes members (dedupes Alice#1 / alice, trims, drops blanks)', () => {
    const { provider, stored } = harness(g());
    provider.editMatch({ matchId: 'a', party: { members: [' Alice#1 ', 'alice', '', 'Bob'] } });
    expect(stored().party?.members).toEqual(['Alice#1', 'Bob']);
  });

  it('ignores a malformed party from the IPC edge', () => {
    const { provider, stored } = harness(g({ party: { members: ['Ann'], source: 'manual' } }));
    const bad = ['x', 5, {}, { members: 'Ann' }] as unknown as PartyInput[];
    for (const party of bad) provider.editMatch({ matchId: 'a', party });
    expect(stored().party).toEqual({ members: ['Ann'], source: 'manual' });
    provider.editMatch({ matchId: 'a', party: { members: ['Bob', 7, null] as unknown as string[] } });
    expect(stored().party?.members).toEqual(['Bob']);
  });
});

describe('saveReview — party', () => {
  const review = { matchId: 'a', grades: {}, flags: {} };

  it('saves a party alongside the review, and null clears it', () => {
    const { provider, stored } = harness(g());
    provider.saveReview({ ...review, party: { members: ['Ann', 'Bob'] } });
    expect(stored().party).toEqual({ members: ['Ann', 'Bob'], source: 'manual' });
    expect(effectiveGroupSize(stored())).toBe(3);
    provider.saveReview({ ...review, party: null });
    expect(stored().party).toBeUndefined();
  });

  it('leaves the party alone when omitted', () => {
    const { provider, stored } = harness(g({ party: { members: ['Ann'], source: 'auto' } }));
    provider.saveReview(review);
    expect(stored().party).toEqual({ members: ['Ann'], source: 'auto' });
  });
});

describe('logMatch — party', () => {
  const base = { result: 'Win', role: 'damage', map: 'Ilios', gameType: 'Quick Play' } as const;

  it('records free-text members as a manual party', () => {
    const { provider, stored } = harness();
    const { matchId } = provider.logMatch({ ...base, party: { members: ['Ann', 'ann#9'] } });
    expect(stored(matchId).party).toEqual({ members: ['Ann'], source: 'manual' });
  });

  it('records an explicit Solo', () => {
    const { provider, stored } = harness();
    const { matchId } = provider.logMatch({ ...base, party: { members: [] } });
    expect(stored(matchId).party).toEqual({ members: [], source: 'manual' });
  });

  it('records no party when omitted or null', () => {
    const { provider, stored } = harness();
    const a = provider.logMatch({ ...base });
    expect(stored(a.matchId)).not.toHaveProperty('party');
    const b = provider.logMatch({ ...base, party: null });
    expect(stored(b.matchId)).not.toHaveProperty('party');
  });
});
