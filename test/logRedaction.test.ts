import { describe, it, expect } from 'vitest';
import { redactForExport, redactPii } from '../src/core/logRedaction';
import type { LogEntry } from '../src/core/logging';

function entry(p: Partial<LogEntry> = {}): LogEntry {
  return { ts: Date.UTC(2026, 6, 17, 12, 0, 0), level: 'info', scope: 'gep', message: '', ...p };
}

// 12 realistic-looking BattleTags — real Blizzard shape (3-12 chars, starts
// with a letter, `#` + 4-5 digit discriminator).
const ROSTER_TAGS = [
  'Karambo#1234', 'Ashbrnger#22224', 'Widow99#3005', 'MercyMain#4471',
  'Genjii#5590', 'Lucio22#6103', 'ZenMaster#7788', 'Reinhardt#8899',
  'Tracer01#9012', 'Kiriko7#14501', 'Sombra#2764', 'Baptiste#3391',
];

// Rotates through the real GEP roster key aliases `matchAggregator/gepValues.ts`'s
// parseRoster() reads, so every alias the app depends on is exercised.
const NAME_KEY_ROTATION = ['battle_tag', 'battlenet_tag', 'player_name', 'name'];

/** Builds one roster_N JSON payload in the same shape `main/simulate.ts` builds and `main/gep.ts` dispatches. */
function rosterPayload(i: number): Record<string, unknown> {
  const key = NAME_KEY_ROTATION[i % NAME_KEY_ROTATION.length];
  return {
    [key]: ROSTER_TAGS[i],
    hero_name: ['TRACER', 'MERCY', 'WIDOWMAKER', 'REINHARDT'][i % 4],
    hero_role: ['damage', 'support', 'tank'][i % 3],
    team: i < 6 ? 0 : 1,
    is_local: i === 0,
    kills: 10 + i,
    deaths: i,
    assists: 3 + i,
    damage: 5000 + i * 100,
    healing: i % 3 === 1 ? 4000 : 0,
    mitigation: i % 3 === 2 ? 3000 : 0,
  };
}

/** A 12-player roster dispatch log exactly as `gep.ts`'s dispatch()/logger adapter would produce it. */
function rosterDispatchEntries(): LogEntry[] {
  return Array.from({ length: 12 }, (_, i) =>
    entry({ message: `gep info: roster.roster_${i} = ${JSON.stringify(rosterPayload(i))}` }),
  );
}

