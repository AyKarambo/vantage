import * as fs from 'fs';
import * as path from 'path';
import type { JsonDoc, JsonDocs } from './jsonDocs';

/**
 * JSON documents as files in `dir`: `<name>` with atomic writes through a
 * sibling `<name>.tmp.json` + rename, so a crash mid-write never leaves a
 * truncated file. `compact` drops the pretty-printing for frequently rewritten
 * documents (the match checkpoint).
 */
export function jsonFiles(dir: string, opts: { compact?: boolean } = {}): JsonDocs {
  return (name) => jsonFile(dir, name, opts.compact ? undefined : 2);
}

function jsonFile(dir: string, name: string, indent: number | undefined): JsonDoc {
  let file = '';
  let tmp = '';
  const pointAt = (d: string): void => {
    fs.mkdirSync(d, { recursive: true });
    file = path.join(d, name);
    tmp = path.join(d, name.replace(/\.json$/, '.tmp.json'));
  };
  pointAt(dir);
  return {
    read: () => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return undefined;
      }
    },
    write: (value) => {
      fs.writeFileSync(tmp, JSON.stringify(value, null, indent), 'utf8');
      fs.renameSync(tmp, file);
    },
    clear: () => fs.rmSync(file, { force: true }),
    relocate: pointAt,
  };
}
