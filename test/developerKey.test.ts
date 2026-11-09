import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { developerSource, hasDeveloperKey } from '../src/main/entitlement/developerKey';
import { createEntitlementService } from '../src/main/entitlement/service';

const KEY = 'vdk_test-key';
const HASH = createHash('sha256').update(KEY).digest('hex');

function userDataWith(content?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vantage-devkey-'));
  if (content !== undefined) writeFileSync(path.join(dir, 'developer.key'), content);
  return dir;
}

describe('developer key', () => {
  it('accepts the key whose hash matches, ignoring surrounding whitespace', () => {
    expect(hasDeveloperKey(userDataWith(`${KEY}\r\n`), HASH)).toBe(true);
  });

  it('rejects a missing file or a wrong key', () => {
    expect(hasDeveloperKey(userDataWith(), HASH)).toBe(false);
    expect(hasDeveloperKey(userDataWith('vdk_wrong'), HASH)).toBe(false);
    expect(hasDeveloperKey(userDataWith(''), HASH)).toBe(false);
  });

  it('grants full Pro offline, with nothing to buy', async () => {
    let doc: unknown;
    const svc = createEntitlementService({ source: developerSource, doc: { read: () => doc, write: (v) => { doc = v; } } });
    await svc.refresh();
    expect(svc.access(false)).toMatchObject({ tier: 'pro', full: true, source: 'developer' });
    expect(await svc.action('upgrade')).toEqual({ ok: false, reason: 'unavailable' });
  });
});
