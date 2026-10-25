import type { JsonDoc, JsonDocs } from './jsonDocs';

/**
 * The match in progress, on disk — so an app restart mid-match resumes the
 * match instead of starting a fresh, partial one. One JSON document, atomic
 * writes, location-injected and Electron-free like the other stores.
 *
 * Transient by design: it lives beside the app's own state (not the
 * user-configurable data folder), is overwritten as the match goes on, and is
 * removed once the match is recorded. The content is opaque here — the
 * aggregator validates it before adopting anything (`armResume`).
 */
export class MatchCheckpointStore {
  private readonly doc: JsonDoc;

  constructor(docs: JsonDocs) {
    this.doc = docs('match-checkpoint.json');
  }

  /** The saved checkpoint, or undefined when there is none (or it can't be read). */
  load(): unknown {
    return this.doc.read();
  }

  save(checkpoint: unknown): void {
    this.doc.write(checkpoint);
  }

  clear(): void {
    this.doc.clear();
  }
}
