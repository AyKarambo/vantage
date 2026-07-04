import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ManualStore } from '../src/store/manualLog';
import type { AuthoredTarget } from '../src/core/targets';

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
});
