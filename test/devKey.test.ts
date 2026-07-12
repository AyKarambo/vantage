import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setDevKey, hasDevKey, clearDevKey, devKeyPath } from '../src/main/config/devKey';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'owsync-devkey-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('devKey store', () => {
  it('writes the trimmed key to ~/.ow-cli/dev-key and reads it back', () => {
    expect(hasDevKey(home)).toBe(false);
    setDevKey('  my-token  ', home);
    expect(hasDevKey(home)).toBe(true);
    expect(fs.readFileSync(devKeyPath(home), 'utf8')).toBe('my-token');
    expect(devKeyPath(home)).toBe(path.join(home, '.ow-cli', 'dev-key'));
  });

  it('creates the .ow-cli directory if missing', () => {
    expect(fs.existsSync(path.join(home, '.ow-cli'))).toBe(false);
    setDevKey('tok', home);
    expect(fs.existsSync(path.join(home, '.ow-cli'))).toBe(true);
  });

  it('clears the stored key (idempotent)', () => {
    setDevKey('tok', home);
    clearDevKey(home);
    expect(hasDevKey(home)).toBe(false);
    expect(() => clearDevKey(home)).not.toThrow();
  });

  it('an empty/whitespace key clears rather than writes a blank file', () => {
    setDevKey('tok', home);
    setDevKey('   ', home);
    expect(hasDevKey(home)).toBe(false);
  });
});
