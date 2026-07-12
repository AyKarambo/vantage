import { describe, it, expect } from 'vitest';
import {
  REQUIRED_PROPERTIES, buildGametrackerProperties, validateGametrackerShape,
  hasPlayedAtColumn, PLAYED_AT_PROPERTY, hasSrDeltaColumn, SR_DELTA_PROPERTY,
  presentSubjectiveColumns, mapRelationSourceId, diagnoseSubjectiveColumns,
  OPTIONAL_SUBJECTIVE_PROPERTIES, PROVISIONABLE_PROPERTIES, expectedTypeOf,
  planColumnProvision, subjectiveSelectOptions, noneLikeOption,
} from '../src/notion/gametrackerSchema';

describe('buildGametrackerProperties', () => {
  it('includes every REQUIRED_PROPERTIES entry with the matching Notion type', () => {
    const props = buildGametrackerProperties('maps-ds-id');
    for (const [name, type] of Object.entries(REQUIRED_PROPERTIES)) {
      expect(props).toHaveProperty(name);
      expect(props[name]).toHaveProperty(type);
    }
  });

  it('includes the Map relation only when a maps data source id is given', () => {
    expect(buildGametrackerProperties('maps-ds-id')).toHaveProperty('Map');
    expect(buildGametrackerProperties()).not.toHaveProperty('Map');
  });

  it('builds the Map relation from a data source id, single_property', () => {
    const props: any = buildGametrackerProperties('maps-ds-id');
    expect(props['Map']).toEqual({ relation: { data_source_id: 'maps-ds-id', single_property: {} } });
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
    const props = asRetrievedShape(buildGametrackerProperties('maps-ds-id'));
    delete props[PLAYED_AT_PROPERTY];
    expect(validateGametrackerShape(props, { requireMapRelation: true }).ok).toBe(true);
  });

  it('includes the optional SR Delta number column for new databases', () => {
    expect(buildGametrackerProperties()).toHaveProperty(SR_DELTA_PROPERTY);
    expect((buildGametrackerProperties() as any)[SR_DELTA_PROPERTY]).toHaveProperty('number');
  });

  it('does not require SR Delta (legacy databases without it still validate)', () => {
    expect(REQUIRED_PROPERTIES).not.toHaveProperty(SR_DELTA_PROPERTY);
    const props = asRetrievedShape(buildGametrackerProperties('maps-ds-id'));
    delete props[SR_DELTA_PROPERTY];
    expect(validateGametrackerShape(props, { requireMapRelation: true }).ok).toBe(true);
  });
});

describe('hasSrDeltaColumn', () => {
  it('is true only when an SR Delta number column is present', () => {
    expect(hasSrDeltaColumn(asRetrievedShape(buildGametrackerProperties('maps-ds-id')))).toBe(true);
    expect(hasSrDeltaColumn({ [SR_DELTA_PROPERTY]: { type: 'rich_text' } })).toBe(false); // wrong type
    expect(hasSrDeltaColumn({})).toBe(false); // absent
  });
});

describe('hasPlayedAtColumn', () => {
  it('is true only when a Played At date column is present', () => {
    expect(hasPlayedAtColumn(asRetrievedShape(buildGametrackerProperties('maps-ds-id')))).toBe(true);
    expect(hasPlayedAtColumn({ [PLAYED_AT_PROPERTY]: { type: 'rich_text' } })).toBe(false); // wrong type
    expect(hasPlayedAtColumn({})).toBe(false); // absent
  });
});

