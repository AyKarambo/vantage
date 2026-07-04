import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger, type LoggerFs } from '../src/main/logger';
import type { LogEntry } from '../src/core/logging';

/** In-memory LoggerFs: deterministic, synchronous, failure-injectable. */
function fakeFs(): LoggerFs & { files: Map<string, string>; failWrites: boolean } {
  const impl = {
    files: new Map<string, string>(),
    failWrites: false,
    mkdir: (_dir: string) => {},
    appendLine(file: string, line: string, onError: (err: unknown) => void) {
      if (impl.failWrites) {
        onError(new Error('disk full'));
        return;
      }
      impl.files.set(file, (impl.files.get(file) ?? '') + line + '\n');
    },
    fileSize: (file: string) => Buffer.byteLength(impl.files.get(file) ?? ''),
    rename(from: string, to: string) {
      const content = impl.files.get(from);
      if (content === undefined) throw new Error(`missing ${from}`);
      impl.files.set(to, content);
      impl.files.delete(from);
    },
    remove: (file: string) => void impl.files.delete(file),
  };
  return impl;
}

const CURRENT = path.join('logs', 'vantage.log');
const numbered = (n: number) => path.join('logs', `vantage.${n}.log`);

describe('Logger', () => {
  it('writes formatted lines to the current file at info level', () => {
    const f = fakeFs();
    const log = new Logger({ dir: 'logs', fsImpl: f });
    log.info('gep', 'attached', { game: 10844 });
    log.debug('gep', 'dropped below level');
    const content = f.files.get(CURRENT) ?? '';
    expect(content).toContain('info  gep attached game=10844');
    expect(content).not.toContain('dropped below level');
  });

  it('setLevel(debug) admits debug entries; back to info drops them', () => {
    const f = fakeFs();
    const log = new Logger({ dir: 'logs', fsImpl: f });
    log.setLevel('debug');
    log.debug('gep', 'event summary');
    log.setLevel('info');
    log.debug('gep', 'hidden again');
    const content = f.files.get(CURRENT) ?? '';
    expect(content).toContain('event summary');
    expect(content).not.toContain('hidden again');
    expect(log.getLevel()).toBe('info');
  });

  it('rotates at the size cap, keeps at most maxFiles, oldest deleted first', () => {
    const f = fakeFs();
    const log = new Logger({ dir: 'logs', fsImpl: f, maxFileBytes: 120, maxFiles: 3 });
    for (let i = 0; i < 40; i++) log.info('main', `line ${i} padding-padding-padding`);
    const names = [...f.files.keys()];
    expect(names.length).toBeLessThanOrEqual(3);
    expect(names).toContain(CURRENT);
    expect(names).not.toContain(numbered(3));
    // Rotated file holds older lines than the current file.
    const rotated = f.files.get(numbered(1)) ?? '';
    const current = f.files.get(CURRENT) ?? '';
    expect(rotated.length).toBeGreaterThan(0);
    const lastRotated = Number(/line (\d+)/.exec(rotated.trim().split('\n').at(-1) ?? '')?.[1]);
    const firstCurrent = Number(/line (\d+)/.exec(current.trim().split('\n')[0] ?? '')?.[1]);
    expect(lastRotated).toBeLessThan(firstCurrent);
  });

  it('degrades silently on write failure — ring and onEntry keep working', () => {
    const f = fakeFs();
    const pushed: LogEntry[] = [];
    const log = new Logger({ dir: 'logs', fsImpl: f, onEntry: (e) => pushed.push(e) });
    f.failWrites = true;
    log.info('main', 'one');
    log.info('main', 'two');
    expect(log.entries().map((e) => e.message)).toEqual(['one', 'two']);
    expect(pushed).toHaveLength(2);
    // No throw, and nothing landed on "disk" after the failure.
    expect(f.files.get(CURRENT) ?? '').toBe('');
  });

  it('redacts registered secrets from ring, push, and file', () => {
    const token = 'secret_LiveNotionToken123456';
    const f = fakeFs();
    const pushed: LogEntry[] = [];
    const log = new Logger({
      dir: 'logs', fsImpl: f, getSecrets: () => [token], onEntry: (e) => pushed.push(e),
    });
    log.error('notion', `sync failed for ${token}`, { detail: `bad ${token}` });
    const everything =
      (f.files.get(CURRENT) ?? '') + JSON.stringify(log.entries()) + JSON.stringify(pushed);
    expect(everything).not.toContain(token);
    expect(everything).toContain('***');
  });

  it('a throwing onEntry listener never breaks logging', () => {
    const f = fakeFs();
    const log = new Logger({ dir: 'logs', fsImpl: f, onEntry: () => { throw new Error('boom'); } });
    expect(() => log.info('main', 'still fine')).not.toThrow();
    expect(f.files.get(CURRENT) ?? '').toContain('still fine');
  });

  it('adapter() joins console-style args into one message', () => {
    const f = fakeFs();
    const log = new Logger({ dir: 'logs', fsImpl: f });
    log.adapter('gep')('detected', { id: 10844 }, 42);
    expect(f.files.get(CURRENT) ?? '').toContain('gep detected {"id":10844} 42');
  });

  it('writes to a real temp directory end-to-end', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-log-'));
    try {
      const log = new Logger({ dir });
      log.info('main', 'hello file');
      // Default appendLine is async fire-and-forget; poll without blocking the loop.
      const file = path.join(dir, 'vantage.log');
      const deadline = Date.now() + 2000;
      let content = '';
      while (Date.now() < deadline) {
        content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        if (content.includes('hello file')) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(content).toContain('hello file');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
