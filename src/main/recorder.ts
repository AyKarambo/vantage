/**
 * GEP events recorder + replayer — **testing/diagnostics only**.
 *
 * The Overwolf Events Recorder & Player (ERP) is an ow-native tool; this is the
 * ow-electron equivalent for *this* app: capture the normalized GEP stream to a
 * JSON-lines file during a real session, then replay it back through the exact
 * same `feed()` pipeline (aggregator → resolve → history) with no live game —
 * so match start/stop detection and the match-history update can be verified and
 * the `K` key table in {@link ../core/matchAggregator} validated against a real
 * capture.
 *
 * Off by default. The main process wires this only behind the `OW_SYNC_RECORD` /
 * `OW_SYNC_REPLAY` dev flags (matching the existing `OW_SYNC_SIMULATE` style).
 * Deliberately Electron-free (fs/path only) and dir-injected so it unit-tests
 * like `HistoryStore` / `OutboxStore`.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { GepMessage } from '../core/model';

/** One line of a recording: a normalized GEP message or a lifecycle marker. */
export type RecordedEntry =
  | { ts: number; type: 'message'; msg: GepMessage }
  | { ts: number; type: 'lifecycle'; event: string; gameId?: number };

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Appends the live GEP stream to a timestamped `.jsonl` file under `dir`. */
export class GepRecorder {
  private readonly file: string;

  constructor(dir: string, now: () => number = () => Date.now()) {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    this.file = path.join(dir, `recording-${stamp}.jsonl`);
  }

  /** The path this recorder is writing to. */
  get path(): string {
    return this.file;
  }

  message(msg: GepMessage, ts: number = Date.now()): void {
    this.append({ ts, type: 'message', msg });
  }

  lifecycle(event: string, gameId?: number, ts: number = Date.now()): void {
    this.append({ ts, type: 'lifecycle', event, gameId });
  }

  private append(entry: RecordedEntry): void {
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n', 'utf8');
  }
}

/** Parse a `.jsonl` recording file into entries, tolerating blank/partial lines. */
export function readRecording(file: string): RecordedEntry[] {
  const raw = fs.readFileSync(file, 'utf8');
  const out: RecordedEntry[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RecordedEntry);
    } catch {
      /* skip a corrupt line rather than abort the whole replay */
    }
  }
  return out;
}

/**
 * Replay a recording's messages back through `feed`, in order. With
 * `realtime: true` the original inter-message gaps are preserved (capped at 2s);
 * otherwise messages are fed as fast as possible (used by tests).
 */
export async function replayRecording(
  entries: RecordedEntry[],
  feed: (msg: GepMessage) => void,
  opts: { realtime?: boolean; log?: (msg: string) => void } = {},
): Promise<void> {
  const messages = entries.filter(
    (e): e is Extract<RecordedEntry, { type: 'message' }> => e.type === 'message',
  );
  opts.log?.(`replay: feeding ${messages.length} messages`);
  let prev: number | undefined;
  for (const e of messages) {
    if (opts.realtime && prev !== undefined) {
      const wait = Math.max(0, Math.min(2000, e.ts - prev));
      if (wait) await delay(wait);
    }
    prev = e.ts;
    feed(e.msg);
  }
  opts.log?.('replay: done');
}
