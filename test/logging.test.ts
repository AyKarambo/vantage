import { describe, it, expect } from 'vitest';
import {
  LOG_RING_CAP, formatLogLine, levelAdmits, pushRing, redactEntry, redactSecrets,
  type LogEntry,
} from '../src/core/logging';

function entry(p: Partial<LogEntry> = {}): LogEntry {
  return { ts: Date.UTC(2026, 6, 4, 18, 22, 1, 123), level: 'info', scope: 'gep', message: 'attached', ...p };
}

describe('levelAdmits', () => {
  it('orders debug < info < warn < error', () => {
    expect(levelAdmits('info', 'debug')).toBe(false);
    expect(levelAdmits('info', 'info')).toBe(true);
    expect(levelAdmits('info', 'error')).toBe(true);
    expect(levelAdmits('debug', 'debug')).toBe(true);
    expect(levelAdmits('error', 'warn')).toBe(false);
  });
});

describe('formatLogLine', () => {
  it('emits the stable grep-friendly format', () => {
    expect(formatLogLine(entry({ fields: { game: 10844 } })))
      .toBe('2026-07-04T18:22:01.123Z info  gep attached game=10844');
  });

  it('pads the level and serializes every field type', () => {
    const line = formatLogLine(entry({ level: 'warn', fields: { ok: false, n: 3, s: 'x' } }));
    expect(line).toContain('warn  gep');
    expect(line).toContain('ok=false n=3 s=x');
  });

  it('escapes newlines in messages and field values', () => {
    const line = formatLogLine(entry({ message: 'a\nb', fields: { stack: 'x\r\ny' } }));
    expect(line).not.toContain('\n');
    expect(line).toContain('a\\nb');
    expect(line).toContain('stack=x\\ny');
  });
});

describe('redactSecrets', () => {
  const token = 'secret_AbC123XyZ789LongToken';

  it('removes a registered secret wherever it appears', () => {
    const out = redactSecrets(`start ${token} mid url?tok=${token} end`, [token]);
    expect(out).not.toContain(token);
    expect(out).toContain('***');
  });

  it('catches Notion-shaped tokens even when unregistered', () => {
    expect(redactSecrets('x secret_ABCdef123 y')).toBe('x *** y');
    expect(redactSecrets('x ntn_00112233 y')).toBe('x *** y');
  });

  it('never leaves the token in an entry at any position (chunk check)', () => {
    const e = entry({ message: `sync with ${token}`, fields: { url: `https://x/${token}` } });
    const red = redactEntry(e, [token]);
    const line = formatLogLine(red);
    for (let i = 0; i + 8 <= token.length; i += 8) {
      expect(line).not.toContain(token.slice(i, i + 8));
    }
  });

  it('ignores empty and too-short secrets', () => {
    expect(redactSecrets('ab cd', ['', 'ab'])).toBe('ab cd');
  });

  it('redactEntry preserves non-string fields and shape', () => {
    const red = redactEntry(entry({ fields: { n: 5, ok: true } }));
    expect(red.fields).toEqual({ n: 5, ok: true });
    expect(red.scope).toBe('gep');
  });
});

describe('pushRing', () => {
  it('evicts oldest-first past the cap', () => {
    const ring: number[] = [];
    for (let i = 0; i < 10; i++) pushRing(ring, i, 3);
    expect(ring).toEqual([7, 8, 9]);
  });

  it('defaults to the viewer cap', () => {
    const ring: number[] = [];
    for (let i = 0; i < LOG_RING_CAP + 5; i++) pushRing(ring, i);
    expect(ring.length).toBe(LOG_RING_CAP);
    expect(ring[0]).toBe(5);
  });
});
