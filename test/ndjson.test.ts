import { describe, it, expect } from 'vitest';
import { NdjsonBuffer, encodeLine, MAX_LINE_BYTES } from '../src/shared/mcp/ndjson';

/**
 * Framing tests for the bridge↔app pipe. A stream socket carries bytes, not
 * messages, so these cover the ways a naive `chunk.toString().split('\n')`
 * would silently corrupt traffic: split lines, coalesced lines, split
 * multi-byte characters, and a malformed line arriving mid-flight.
 */
describe('encodeLine', () => {
  it('frames a value as exactly one newline-terminated line', () => {
    const line = encodeLine({ id: 1, op: 'ranks' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1).includes('\n')).toBe(false);
    expect(JSON.parse(line)).toEqual({ id: 1, op: 'ranks' });
  });

  it('round-trips through the buffer', () => {
    const buf = new NdjsonBuffer();
    const out = buf.push(encodeLine({ hello: 'world' }));
    expect(out.values).toEqual([{ hello: 'world' }]);
    expect(out.errors).toEqual([]);
  });
});

describe('NdjsonBuffer framing', () => {
  it('reassembles a value split across chunks', () => {
    const buf = new NdjsonBuffer();
    const line = encodeLine({ id: 7, op: 'dashboard' });
    const a = line.slice(0, 5);
    const b = line.slice(5);
    expect(buf.push(a).values).toEqual([]);
    expect(buf.push(b).values).toEqual([{ id: 7, op: 'dashboard' }]);
  });

  it('splits multiple values coalesced into one chunk, in order', () => {
    const buf = new NdjsonBuffer();
    const chunk = encodeLine({ id: 1 }) + encodeLine({ id: 2 }) + encodeLine({ id: 3 });
    expect(buf.push(chunk).values).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('holds a trailing partial line until its newline arrives', () => {
    const buf = new NdjsonBuffer();
    const out = buf.push(`${encodeLine({ id: 1 })}{"id":2}`);
    expect(out.values).toEqual([{ id: 1 }]);
    expect(buf.buffered).toBeGreaterThan(0);
    expect(buf.push('\n').values).toEqual([{ id: 2 }]);
    expect(buf.buffered).toBe(0);
  });

  it('preserves arrival order so interleaved ids stay independently resolvable', () => {
    const buf = new NdjsonBuffer();
    const values = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const out = buf.push(values.map(encodeLine).join(''));
    expect(out.values).toEqual(values);
  });

  it('does not corrupt a multi-byte character split across chunks', () => {
    const buf = new NdjsonBuffer();
    // "Lúcio" — the é/ú bytes are exactly the kind that a per-chunk toString()
    // would mangle when the split lands mid-character.
    const full = Buffer.from(encodeLine({ hero: 'Lúcio' }), 'utf8');
    const cut = full.indexOf(Buffer.from('ú', 'utf8')) + 1; // mid-character
    expect(buf.push(full.subarray(0, cut)).values).toEqual([]);
    expect(buf.push(full.subarray(cut)).values).toEqual([{ hero: 'Lúcio' }]);
  });

  it('skips blank lines rather than reporting them as errors', () => {
    const buf = new NdjsonBuffer();
    const out = buf.push(`\n\n${encodeLine({ id: 1 })}\n`);
    expect(out.values).toEqual([{ id: 1 }]);
    expect(out.errors).toEqual([]);
  });
});

describe('NdjsonBuffer error handling', () => {
  it('reports a malformed line without dropping the valid ones around it', () => {
    const buf = new NdjsonBuffer();
    const out = buf.push(`${encodeLine({ id: 1 })}{not json}\n${encodeLine({ id: 3 })}`);
    expect(out.values).toEqual([{ id: 1 }, { id: 3 }]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].line).toBe('{not json}');
  });

  it('keeps working after a malformed line — the connection is not poisoned', () => {
    const buf = new NdjsonBuffer();
    buf.push('garbage\n');
    expect(buf.push(encodeLine({ id: 9 })).values).toEqual([{ id: 9 }]);
  });

  it('discards an oversized line and resynchronises on the next one', () => {
    const buf = new NdjsonBuffer();
    // A peer that never sends a newline must not grow the buffer without
    // bound — this endpoint is reachable by any same-user process.
    buf.push(`{"pad":"${'x'.repeat(MAX_LINE_BYTES + 16)}`);
    expect(buf.buffered).toBe(0);
    const out = buf.push(`"}\n${encodeLine({ id: 2 })}`);
    expect(out.errors).toHaveLength(1);
    expect(out.values).toEqual([{ id: 2 }]);
  });
});
