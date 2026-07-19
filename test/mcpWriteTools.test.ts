import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/mcp/server';
import { registerReadTools } from '../src/mcp/readTools';
import { registerWriteTools } from '../src/mcp/writeTools';
import { McpBridgeError, type PipeClient } from '../src/mcp/pipeClient';
import { ADDITIVE_WRITE_OPS, DESTRUCTIVE_OPS } from '../src/shared/mcp/ops';

/**
 * The write surface, driven through a real MCP client.
 *
 * The annotations are the load-bearing part: `destructiveHint: true` is what
 * makes an MCP client prompt the user before running a tool, and that prompt —
 * not the `confirm` argument — is the thing that actually puts a human in the
 * loop. So these tests check the annotations as carefully as the behaviour.
 */

type Handler = (op: string, args: unknown) => unknown;
const calls: { op: string; args: unknown }[] = [];

function fakeClient(handler: Handler): PipeClient {
  return {
    call: (async (op: string, args: unknown) => {
      calls.push({ op, args });
      return handler(op, args);
    }) as PipeClient['call'],
  };
}

async function connect(handler: Handler = () => null): Promise<Client> {
  calls.length = 0;
  const server = buildServer(fakeClient(handler), [registerReadTools, registerWriteTools]);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

const DESTRUCTIVE_TOOLS = [
  'vantage_delete_target', 'vantage_dismiss_pending',
  'vantage_deactivate_all_targets', 'vantage_clear_review',
];
const ADDITIVE_TOOLS = [
  'vantage_log_match', 'vantage_edit_match', 'vantage_save_review', 'vantage_save_target',
  'vantage_update_target', 'vantage_set_target_active', 'vantage_set_target_archived',
  'vantage_resolve_pending',
];

describe('the advertised write surface', () => {
  it('exposes one tool per write op, and no more', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [...ADDITIVE_TOOLS, ...DESTRUCTIVE_TOOLS]) expect(names).toContain(n);
    expect(ADDITIVE_TOOLS).toHaveLength(ADDITIVE_WRITE_OPS.length);
    expect(DESTRUCTIVE_TOOLS).toHaveLength(DESTRUCTIVE_OPS.length);
  });

  it('marks additive tools non-destructive', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    for (const name of ADDITIVE_TOOLS) {
      const t = tools.find((x) => x.name === name);
      expect(t?.annotations?.readOnlyHint, name).toBe(false);
      expect(t?.annotations?.destructiveHint, name).toBe(false);
    }
  });

  it('marks irreversible tools destructive, so the client prompts the user', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    for (const name of DESTRUCTIVE_TOOLS) {
      const t = tools.find((x) => x.name === name);
      expect(t?.annotations?.destructiveHint, name).toBe(true);
      expect(t?.annotations?.readOnlyHint, name).toBe(false);
    }
  });

  it('requires a confirm argument on every destructive tool', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    for (const name of DESTRUCTIVE_TOOLS) {
      const schema = tools.find((x) => x.name === name)?.inputSchema as {
        properties?: Record<string, unknown>; required?: string[];
      };
      expect(schema?.properties, name).toHaveProperty('confirm');
      expect(schema?.required, name).toContain('confirm');
    }
  });

  it('never exposes an out-of-scope operation', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).join(' ');
    for (const forbidden of ['notion', 'token', 'dev_key', 'devkey', 'data_folder', 'delete_account', 'log_bundle', 'export']) {
      expect(names.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('additive writes', () => {
  it('forwards a logged match to the logMatch op', async () => {
    const client = await connect(() => ({ matchId: 'new-1' }));
    await client.callTool({
      name: 'vantage_log_match',
      arguments: { input: { result: 'Win', role: 'damage', map: "King's Row", gameType: 'Competitive' } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe('logMatch');
    expect(calls[0].args).toMatchObject({ input: { result: 'Win', map: "King's Row" } });
  });

  it('rejects an invalid result before it reaches the bridge', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'vantage_log_match',
      arguments: { input: { result: 'Victory', role: 'damage', map: 'A', gameType: 'Competitive' } },
    });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('rejects an out-of-range performance rating', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'vantage_log_match',
      arguments: {
        input: { result: 'Win', role: 'damage', map: 'A', gameType: 'Competitive', performance: 140 },
      },
    });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('needs no confirmation', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'vantage_set_target_active',
      arguments: { id: 't-1', active: false },
    });
    expect(res.isError).toBeFalsy();
    expect(calls[0]).toMatchObject({ op: 'setTargetActive', args: { id: 't-1', active: false } });
  });
});

describe('destructive writes', () => {
  it('cannot be called without confirm at all', async () => {
    const client = await connect();
    for (const name of DESTRUCTIVE_TOOLS) {
      const res = await client.callTool({ name, arguments: { id: 't-1', matchId: 'm-1' } });
      expect(res.isError, name).toBe(true);
    }
    expect(calls).toHaveLength(0);
  });

  it('passes confirm through to the app, which owns the final gate', async () => {
    const client = await connect();
    await client.callTool({ name: 'vantage_delete_target', arguments: { id: 't-1', confirm: true } });
    expect(calls[0]).toMatchObject({ op: 'deleteTarget', args: { id: 't-1', confirm: true } });
  });

  it('surfaces the app refusing an unconfirmed op', async () => {
    // confirm:false is schema-valid, so it reaches the app — which is exactly
    // where the needs-confirmation verdict belongs.
    const client = await connect(() => {
      throw new McpBridgeError('needs-confirmation', '`deleteTarget` needs explicit confirmation.');
    });
    const res = await client.callTool({
      name: 'vantage_delete_target',
      arguments: { id: 't-1', confirm: false },
    });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toMatch(/needs-confirmation/);
  });

  it('steers toward the reversible alternative where one exists', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    const del = tools.find((t) => t.name === 'vantage_delete_target');
    expect(del?.description).toMatch(/archiv/i);
  });
});
