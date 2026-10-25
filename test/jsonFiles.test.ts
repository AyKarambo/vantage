import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { jsonFiles } from '../src/store/jsonFiles';

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-jsonfiles-'));

describe('jsonFiles', () => {
  it('round-trips a document, leaving no tmp file behind', () => {
    const dir = tmpDir();
    const doc = jsonFiles(dir)('thing.json');
    expect(doc.read()).toBeUndefined();
    doc.write({ a: 1 });
    expect(doc.read()).toEqual({ a: 1 });
    expect(fs.readdirSync(dir)).toEqual(['thing.json']);
    expect(fs.readFileSync(path.join(dir, 'thing.json'), 'utf8')).toBe('{\n  "a": 1\n}');
  });

  it('writes compact JSON when asked', () => {
    const dir = tmpDir();
    jsonFiles(dir, { compact: true })('c.json').write({ a: 1 });
    expect(fs.readFileSync(path.join(dir, 'c.json'), 'utf8')).toBe('{"a":1}');
  });

  it('reads an unreadable document as undefined', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ not json');
    expect(jsonFiles(dir)('bad.json').read()).toBeUndefined();
  });

  it('relocates to the same-named document elsewhere, creating the folder', () => {
    const from = tmpDir();
    const to = path.join(tmpDir(), 'nested');
    const doc = jsonFiles(from)('x.json');
    doc.write([1]);
    doc.relocate(to);
    expect(doc.read()).toBeUndefined();
    doc.write([2]);
    expect(JSON.parse(fs.readFileSync(path.join(to, 'x.json'), 'utf8'))).toEqual([2]);
    expect(JSON.parse(fs.readFileSync(path.join(from, 'x.json'), 'utf8'))).toEqual([1]);
  });

  it('clears the document, and clearing a missing one is a no-op', () => {
    const dir = tmpDir();
    const doc = jsonFiles(dir)('gone.json');
    doc.clear();
    doc.write({});
    doc.clear();
    expect(doc.read()).toBeUndefined();
  });
});
