import { describe, it, expect } from 'vitest';
import {
  REQUIRED_PROPERTIES, buildGametrackerProperties, validateGametrackerShape,
  hasPlayedAtColumn, PLAYED_AT_PROPERTY, presentSubjectiveColumns, mapRelationDatabaseId,
} from '../src/notion/gametrackerSchema';

describe('buildGametrackerProperties', () => {
  it('includes every REQUIRED_PROPERTIES entry with the matching Notion type', () => {
    const props = buildGametrackerProperties('maps-db-id');
    for (const [name, type] of Object.entries(REQUIRED_PROPERTIES)) {
      expect(props).toHaveProperty(name);
      expect(props[name]).toHaveProperty(type);
    }
  });

  it('includes the Map relation only when a maps database id is given', () => {
    expect(buildGametrackerProperties('maps-db-id')).toHaveProperty('Map');
    expect(buildGametrackerProperties()).not.toHaveProperty('Map');
  });

  it('pre-seeds Source/Result/Role select options', () => {
    const props = buildGametrackerProperties() as any;
    expect(props.Source.select.options.map((o: any) => o.name)).toEqual(['Auto', 'Manual']);
    expect(props.Result.select.options.map((o: any) => o.name)).toEqual(['Win', 'Loss', 'Draw']);
    expect(props.Role.select.options.map((o: any) => o.name)).toEqual(['tank', 'damage', 'support', 'openQ']);
  });

  it('includes the optional Played At date column for new databases', () => {
    expect(buildGametrackerProperties()).toHaveProperty(PLAYED_AT_PROPERTY);
    expect((buildGametrackerProperties() as any)[PLAYED_AT_PROPERTY]).toHaveProperty('date');
  });

  it('does not require Played At (legacy databases without it still validate)', () => {
    // Not part of the shape contract — a DB missing it is neither missing nor mismatched.
    expect(REQUIRED_PROPERTIES).not.toHaveProperty(PLAYED_AT_PROPERTY);
    const props = asRetrievedShape(buildGametrackerProperties('maps-db-id'));
    delete props[PLAYED_AT_PROPERTY];
    expect(validateGametrackerShape(props, { requireMapRelation: true }).ok).toBe(true);
  });
});

describe('hasPlayedAtColumn', () => {
  it('is true only when a Played At date column is present', () => {
    expect(hasPlayedAtColumn(asRetrievedShape(buildGametrackerProperties('maps-db-id')))).toBe(true);
    expect(hasPlayedAtColumn({ [PLAYED_AT_PROPERTY]: { type: 'rich_text' } })).toBe(false); // wrong type
    expect(hasPlayedAtColumn({})).toBe(false); // absent
  });
});

describe('validateGametrackerShape', () => {
  it('round-trips: a freshly built schema validates ok (with a maps id)', () => {
    const props = asRetrievedShape(buildGametrackerProperties('maps-db-id'));
    const result = validateGametrackerShape(props, { requireMapRelation: true });
    expect(result).toEqual({ ok: true, missing: [], mismatched: [] });
  });

  it('round-trips: a schema built without a maps id validates ok when Map is not required', () => {
    const props = asRetrievedShape(buildGametrackerProperties());
    const result = validateGametrackerShape(props, { requireMapRelation: false });
    expect(result).toEqual({ ok: true, missing: [], mismatched: [] });
  });

  it('requires Map only when requireMapRelation is set (defaults to required)', () => {
    const props = asRetrievedShape(buildGametrackerProperties());
    const result = validateGametrackerShape(props);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('Map');
  });

  it('lists a missing property', () => {
    const props = asRetrievedShape(buildGametrackerProperties('maps-db-id'));
    delete props['Result'];
    const result = validateGametrackerShape(props, { requireMapRelation: true });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('Result');
  });

  it('lists a type mismatch', () => {
    const props = asRetrievedShape(buildGametrackerProperties('maps-db-id'));
    props['Eliminations'] = { type: 'rich_text' };
    const result = validateGametrackerShape(props, { requireMapRelation: true });
    expect(result.ok).toBe(false);
    expect(result.mismatched).toContain('Eliminations');
  });

  it('tolerates extra user columns (e.g. Leaver/Comms/Tilt)', () => {
    const props = asRetrievedShape(buildGametrackerProperties('maps-db-id'));
    props['Tilt'] = { type: 'checkbox' };
    props['Comms'] = { type: 'checkbox' };
    const result = validateGametrackerShape(props, { requireMapRelation: true });
    expect(result.ok).toBe(true);
  });
});

describe('presentSubjectiveColumns', () => {
  it('lists the subjective columns present with the expected type', () => {
    const props = {
      Comms: { type: 'select' },
      'Improvement Target': { type: 'select' },
      Leaver: { type: 'select' },
      Tilt: { type: 'checkbox' },
      'Toxic Mates': { type: 'checkbox' },
    };
    expect(presentSubjectiveColumns(props).sort()).toEqual(
      ['Comms', 'Improvement Target', 'Leaver', 'Tilt', 'Toxic Mates'].sort(),
    );
  });

  it('ignores wrong-typed and absent columns (they would fail pages.create)', () => {
    expect(presentSubjectiveColumns({ Comms: { type: 'rich_text' }, Tilt: { type: 'checkbox' } })).toEqual(['Tilt']);
    expect(presentSubjectiveColumns({})).toEqual([]);
  });
});

describe('mapRelationDatabaseId', () => {
  it('returns the relation target when Map is a relation', () => {
    expect(mapRelationDatabaseId({ Map: { type: 'relation', relation: { database_id: 'maps-db' } } })).toBe('maps-db');
  });

  it('is undefined when Map is absent or not a relation', () => {
    expect(mapRelationDatabaseId({})).toBeUndefined();
    expect(mapRelationDatabaseId({ Map: { type: 'rich_text' } })).toBeUndefined();
  });
});

/**
 * Simulate what `databases.retrieve` returns: each property build payload
 * (e.g. `{ title: {} }`) becomes `{ type: 'title', title: {} }` on the way back.
 */
function asRetrievedShape(built: Record<string, unknown>): Record<string, { type?: string }> {
  const result: Record<string, { type?: string }> = {};
  for (const [name, value] of Object.entries(built)) {
    const type = Object.keys(value as Record<string, unknown>)[0];
    result[name] = { type, ...(value as Record<string, unknown>) };
  }
  return result;
}
