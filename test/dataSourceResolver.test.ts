import { describe, it, expect, vi } from 'vitest';
import { resolveDataSourceId } from '../src/notion/dataSourceResolver';

/** A minimal mock of the `@notionhq/client` surface the resolver touches. */
function mockClient(overrides: Partial<Record<string, any>> = {}) {
  return {
    databases: { retrieve: vi.fn() },
    dataSources: { retrieve: vi.fn() },
    ...overrides,
  } as any;
}

describe('resolveDataSourceId', () => {
  it('resolves a database id to its first data source id', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({
      id: 'db-1',
      data_sources: [{ id: 'ds-1', name: 'Gametracker' }],
    });

    const id = await resolveDataSourceId(client, 'db-1');

    expect(client.databases.retrieve).toHaveBeenCalledWith({ database_id: 'db-1' });
    expect(id).toBe('ds-1');
  });

  it('rejects when the database has an empty data_sources list', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({ id: 'db-1', data_sources: [] });

    await expect(resolveDataSourceId(client, 'db-1')).rejects.toThrow(/no visible data sources/);
    expect(client.dataSources.retrieve).not.toHaveBeenCalled();
  });

  it('accepts an id that is already a data source id when databases.retrieve rejects', async () => {
    const client = mockClient();
    client.databases.retrieve.mockRejectedValue(new Error('not a database'));
    client.dataSources.retrieve.mockResolvedValue({ id: 'ds-9', properties: {} });

    const id = await resolveDataSourceId(client, 'ds-9');

    expect(client.dataSources.retrieve).toHaveBeenCalledWith({ data_source_id: 'ds-9' });
    expect(id).toBe('ds-9');
  });

  it('rejects with the original databases.retrieve error when both retrieves fail', async () => {
    const client = mockClient();
    client.databases.retrieve.mockRejectedValue(new Error('nope'));
    client.dataSources.retrieve.mockRejectedValue(new Error('nope either'));

    await expect(resolveDataSourceId(client, 'bogus-id')).rejects.toThrow('nope');
  });
});
