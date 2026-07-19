import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/mcp/server';
import { registerReadTools } from '../src/mcp/readTools';
import { McpBridgeError, type PipeClient } from '../src/mcp/pipeClient';
import { READ_OPS } from '../src/shared/mcp/ops';

/**
 * Drives the bridge through a REAL MCP client over an in-memory transport, so
 * these assertions cover what a coach actually sees — the advertised tool list
 * and annotations, the resource, and how failures are surfaced — rather than
 * the server's internals.
 */

type Handler = (op: string, args: unknown) => unknown;

function fakeClient(handler: Handler): PipeClient {
  return { call: (async (op: string, args: unknown) => handler(op, args)) as PipeClient['call'] };
}

async function connect(handler: Handler): Promise<Client> {
  const server = buildServer(fakeClient(handler), [registerReadTools]);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Tool results are JSON-in-text; parse the first text block back out. */
function payload(res: { content?: unknown }): unknown {
  const first = (res.content as { type: string; text: string }[])[0];
  return JSON.parse(first.text);
}

const echo: Handler = (op, args) => ({ demo: false, data: { op, args } });

describe('the advertised read surface', () => {
  it('exposes exactly one tool per read op', async () => {
    const client = await connect(echo);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'vantage_dashboard', 'vantage_hero_detail', 'vantage_master_data', 'vantage_match_detail',
      'vantage_player_history', 'vantage_ranks', 'vantage_status',
    ]);
    expect(names).toHaveLength(READ_OPS.length);
  });

  it('annotates every read tool as read-only and closed-world', async () => {
    const client = await connect(echo);
    for (const tool of (await client.listTools()).tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      // Nothing here reaches outside the machine — the data is local-only.
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
  });

  it('gives every tool a description the model can choose from', async () => {
    const client = await connect(echo);
    for (const tool of (await client.listTools()).tools) {
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(20);
    }
  });
});

describe('read tools reach the right op', () => {
  it('forwards arguments through to the bridge call', async () => {
    const client = await connect(echo);
    const res = await client.callTool({
      name: 'vantage_hero_detail',
      arguments: { hero: 'Tracer', filters: { role: 'damage' } },
    });
    expect(payload(res)).toEqual({
      demo: false,
      data: { op: 'heroDetail', args: { hero: 'Tracer', filters: { role: 'damage' } } },
    });
  });

  it('omits filters cleanly when not supplied', async () => {
    const client = await connect(echo);
    const res = await client.callTool({ name: 'vantage_dashboard', arguments: {} });
    // `filters: undefined` serialises away entirely — the app then applies its
    // default window, which is what an unfiltered "how am I doing?" should get.
    expect(payload(res)).toMatchObject({ data: { op: 'dashboard', args: {} } });
  });

  it('surfaces the demo flag so sample data cannot pass as real', async () => {
    const client = await connect(() => ({ demo: true, data: [] }));
    const res = await client.callTool({ name: 'vantage_ranks', arguments: {} });
    expect(payload(res)).toMatchObject({ demo: true });
  });

  it('passes roster BattleTags through unredacted', async () => {
    // The user's own recorded data, read by a local client — spec decision.
    const client = await connect(() => ({ demo: false, data: { roster: ['Karambo#2154', 'Ana#1234'] } }));
    const res = await client.callTool({ name: 'vantage_player_history', arguments: { name: 'Ana#1234' } });
    expect(payload(res)).toMatchObject({ data: { roster: ['Karambo#2154', 'Ana#1234'] } });
  });
});

describe('failures reach the model as answerable conditions', () => {
  it('reports a not-running bridge as isError with actionable text', async () => {
    const client = await connect(() => {
      throw new McpBridgeError('not-running', 'Could not reach Vantage. Make sure it is running.');
    });
    const res = await client.callTool({ name: 'vantage_ranks', arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0].text;
    expect(text).toMatch(/Could not reach Vantage/);
    expect(text).toMatch(/\[not-running\]/);
  });

  it('rejects a call missing a required argument', async () => {
    const client = await connect(echo);
    const res = await client.callTool({ name: 'vantage_hero_detail', arguments: {} });
    expect(res.isError).toBe(true);
  });
});

describe('the dashboard resource', () => {
  it('is advertised at vantage://dashboard', async () => {
    const client = await connect(echo);
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain('vantage://dashboard');
  });

  it('returns the snapshot including the demo flag', async () => {
    const client = await connect(() => ({ demo: true, data: { games: 12 } }));
    const res = await client.readResource({ uri: 'vantage://dashboard' });
    expect(JSON.parse(res.contents[0].text as string)).toEqual({ demo: true, data: { games: 12 } });
  });

  it('explains itself rather than blowing up when the app is down', async () => {
    const client = await connect(() => { throw new McpBridgeError('not-running', 'Vantage is not running.'); });
    const res = await client.readResource({ uri: 'vantage://dashboard' });
    expect(res.contents[0].text).toMatch(/not running/i);
  });
});
