import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FriendStore } from '../src/store/friends';
import { createDataProvider } from '../src/main/dataProvider';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-friends-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('FriendStore', () => {
  it('starts empty for a fresh directory', () => {
    const s = new FriendStore(dir);
    expect(s.list()).toEqual([]);
    expect(s.keys().size).toBe(0);
  });

  it('set adds a friend, listed by key and name, sorted case-insensitively', () => {
    const s = new FriendStore(dir);
    s.set('bob', true);
    const out = s.set('Alice#1234', true);
    expect(out).toEqual([{ key: 'alice', name: 'Alice#1234' }, { key: 'bob', name: 'bob' }]);
    expect(s.list()).toEqual(out);
    expect([...s.keys()].sort()).toEqual(['alice', 'bob']);
  });

  it('persists across a new store on the same dir', () => {
    new FriendStore(dir).set('Alice#1234', true);
    expect(new FriendStore(dir).list()).toEqual([{ key: 'alice', name: 'Alice#1234' }]);
  });

  it('treats Alice#1234 and alice as one friend; unmarking via the bare name removes it', () => {
    const s = new FriendStore(dir);
    s.set('Alice#1234', true);
    expect(s.set('alice', true)).toHaveLength(1);
    expect(s.set('Alice', false)).toEqual([]);
    expect(new FriendStore(dir).list()).toEqual([]);
  });

  it('upgrades a bare spelling to the #-tagged one but never downgrades', () => {
    const s = new FriendStore(dir, () => 5);
    s.set('Alice', true);
    expect(s.set('Alice#1234', true)).toEqual([{ key: 'alice', name: 'Alice#1234' }]);
    expect(s.set('alice', true)).toEqual([{ key: 'alice', name: 'Alice#1234' }]);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'friends.json'), 'utf8'));
    expect(stored.alice.addedAt).toBe(5);
  });

  it('ignores an empty name and unmarking a non-friend', () => {
    const s = new FriendStore(dir);
    expect(s.set('   ', true)).toEqual([]);
    expect(s.set('#1234', true)).toEqual([]);
    expect(s.set('nobody', false)).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'friends.json'))).toBe(false);
  });

  it('loads as empty from a corrupt or wrongly-shaped file', () => {
    fs.writeFileSync(path.join(dir, 'friends.json'), '{not json', 'utf8');
    expect(new FriendStore(dir).list()).toEqual([]);
    fs.writeFileSync(path.join(dir, 'friends.json'), '[1,2]', 'utf8');
    expect(new FriendStore(dir).list()).toEqual([]);
  });

  it('relocate re-points and reloads from the new dir, leaving the old dir untouched', () => {
    const s = new FriendStore(dir);
    s.set('Alice#1', true);
    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-friends-new-'));
    try {
      fs.copyFileSync(path.join(dir, 'friends.json'), path.join(newDir, 'friends.json'));
      s.relocate(newDir);
      expect(s.list()).toEqual([{ key: 'alice', name: 'Alice#1' }]);
      s.set('Bob', true);
      expect(new FriendStore(newDir).list()).toHaveLength(2);
      expect(new FriendStore(dir).list()).toHaveLength(1);
    } finally {
      fs.rmSync(newDir, { recursive: true, force: true });
    }
  });
});

describe('DataProvider friends', () => {
  // Only the friends dep is exercised; the rest of the deps are never touched by these methods.
  const provider = () => createDataProvider({ friends: new FriendStore(dir) } as unknown as Parameters<typeof createDataProvider>[0]);

  it('friends/setFriend delegate to the store and return the updated list', () => {
    const p = provider();
    expect(p.friends()).toEqual([]);
    expect(p.setFriend({ name: 'Alice#1', friend: true })).toEqual([{ key: 'alice', name: 'Alice#1' }]);
    expect(p.setFriend({ name: 'alice', friend: false })).toEqual([]);
  });

  it('ignores malformed input from the IPC edge', () => {
    const p = provider();
    p.setFriend({ name: 'Alice', friend: true });
    const bad = [{ name: 5, friend: true }, { name: 'Bob', friend: 'yes' }, null] as unknown as Parameters<typeof p.setFriend>[0][];
    for (const input of bad) expect(p.setFriend(input)).toEqual([{ key: 'alice', name: 'Alice' }]);
  });
});
