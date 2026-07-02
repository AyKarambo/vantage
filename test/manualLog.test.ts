import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ManualStore } from '../src/store/manualLog';
import type { AuthoredTarget } from '../src/core/targets';

let dir: string;

const target = (id: string, name = id): AuthoredTarget => ({
  id, name, mode: 'self', scope: 'season', rule: 'You grade it', createdAt: Date.now(),
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
});
