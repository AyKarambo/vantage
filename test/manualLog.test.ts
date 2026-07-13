import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ManualStore } from '../src/store/manualLog';
import type { AuthoredTarget } from '../src/core/targets';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../src/core/targets';
import { HistoryStore } from '../src/store/history';
import type { GameRecord } from '../src/core/analytics';

let dir: string;

const target = (id: string, name = id): AuthoredTarget => ({
  id, name, mode: 'self', rule: 'You grade it', createdAt: Date.now(), isActive: true,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-manual-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ManualStore', () => {
  it('adds and lists authored targets', () => {
    const store = new ManualStore(dir);
    expect(store.targets()).toHaveLength(0);
    store.addTarget(target('t1'));
    expect(store.targets()).toHaveLength(1);
    expect(store.targets()[0].id).toBe('t1');
  });

  it('upserts by id rather than duplicating', () => {
    const store = new ManualStore(dir);
    store.addTarget(target('t1', 'first'));
    store.addTarget(target('t1', 'renamed'));
    expect(store.targets()).toHaveLength(1);
    expect(store.targets()[0].name).toBe('renamed');
  });

  it('persists across instances', () => {
    new ManualStore(dir).addTarget(target('t2'));
    expect(new ManualStore(dir).targets().map((t) => t.id)).toEqual(['t2']);
  });

  it('removes a target', () => {
    const store = new ManualStore(dir);
    store.addTarget(target('t3'));
    store.removeTarget('t3');
    expect(store.targets()).toHaveLength(0);
  });

  it('updateTarget edits name/mode/rule but preserves createdAt and lifecycle state', () => {
    const store = new ManualStore(dir);
    const original = { ...target('t1', 'before'), createdAt: 1234, archivedAt: 99 };
    store.addTarget(original);
    store.updateTarget('t1', { name: 'after', mode: 'measured', rule: 'Deaths ≤ 2' });
    const t = new ManualStore(dir).targets()[0];
    expect(t.name).toBe('after');
    expect(t.mode).toBe('measured');
    expect(t.rule).toBe('Deaths ≤ 2');
    expect(t.createdAt).toBe(1234);
    expect(t.isActive).toBe(true);
    expect(t.archivedAt).toBe(99);
  });

  it('updateTarget ignores unknown ids', () => {
    const store = new ManualStore(dir);
    store.addTarget(target('t1'));
    store.updateTarget('nope', { name: 'x', mode: 'self', rule: 'You grade it' });
    expect(store.targets()[0].name).toBe('t1');
  });

  it('addTarget persists a measured target’s roleScope/heroScope across instances', () => {
    const store = new ManualStore(dir);
    store.addTarget({ ...target('t1'), mode: 'measured', rule: 'Damage ≥ 9000', roleScope: 'damage', heroScope: 'Tracer' });
    const t = new ManualStore(dir).targets()[0];
    expect(t.roleScope).toBe('damage');
    expect(t.heroScope).toBe('Tracer');
  });

  it('updateTarget persists roleScope/heroScope, and clears them when the patch omits them', () => {
    const store = new ManualStore(dir);
    store.addTarget(target('t1'));
    store.updateTarget('t1', { name: 'scoped', mode: 'measured', rule: 'Healing ≥ 9000', roleScope: 'support', heroScope: 'Ana' });
    let t = new ManualStore(dir).targets()[0];
    expect(t.roleScope).toBe('support');
    expect(t.heroScope).toBe('Ana');
    // Switching back to self-rated (no scope in the patch) clears the saved scope.
    store.updateTarget('t1', { name: 'unscoped', mode: 'self', rule: 'You grade it' });
    t = new ManualStore(dir).targets()[0];
    expect(t.roleScope).toBeUndefined();
    expect(t.heroScope).toBeUndefined();
  });

  it('active toggle persists across instances', () => {
    const store = new ManualStore(dir);
    store.addTarget(target('t1'));
    store.setActive('t1', false);
    expect(new ManualStore(dir).targets()[0].isActive).toBe(false);
    new ManualStore(dir).setActive('t1', true);
    expect(new ManualStore(dir).targets()[0].isActive).toBe(true);
  });

  it('archive sets archivedAt and restore clears it, persisted', () => {
    const store = new ManualStore(dir);
    store.addTarget(target('t1'));
    store.setArchived('t1', true);
    const archived = new ManualStore(dir).targets()[0];
    expect(archived.archivedAt).toBeTypeOf('number');
    new ManualStore(dir).setArchived('t1', false);
    expect(new ManualStore(dir).targets()[0].archivedAt).toBeUndefined();
  });

  it('backfills isActive: true on legacy records missing the field', () => {
    const legacy = {
      targets: [{ id: 'old', name: 'old', mode: 'self', scope: 'season', rule: 'You grade it', createdAt: 1 }],
    };
    fs.writeFileSync(path.join(dir, 'manual.json'), JSON.stringify(legacy), 'utf8');
    const store = new ManualStore(dir);
    expect(store.targets()[0].isActive).toBe(true);
    expect(store.targets()[0].archivedAt).toBeUndefined();
  });

  it('relocate re-points and reloads from the new dir', () => {
    const store = new ManualStore(dir);
    store.addTarget(target('t1'));

    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-manual-new-'));
    try {
      fs.copyFileSync(path.join(dir, 'manual.json'), path.join(newDir, 'manual.json'));
      store.relocate(newDir);

      expect(store.targets().map((t) => t.id)).toEqual(['t1']);
      store.addTarget(target('t2'));
      expect(new ManualStore(newDir).targets().map((t) => t.id).sort()).toEqual(['t1', 't2']);
      // The old dir's file is untouched by relocate itself (copy/delete is the
      // migration executor's job, not the store's).
      expect(new ManualStore(dir).targets().map((t) => t.id)).toEqual(['t1']);
    } finally {
      fs.rmSync(newDir, { recursive: true, force: true });
    }
  });

  // Migration (spec B3 / plan Decision B.3): existing installs had a *visible*
  // synthetic "Improvement Target" seeded under the internal bookkeeping id.
  // `removeTarget` is id-based, so it must delete only that synthetic target —
  // never a user-authored target that merely shares the display name — and
  // must never touch grades stored on matches (HistoryStore).
  it('migration: removeTarget(internal id) deletes only the seeded synthetic target', () => {
    const store = new ManualStore(dir);
    store.addTarget(target(NOTION_IMPROVEMENT_TARGET_ID, 'Improvement Target'));
    store.removeTarget(NOTION_IMPROVEMENT_TARGET_ID);
    expect(store.targets()).toHaveLength(0);
    // Idempotent: running the migration again (e.g. next launch) is a no-op.
    expect(() => store.removeTarget(NOTION_IMPROVEMENT_TARGET_ID)).not.toThrow();
    expect(new ManualStore(dir).targets()).toHaveLength(0);
  });

  it('migration: a user-authored target sharing the seeded name survives (different id)', () => {
    const store = new ManualStore(dir);
    store.addTarget(target(NOTION_IMPROVEMENT_TARGET_ID, 'Improvement Target'));
    store.addTarget(target('t-1700000000000', 'Improvement Target'));
    store.removeTarget(NOTION_IMPROVEMENT_TARGET_ID);
    const remaining = new ManualStore(dir).targets();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('t-1700000000000');
    expect(remaining[0].name).toBe('Improvement Target');
  });

  it('migration: stored grades on matches are untouched by target removal', () => {
    const manual = new ManualStore(dir);
    manual.addTarget(target(NOTION_IMPROVEMENT_TARGET_ID, 'Improvement Target'));
    manual.addTarget(target('t-1700000000000', 'Improvement Target'));

    const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-manual-history-'));
    const history = new HistoryStore(historyDir);
    try {
      const bookkeepingGame: GameRecord = {
        matchId: 'm1', timestamp: 0, account: 'Main', role: 'damage', map: 'Ilios',
        result: 'Win', gameType: 'Competitive', heroes: [],
        review: { at: 1, grades: { [NOTION_IMPROVEMENT_TARGET_ID]: 'hit' }, flags: {} },
      };
      const userGradedGame: GameRecord = {
        matchId: 'm2', timestamp: 0, account: 'Main', role: 'damage', map: 'Nepal',
        result: 'Loss', gameType: 'Competitive', heroes: [],
        review: { at: 1, grades: { 't-1700000000000': 'missed' }, flags: {} },
      };
      history.addMany([bookkeepingGame, userGradedGame]);

      manual.removeTarget(NOTION_IMPROVEMENT_TARGET_ID);

      const games = history.all();
      expect(games.find((g) => g.matchId === 'm1')?.review?.grades[NOTION_IMPROVEMENT_TARGET_ID]).toBe('hit');
      expect(games.find((g) => g.matchId === 'm2')?.review?.grades['t-1700000000000']).toBe('missed');
      expect(new ManualStore(dir).targets().map((t) => t.id)).toEqual(['t-1700000000000']);
    } finally {
      history.close();
      fs.rmSync(historyDir, { recursive: true, force: true });
    }
  });
});
