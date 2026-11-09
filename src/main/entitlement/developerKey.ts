import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { simulatedRecord } from '../../core/entitlement';
import type { EntitlementSource } from './source';

/**
 * SHA-256 of the developer key. Only the hash lives in git (Guardrail 2): the
 * key itself sits in a password manager and in `<userData>/developer.key` on
 * the developer's own machines. A random 256-bit key can't be recovered from it.
 */
export const DEVELOPER_KEY_SHA256 = '65cb49a5db6186611b16610b00d0af66ca06ef849130a5dff2dc7d26e2e73c15';

/** Whether `<userData>/developer.key` holds the developer key. Missing or unreadable → false. */
export function hasDeveloperKey(userData: string, sha256 = DEVELOPER_KEY_SHA256): boolean {
  let key: string;
  try {
    key = readFileSync(path.join(userData, 'developer.key'), 'utf8').trim();
  } catch {
    return false;
  }
  return createHash('sha256').update(key).digest('hex') === sha256;
}

/**
 * Permanent Pro for the developer, in release builds too — checked entirely
 * offline, so it adds no outbound path (Guardrail 5). Re-stamped on every
 * check, so the grace window never runs out.
 */
export const developerSource: EntitlementSource = {
  kind: 'developer',
  check: async () => simulatedRecord('pro', Date.now()),
  action: async () => ({ ok: false, reason: 'unavailable' }),
};