describe('validateGametrackerShape', () => {
  it('round-trips: a freshly built schema validates ok (with a maps id)', () => {
    const props = asRetrievedShape(buildGametrackerProperties('maps-ds-id'));
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
    const props = asRetrievedShape(buildGametrackerProperties('maps-ds-id'));
    delete props['Result'];
    const result = validateGametrackerShape(props, { requireMapRelation: true });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('Result');
  });

  it('lists a type mismatch', () => {
    const props = asRetrievedShape(buildGametrackerProperties('maps-ds-id'));
    props['Eliminations'] = { type: 'rich_text' };
    const result = validateGametrackerShape(props, { requireMapRelation: true });
    expect(result.ok).toBe(false);
    expect(result.mismatched).toContain('Eliminations');
  });

  it('tolerates extra user columns (e.g. Leaver/Comms/Tilt)', () => {
    const props = asRetrievedShape(buildGametrackerProperties('maps-ds-id'));
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

describe('diagnoseSubjectiveColumns', () => {
  it('classifies a correctly-typed select column as available', () => {
    const props = { Comms: { type: 'select' } };
    const diags = diagnoseSubjectiveColumns(props);
    expect(diags.find((d) => d.column === 'Comms')).toEqual({ column: 'Comms', status: 'available' });
  });

  it('classifies Comms as wrong-type with actualType when present as rich_text', () => {
    const props = { Comms: { type: 'rich_text' } };
    const diags = diagnoseSubjectiveColumns(props);
    expect(diags.find((d) => d.column === 'Comms')).toEqual({
      column: 'Comms', status: 'wrong-type', actualType: 'rich_text',
    });
  });

  it('classifies a trailing-space near-miss name with actualName', () => {
    const props = { 'comms ': { type: 'select' } };
    const diags = diagnoseSubjectiveColumns(props);
    expect(diags.find((d) => d.column === 'Comms')).toEqual({
      column: 'Comms', status: 'near-miss', actualName: 'comms ',
    });
  });

  it('classifies a wrong-case near-miss name with actualName', () => {
    const props = { 'improvement target': { type: 'select' } };
    const diags = diagnoseSubjectiveColumns(props);
    expect(diags.find((d) => d.column === 'Improvement Target')).toEqual({
      column: 'Improvement Target', status: 'near-miss', actualName: 'improvement target',
    });
  });

  it('classifies an absent column with no near-miss as missing', () => {
    const diags = diagnoseSubjectiveColumns({});
    expect(diags.find((d) => d.column === 'Leaver')).toEqual({ column: 'Leaver', status: 'missing' });
  });

  it('returns one diagnostic per OPTIONAL_SUBJECTIVE_PROPERTIES entry', () => {
    const diags = diagnoseSubjectiveColumns({});
    expect(diags.map((d) => d.column).sort()).toEqual(Object.keys(OPTIONAL_SUBJECTIVE_PROPERTIES).sort());
  });

  it('does not report an exact-name match as a near-miss of itself', () => {
    const props = { Tilt: { type: 'checkbox' } };
    const diags = diagnoseSubjectiveColumns(props);
    expect(diags.find((d) => d.column === 'Tilt')).toEqual({ column: 'Tilt', status: 'available' });
  });
});

describe('PROVISIONABLE_PROPERTIES manifest', () => {
  it('excludes the Name title and the Map relation (not additively creatable)', () => {
    expect(PROVISIONABLE_PROPERTIES).not.toHaveProperty('Name');
    expect(PROVISIONABLE_PROPERTIES).not.toHaveProperty('Map');
  });

  it('includes every REQUIRED_PROPERTIES entry except Name/Map, with the matching type', () => {
    for (const [name, type] of Object.entries(REQUIRED_PROPERTIES)) {
      if (name === 'Name' || name === 'Map') continue;
      expect(PROVISIONABLE_PROPERTIES).toHaveProperty(name);
      expect(expectedTypeOf(PROVISIONABLE_PROPERTIES[name])).toBe(type);
    }
  });

  it('includes the optional Played At / SR Delta columns with their types', () => {
    expect(expectedTypeOf(PROVISIONABLE_PROPERTIES[PLAYED_AT_PROPERTY])).toBe('date');
    expect(expectedTypeOf(PROVISIONABLE_PROPERTIES[SR_DELTA_PROPERTY])).toBe('number');
  });

  it('includes every subjective column with its expected type', () => {
    for (const [name, type] of Object.entries(OPTIONAL_SUBJECTIVE_PROPERTIES)) {
      expect(PROVISIONABLE_PROPERTIES).toHaveProperty(name);
      expect(expectedTypeOf(PROVISIONABLE_PROPERTIES[name])).toBe(type);
    }
  });

  it('keeps Source/Result/Role select options pre-seeded (matches the writer)', () => {
    const src = PROVISIONABLE_PROPERTIES['Source'] as any;
    expect(src.select.options.map((o: any) => o.name)).toEqual(['Auto', 'Manual']);
  });
});

describe('planColumnProvision', () => {
  it('is empty (no writes) when every expected column is already present — idempotent (AC3)', () => {
    const live = asRetrievedShape(PROVISIONABLE_PROPERTIES);
    const plan = planColumnProvision(live);
    expect(plan.toCreate).toEqual({});
    expect(plan.blocked).toEqual([]);
  });

  it('ignores extra unrelated user columns around a complete schema (AC3)', () => {
    const live = asRetrievedShape(PROVISIONABLE_PROPERTIES);
    live['My Notes'] = { type: 'rich_text' };
    live['Priority'] = { type: 'select' };
    expect(planColumnProvision(live).toCreate).toEqual({});
  });

  it('plans every provisionable column when the database is empty, none blocked (AC2)', () => {
    const plan = planColumnProvision({});
    expect(Object.keys(plan.toCreate).sort()).toEqual(Object.keys(PROVISIONABLE_PROPERTIES).sort());
    expect(plan.blocked).toEqual([]);
  });

  it('plans exactly the one missing optional column with its payload (AC1)', () => {
    const live = asRetrievedShape(PROVISIONABLE_PROPERTIES);
    delete live[SR_DELTA_PROPERTY];
    const plan = planColumnProvision(live);
    expect(Object.keys(plan.toCreate)).toEqual([SR_DELTA_PROPERTY]);
    expect(plan.toCreate[SR_DELTA_PROPERTY]).toEqual(PROVISIONABLE_PROPERTIES[SR_DELTA_PROPERTY]);
    expect(plan.blocked).toEqual([]);
  });

  it('blocks a wrong-typed column — never creates over it (AC4)', () => {
    const live = asRetrievedShape(PROVISIONABLE_PROPERTIES);
    live['Comms'] = { type: 'rich_text' };
    const plan = planColumnProvision(live);
    expect(plan.toCreate).not.toHaveProperty('Comms');
    expect(plan.blocked).toContainEqual({ column: 'Comms', status: 'wrong-type', actualType: 'rich_text' });
  });

  it('blocks a near-miss name — never creates a confusing duplicate (AC4)', () => {
    const live = asRetrievedShape(PROVISIONABLE_PROPERTIES);
    delete live[SR_DELTA_PROPERTY];
    live['sr delta'] = { type: 'number' };
    const plan = planColumnProvision(live);
    expect(plan.toCreate).not.toHaveProperty(SR_DELTA_PROPERTY);
    expect(plan.blocked).toContainEqual({ column: SR_DELTA_PROPERTY, status: 'near-miss', actualName: 'sr delta' });
  });
});

describe('mapRelationSourceId', () => {
  it('prefers the data_source_id when present', () => {
    expect(mapRelationSourceId({
      Map: { type: 'relation', relation: { data_source_id: 'maps-ds', database_id: 'maps-db' } },
    })).toBe('maps-ds');
  });

  it('falls back to database_id when data_source_id is absent', () => {
    expect(mapRelationSourceId({ Map: { type: 'relation', relation: { database_id: 'maps-db' } } })).toBe('maps-db');
  });

  it('is undefined when Map is absent or not a relation', () => {
    expect(mapRelationSourceId({})).toBeUndefined();
    expect(mapRelationSourceId({ Map: { type: 'rich_text' } })).toBeUndefined();
  });
});

describe('subjectiveSelectOptions', () => {
  it('extracts option names verbatim for subjective SELECT columns, keyed by canonical name', () => {
    const props = {
      Comms: { type: 'select', select: { options: [{ name: 'positive' }, { name: 'None' }] } },
      'Improvement Target': { type: 'select', select: { options: [{ name: 'hit' }, { name: 'N/A' }] } },
    };
    expect(subjectiveSelectOptions(props)).toEqual({
      Comms: ['positive', 'None'],
      'Improvement Target': ['hit', 'N/A'],
    });
  });

  it('ignores a subjective column that is present but not a select (guards on type)', () => {
    const props = {
      Comms: { type: 'rich_text' }, // wrong type — no options to read
      Tilt: { type: 'checkbox' }, // not a select-typed subjective column
    };
    expect(subjectiveSelectOptions(props)).toEqual({});
  });

  it('emits an empty option list for a select with no options', () => {
    expect(subjectiveSelectOptions({ Comms: { type: 'select' } })).toEqual({ Comms: [] });
    expect(subjectiveSelectOptions({ Comms: { type: 'select', select: { options: [] } } })).toEqual({ Comms: [] });
  });
});

describe('noneLikeOption', () => {
  it('finds an option named "none" case-insensitively and returns it verbatim', () => {
    expect(noneLikeOption(['positive', 'None'])).toBe('None');
    expect(noneLikeOption(['NONE'])).toBe('NONE');
    expect(noneLikeOption([' none '])).toBe(' none '); // trimmed for the match, returned verbatim
  });

  it('returns the first none-like option when several are present', () => {
    expect(noneLikeOption(['None', 'none'])).toBe('None');
  });

  it('is undefined when no option is a plain "none" (never matches n/a, no, etc.)', () => {
    expect(noneLikeOption(['positive', 'abusive'])).toBeUndefined();
    expect(noneLikeOption(['N/A', 'no'])).toBeUndefined();
    expect(noneLikeOption([])).toBeUndefined();
    expect(noneLikeOption(undefined)).toBeUndefined();
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
