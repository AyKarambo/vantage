import { describe, it, expect, vi } from 'vitest';
import { MapsCache } from '../src/notion/mapsCache';

function mockClient(overrides: Partial<Record<string, any>> = {}) {
  return {
    databases: { retrieve: vi.fn() },
    dataSources: { query: vi.fn(), retrieve: vi.fn() },
    ...overrides,
  } as any;
}

describe('MapsCache', () => {
  it('resolves the configured database id to its data source, then queries it', async () => {
    const client = mockClient();
    client.databases.retrieve.mockResolvedValue({ data_sources: [{ id: 'maps-ds-id' }] });
    client.dataSources.query.mockResolvedValue({
      results: [{ id: 'page-1', properties: { Name: { type: 'title', title: [{ plain_text: "King's Row" }] } } }],
      has_more: false,
      next_cursor: null,
    });
    const cache = new MapsCache(client, 'maps-db-id');
    const match = await cache.resolve("King's Row");

    expect(client.databases.retrieve).toHaveBeenCalledWith({ database_id: 'maps-db-id' });
    expect(client.dataSources.query).toHaveBeenCalledWith(expect.objectContaining({ data_source_id: 'maps-ds-id' }));
    expect(match).toEqual({ matched: true, pageId: 'page-1', notionName: "King's Row" });
  });

  it('accepts a configured id that is already a data source id', async () => {
    const client = mockClient();
    client.databases.retrieve.mockRejectedValue(new Error('not a database'));
    client.dataSources.retrieve.mockResolvedValue({ id: 'maps-ds-id' });
    client.dataSources.query.mockResolvedValue({
      results: [{ id: 'page-1', properties: { Name: { type: 'title', title: [{ plain_text: 'Ilios' }] } } }],
      has_more: false,
      next_cursor: null,
    });
    const cache = new MapsCache(client, 'maps-ds-id');
    const match = await cache.resolve('Ilios');

    expect(match).toEqual({ matched: true, pageId: 'page-1', notionName: 'Ilios' });
  });

  it('tolerates an empty mapsDatabaseId, returning unmatched instead of throwing', async () => {
    const client = mockClient();
    const cache = new MapsCache(client, '');
    const match = await cache.resolve("King's Row");
    expect(match).toEqual({ matched: false });
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it('load() rejects when the id cannot be resolved', async () => {
    const client = mockClient();
    client.databases.retrieve.mockRejectedValue(new Error('nope'));
    client.dataSources.retrieve.mockRejectedValue(new Error('nope either'));
    const cache = new MapsCache(client, 'bogus-id');
    await expect(cache.load()).rejects.toThrow('nope');
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });
});
