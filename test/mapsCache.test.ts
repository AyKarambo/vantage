import { describe, it, expect, vi } from 'vitest';
import { MapsCache } from '../src/notion/mapsCache';

function mockClient(overrides: Partial<Record<string, any>> = {}) {
  return {
    databases: { query: vi.fn() },
    ...overrides,
  } as any;
}

describe('MapsCache', () => {
  it('resolves against a loaded database', async () => {
    const client = mockClient();
    client.databases.query.mockResolvedValue({
      results: [{ id: 'page-1', properties: { Name: { type: 'title', title: [{ plain_text: "King's Row" }] } } }],
      has_more: false,
      next_cursor: null,
    });
    const cache = new MapsCache(client, 'maps-db-id');
    const match = await cache.resolve("King's Row");
    expect(match).toEqual({ matched: true, pageId: 'page-1', notionName: "King's Row" });
  });

  it('tolerates an empty mapsDatabaseId, returning unmatched instead of throwing', async () => {
    const client = mockClient();
    const cache = new MapsCache(client, '');
    const match = await cache.resolve("King's Row");
    expect(match).toEqual({ matched: false });
    expect(client.databases.query).not.toHaveBeenCalled();
  });
});
