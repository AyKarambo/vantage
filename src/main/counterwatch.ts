import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MatchRecord } from '../core/model';
import { parseUnifiedMatches } from '../core/counterwatchParse';

/**
 * Reads finished matches out of Counterwatch's local IndexedDB and emits them.
 *
 * Counterwatch does the Overwolf GEP capture (so we need no Overwolf approval);
 * we just read its `unified_matches` store, map the fields, and hand each new
 * match to the same Notion pipeline GEP would have used.
 *
 * Emits: 'match' (MatchRecord), 'log' (string, ...args).
 *
 * Extends EventEmitter deliberately — an idiomatic Node push-source; the injectable, testable seam is `pipeline.addMatch` one level up (matches arrive pre-aggregated, so they skip the GEP aggregator).
 */
export class CounterwatchReader extends EventEmitter {
  private dir?: string;
  private readonly seen = new Set<string>();
  private watcher?: fs.FSWatcher;
  private pollTimer?: NodeJS.Timeout;
  private locateTimer?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;

  start(): void {
    if (!this.ensureLocated()) {
      // Counterwatch may not have run yet — keep looking.
      this.locateTimer = setInterval(() => {
        if (this.ensureLocated()) {
          if (this.locateTimer) clearInterval(this.locateTimer);
          this.locateTimer = undefined;
          this.begin();
        }
      }, 15_000);
      return;
    }
    this.begin();
  }

  stop(): void {
    this.watcher?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.locateTimer) clearInterval(this.locateTimer);
  }

  private begin(): void {
    this.emit('log', `watching Counterwatch DB: ${this.dir}`);
    this.poll();
    try {
      this.watcher = fs.watch(this.dir!, () => this.schedulePoll());
    } catch (err) {
      this.emit('log', 'fs.watch failed, falling back to interval', String(err));
    }
    this.pollTimer = setInterval(() => this.poll(), 30_000);
  }

  private schedulePoll(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.poll(), 1_500);
  }

  private poll(): void {
    if (!this.dir) return;
    let blob = '';
    try {
      for (const file of fs.readdirSync(this.dir)) {
        if (!file.endsWith('.log')) continue;
        blob += this.readShared(path.join(this.dir, file));
      }
    } catch (err) {
      this.emit('log', 'counterwatch poll read error', String(err));
      return;
    }

    const records = parseUnifiedMatches(blob);
    for (const record of records) {
      if (this.seen.has(record.matchId)) continue;
      this.seen.add(record.matchId);
      this.emit('log', `new match ${record.matchId}: ${record.mapName} / ${record.heroRole} / ${record.outcome}`);
      this.emit('match', record as MatchRecord);
    }
  }

  /** Read a file Counterwatch may hold open (Node shares read access on Windows). */
  private readShared(file: string): string {
    try {
      return fs.readFileSync(file, 'latin1');
    } catch {
      return '';
    }
  }

  private ensureLocated(): boolean {
    if (this.dir && fs.existsSync(this.dir)) return true;
    this.dir = this.locate();
    return Boolean(this.dir);
  }

  /** Find the Counterwatch extension's IndexedDB folder. */
  private locate(): string | undefined {
    const base = path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'Overwolf',
      'CefBrowserCache',
      'Default',
      'IndexedDB',
    );
    if (!fs.existsSync(base)) return undefined;
    for (const name of fs.readdirSync(base)) {
      if (!/^overwolf-extension_.*\.indexeddb\.leveldb$/.test(name)) continue;
      const full = path.join(base, name);
      if (this.looksLikeCounterwatch(full)) return full;
    }
    return undefined;
  }

  private looksLikeCounterwatch(dir: string): boolean {
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.log')) continue;
        if (fs.readFileSync(path.join(dir, file), 'latin1').includes('counterwatch_db')) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }
}
