import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GepRecorder, readRecording, replayRecording } from '../src/main/recorder';
import { buildCompetitiveMatch } from '../src/main/simulate';
import { MatchAggregator } from '../src/core/matchAggregator';
import type { GepMessage, MatchRecord } from '../src/core/model';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-rec-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('GEP recorder + replayer', () => {
  it('records the GEP stream to a jsonl file and reads it back', () => {
    const rec = new GepRecorder(dir);
    const messages = buildCompetitiveMatch({ battleTag: 'Karambo#0000', map: "King's Row" }, 'REC-1');
    messages.forEach((m, i) => rec.message(m, 1000 + i * 100));

    expect(fs.existsSync(rec.path)).toBe(true);
    const entries = readRecording(rec.path);
    expect(entries).toHaveLength(messages.length);
    expect(entries.every((e) => e.type === 'message')).toBe(true);
  });

  it('round-trips: a recorded match replays into the same finished record', async () => {
    const rec = new GepRecorder(dir);
    const messages = buildCompetitiveMatch({ battleTag: 'Karambo#0000', map: "King's Row" }, 'REC-2');
    messages.forEach((m, i) => rec.message(m, 2000 + i * 50));

    const aggregator = new MatchAggregator();
    const finished: MatchRecord[] = [];
    const feed = (msg: GepMessage): void => {
      const done = aggregator.handle(msg);
      if (done) finished.push(done);
    };

    await replayRecording(readRecording(rec.path), feed);

    expect(finished).toHaveLength(1);
    expect(finished[0].matchId).toBe('REC-2');
    expect(finished[0].mapName).toBe("King's Row");
    expect(finished[0].outcome).toBe('Victory');
    expect(finished[0].battleTag).toBe('Karambo#0000');
  });

  it('skips corrupt lines instead of aborting', () => {
    const rec = new GepRecorder(dir);
    rec.message({ kind: 'event', feature: 'match_info', key: 'match_start', value: true }, 1);
    fs.appendFileSync(rec.path, 'not-json\n', 'utf8');
    rec.lifecycle('game-exit', 10844, 2);
    expect(readRecording(rec.path)).toHaveLength(2);
  });
});
