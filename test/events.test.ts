import { describe, it, expect } from 'vitest';
import { createEventHub } from '../src/main/events';

describe('createEventHub', () => {
  it('delivers each event to its own listeners only, in subscription order', () => {
    const hub = createEventHub<{ a: number; b: string }>();
    const seen: string[] = [];
    hub.on('a', (n) => seen.push(`first ${n}`));
    hub.on('a', (n) => seen.push(`second ${n}`));
    hub.on('b', (s) => seen.push(`b ${s}`));
    hub.emit('a', 1);
    expect(seen).toEqual(['first 1', 'second 1']);
  });

  it('drops an event nobody listens to yet, and stops after unsubscribe', () => {
    const hub = createEventHub<{ a: number }>();
    hub.emit('a', 1);
    const seen: number[] = [];
    const off = hub.on('a', (n) => seen.push(n));
    hub.emit('a', 2);
    off();
    hub.emit('a', 3);
    expect(seen).toEqual([2]);
  });
});
