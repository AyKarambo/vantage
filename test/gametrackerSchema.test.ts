import { describe, it, expect } from 'vitest';
import {
  REQUIRED_PROPERTIES, buildGametrackerProperties, validateGametrackerShape,
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
