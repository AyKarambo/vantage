import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDevModeAuthMonitor } from '../src/main/devModeAuthMonitor';
import type { DevModeAuthStatusPayload } from '../src/shared/contract';

function harness(attempted = true) {
  const published: DevModeAuthStatusPayload[] = [];
  const m = createDevModeAuthMonitor({
    attempted,
    log: () => {},
    publish: (p) => published.push(p),
  });
  return { m, published };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('devModeAuthMonitor — one-shot resolve/publish latch', () => {
  it('starts pending with no detail', () => {
    const { m } = harness();
    expect(m.current()).toEqual({ attempted: true, outcome: 'pending', detail: undefined });
  });

  it('publishes exactly once on the first resolve()', () => {
    const { m, published } = harness();
    m.resolve('confirmed', 'gep package ready');
    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({ attempted: true, outcome: 'confirmed', detail: 'gep package ready' });
    expect(m.current()).toEqual({ attempted: true, outcome: 'confirmed', detail: 'gep package ready' });
  });

  it('ignores a second resolve() as a silent no-op', () => {
    const { m, published } = harness();
    m.resolve('confirmed', 'gep package ready');
    m.resolve('failed', 'failed-to-initialize');
    expect(published).toHaveLength(1);
    expect(m.current()).toEqual({ attempted: true, outcome: 'confirmed', detail: 'gep package ready' });
  });

  it('armTimeout fires a failed resolve after the given delay when nothing else resolves', () => {
    vi.useFakeTimers();
    const { m, published } = harness();
    m.armTimeout(15_000);
    expect(published).toHaveLength(0);

    vi.advanceTimersByTime(15_000);

    expect(published).toHaveLength(1);
    expect(published[0].outcome).toBe('failed');
    expect(published[0].detail).toMatch(/timed out/i);
  });

  it('cancels the armed timeout when resolved early, so it never double-publishes', () => {
    vi.useFakeTimers();
    const { m, published } = harness();
    m.armTimeout(15_000);
    m.resolve('confirmed', 'gep package ready');
    expect(published).toHaveLength(1);

    vi.advanceTimersByTime(15_000);

    expect(published).toHaveLength(1);
    expect(published[0].outcome).toBe('confirmed');
  });

  it('armTimeout is a no-op if the monitor is already resolved', () => {
    vi.useFakeTimers();
    const { m, published } = harness();
    m.resolve('failed', 'no dev credentials');
    m.armTimeout(15_000);

    vi.advanceTimersByTime(15_000);

    expect(published).toHaveLength(1);
    expect(published[0].detail).toBe('no dev credentials');
  });

  it('round-trips attempted: false through current() and every published payload', () => {
    const { m, published } = harness(false);
    expect(m.current().attempted).toBe(false);

    m.resolve('failed', 'not attempted');
    expect(published[0].attempted).toBe(false);
    expect(m.current().attempted).toBe(false);
  });
});