describe('redactForExport — realistic roster_N GEP dispatch log', () => {
  it('strips every BattleTag and player name from a 12-player roster payload', () => {
    const out = redactForExport(rosterDispatchEntries());
    const joined = out.map((e) => e.message).join('\n');

    expect(out).toHaveLength(12);
    expect(joined).not.toMatch(/#\d{4,}/);
    for (const tag of ROSTER_TAGS) {
      expect(joined).not.toContain(tag);
      expect(joined).not.toContain(tag.split('#')[0]);
    }
    // non-PII fields survive so the report stays useful for debugging
    expect(joined).toContain('hero_name');
    expect(joined).toContain('TRACER');
    expect(joined).toContain('is_local');
  });

  it('keeps entry count, order, ts/level/scope, and non-string fields exactly', () => {
    const entries = rosterDispatchEntries();
    const out = redactForExport(entries);
    expect(out.map((e) => e.ts)).toEqual(entries.map((e) => e.ts));
    expect(out.map((e) => e.level)).toEqual(entries.map((e) => e.level));
    expect(out.map((e) => e.scope)).toEqual(entries.map((e) => e.scope));
  });
});

describe('redactForExport — Windows user paths', () => {
  it('keeps the path shape but drops the username (backslash)', () => {
    const out = redactForExport([
      entry({
        scope: 'main',
        message: 'exporting log from C:\\Users\\timos\\AppData\\Roaming\\ow.vantage\\logs\\vantage.log',
      }),
    ]);
    expect(out[0].message).toContain('C:\\Users\\');
    expect(out[0].message).not.toContain('timos');
    expect(out[0].message).toContain('AppData\\Roaming\\ow.vantage\\logs\\vantage.log');
  });

  it('keeps the path shape but drops the username (forward slash, case-insensitive users)', () => {
    const out = redactForExport([entry({ message: 'watching dir: c:/users/timos/AppData/Local/Overwolf' })]);
    expect(out[0].message).toContain('c:/users/');
    expect(out[0].message).not.toContain('timos');
    expect(out[0].message).toContain('AppData/Local/Overwolf');
  });
});

describe('redactForExport — secrets regression', () => {
  it('still redacts a Notion internal-integration token shape (no regression against core/logging)', () => {
    const out = redactForExport([entry({ message: 'exporting with secret_AbC123XyZ789 attached' })]);
    expect(out[0].message).not.toContain('secret_AbC123XyZ789');
    expect(out[0].message).toContain('***');
  });

  it('still redacts an ntn_-shaped token', () => {
    const out = redactForExport([entry({ message: 'token ntn_00112233 in url' })]);
    expect(out[0].message).not.toContain('ntn_00112233');
  });

  it('still strips a registered secret passed via `secrets`', () => {
    const secret = 'myCustomApiToken98765';
    const out = redactForExport([entry({ message: `sync using ${secret} ok` })], [secret]);
    expect(out[0].message).not.toContain(secret);
    expect(out[0].message).toContain('***');
  });
});

describe('redactForExport — fields', () => {
  it('redacts PII in field values too, and leaves non-string fields untouched', () => {
    const out = redactForExport([
      entry({
        message: 'roster snapshot',
        fields: { battleTag: 'Karambo#1234', path: 'C:/Users/timos/logs', n: 5, ok: true },
      }),
    ]);
    const fields = out[0].fields!;
    expect(String(fields.battleTag)).not.toMatch(/#\d{4,}/);
    expect(String(fields.path)).toContain('/Users/');
    expect(String(fields.path)).not.toContain('timos');
    expect(fields.n).toBe(5);
    expect(fields.ok).toBe(true);
  });

  it('works fine for an entry with no fields at all', () => {
    const out = redactForExport([entry({ message: 'no fields here' })]);
    expect(out[0].fields).toBeUndefined();
  });
});

describe('redactForExport — defensiveness', () => {
  it('never throws on null/undefined input, returning an empty array', () => {
    expect(() => redactForExport(null)).not.toThrow();
    expect(redactForExport(null)).toEqual([]);
    expect(() => redactForExport(undefined)).not.toThrow();
    expect(redactForExport(undefined)).toEqual([]);
  });

  it('never throws on a malformed entry', () => {
    const weird = [{ ts: 1 }, null, 'not an entry', { ts: 2, level: 'info', scope: 'x', message: 42 }] as unknown as LogEntry[];
    expect(() => redactForExport(weird)).not.toThrow();
    expect(redactForExport(weird)).toHaveLength(4);
  });
});

describe('redactForExport — no over-redaction', () => {
  it('leaves ordinary text with no PII unchanged', () => {
    const msg = 'gep info: match_info.map = Busan';
    expect(redactForExport([entry({ message: msg })])[0].message).toBe(msg);
  });

  it('does not mangle a version-like string that merely contains a hash', () => {
    const msg = 'build 1.2.3#4567 ready';
    expect(redactForExport([entry({ message: msg })])[0].message).toBe(msg);
  });
});

describe('redactPii', () => {
  it('redacts a bare BattleTag outside of any JSON', () => {
    const out = redactPii('gep info: game_info.battle_tag = Karambo#1234');
    expect(out).not.toContain('Karambo#1234');
    expect(out).not.toMatch(/#\d{4,}/);
  });

  it('redacts a name-keyed JSON value even with no #discriminator', () => {
    const out = redactPii('{"player_name":"Someone","hero_name":"MERCY"}');
    expect(out).not.toContain('Someone');
    expect(out).toContain('hero_name');
    expect(out).toContain('MERCY');
  });

  it('never throws on non-string input', () => {
    expect(() => redactPii(null as unknown as string)).not.toThrow();
    expect(() => redactPii(undefined as unknown as string)).not.toThrow();
    expect(() => redactPii(123 as unknown as string)).not.toThrow();
  });
});
