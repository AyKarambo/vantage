import { StringDecoder } from 'node:string_decoder';

/**
 * Newline-delimited JSON framing for the bridge↔app pipe.
 *
 * A stream socket carries bytes, not messages: one write can arrive as three
 * chunks, three writes can arrive as one, and a multi-byte UTF-8 character can
 * straddle a chunk boundary. This module is the single place that knows how to
 * turn that back into whole JSON values, so neither the pipe server nor the
 * bridge client has to reimplement it.
 *
 * Errors are *reported*, never thrown: one malformed line must not tear down a
 * live connection carrying other in-flight requests.
 */

/** Frame one value as a single NDJSON line. */
export function encodeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export interface DecodedChunk {
  /** Whole values parsed from this chunk, in arrival order. */
  values: unknown[];
  /** Lines that could not be parsed — surfaced so the caller can reply with an error. */
  errors: { line: string; message: string }[];
}

/**
 * Cap on a single un-terminated line. A peer that never sends a newline would
 * otherwise grow this buffer without bound — a trivially reachable
 * memory-exhaustion path on a local endpoint that any same-user process can
 * connect to, so it is bounded rather than trusted.
 */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

/**
 * Accumulates socket chunks and yields whole JSON values.
 *
 * One instance per connection — it holds that connection's partial line.
 */
export class NdjsonBuffer {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  /** True once a line blew the size cap; the rest of that line is discarded. */
  private overflowed = false;

  /** Feed a chunk; returns whatever completed as a result of it. */
  push(chunk: Buffer | string): DecodedChunk {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const out: DecodedChunk = { values: [], errors: [] };
    if (!text) return out;

    this.pending += text;

    let nl = this.pending.indexOf('\n');
    while (nl !== -1) {
      const line = this.pending.slice(0, nl);
      this.pending = this.pending.slice(nl + 1);
      // A line that already overflowed is dropped up to its terminator, then
      // framing resynchronises on the next one rather than staying broken.
      if (this.overflowed) {
        this.overflowed = false;
        out.errors.push({ line: '', message: 'line exceeded the maximum size and was discarded' });
      } else {
        this.parseInto(line, out);
      }
      nl = this.pending.indexOf('\n');
    }

    if (this.pending.length > MAX_LINE_BYTES) {
      this.pending = '';
      this.overflowed = true;
    }
    return out;
  }

  /** Bytes currently held in the incomplete trailing line (tests / diagnostics). */
  get buffered(): number {
    return this.pending.length;
  }

  private parseInto(line: string, out: DecodedChunk): void {
    // Blank lines are framing noise (a trailing newline, a keepalive), not an
    // error — silently skipped so they can't produce spurious error replies.
    if (!line.trim()) return;
    try {
      out.values.push(JSON.parse(line));
    } catch (err) {
      out.errors.push({ line, message: err instanceof Error ? err.message : String(err) });
    }
  }
}
