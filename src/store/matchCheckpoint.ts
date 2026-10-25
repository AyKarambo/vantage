import * as fs from 'fs';
import * as path from 'path';

/**
 * The match in progress, on disk — so an app restart mid-match resumes the
 * match instead of starting a fresh, partial one. One JSON file, atomic
 * tmp+rename writes, dir-injected and Electron-free like the other stores.
 *
 * Transient by design: it lives beside the app's own state (not the
 * user-configurable data folder), is overwritten as the match goes on, and is
 * removed once the match is recorded. The content is opaque here — the
 * aggregator validates it before adopting anything (`armResume`).
 */
export class MatchCheckpointStore {
  private readonly file: string;
  private readonly tmp: string;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'match-checkpoint.json');
    this.tmp = path.join(dir, 'match-checkpoint.tmp.json');
  }

  /** The saved checkpoint, or undefined when there is none (or it can't be read). */
  load(): unknown {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  save(checkpoint: unknown): void {
    fs.writeFileSync(this.tmp, JSON.stringify(checkpoint), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
  }
}
