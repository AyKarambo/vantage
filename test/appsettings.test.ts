import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The bundled appsettings.json ships as a merge layer under the user's local
 * config, so any account it defines re-appears on every load and can never be
 * removed from the account manager. It must therefore ship NO placeholder
 * account — otherwise users get an undeletable "YourName" phantom.
 */
describe('bundled appsettings.json', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'appsettings.json'), 'utf8'));

  it('ships no default accounts (a bundled account is undeletable from the UI)', () => {
    expect(cfg.accounts).toEqual({});
  });

  it('leaves the Notion database ids empty (configured per user)', () => {
    expect(cfg.notion.gametrackerDatabaseId).toBe('');
  });
});
