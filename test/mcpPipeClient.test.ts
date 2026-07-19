import { describe, it, expect, afterEach } from 'vitest';
import { createPipeClient, McpBridgeError, NOT_RUNNING_MESSAGE } from '../src/mcp/pipeClient';
import { createPipeServer, type PipeServer } from '../src/main/mcp/pipeServer';
import { McpOpError } from '../src/main/mcp/dispatch';
import { pipePath } from '../src/shared/mcp/pipe';

/**
 * The bridge's side of the pipe. The case that matters most is the unhappy
 * one: the user quits Vantage (or never enabled the endpoint) while their MCP
 * client keeps running, and every tool must then fail with a clear, actionable
 * `not-running` rather than hanging or leaking a socket error. AC 13.
 */

let servers: PipeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  servers = [];
});

let seq = 0;
function addressFor(): string {
  seq += 1;
  return pipePath(`vantage-client-${process.pid}-${seq}`);
}

function serverAt(path: string, dispatch: (op: string, args: unknown) => unknown): PipeServer {
  const server = createPipeServer({ path, dispatch: dispatch as never });
  servers.push(server);
  return server;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  try { await fn(); return undefined; } catch (err) {
    return err instanceof McpBridgeError ? err.code : `unexpected:${String(err)}`;
  }
}

describe('when Vantage is not reachable', () => {
  it('reports not-running rather than a raw socket error', async () => {
    const client = createPipeClient({ path: addressFor(), timeoutMs: 2000 });
    expect(await codeOf(() => client.call('ranks', {}))).toBe('not-running');
  });

  it('explains BOTH causes, since they are indistinguishable from here', async () => {
    // App closed and endpoint-disabled look identical to a client that cannot
    // connect. Naming only one would send the user to the wrong fix.
    const client = createPipeClient({ path: addressFor(), timeoutMs: 2000 });
    try {
      await client.call('ranks', {});
      throw new Error('should have rejected');
    } catch (err) {
      const message = (err as McpBridgeError).message;
      expect(message).toBe(NOT_RUNNING_MESSAGE);
      expect(message).toMatch(/running/i);
      expect(message).toMatch(/enabled|Settings/i);
    }
  });

  it('reports not-running when the endpoint is switched off mid-session', async () => {
    const path = addressFor();
    const server = serverAt(path, () => ({ ok: true }));
    await server.setEnabled(true);
    const client = createPipeClient({ path, timeoutMs: 2000 });
    expect(await client.call('ranks', {})).toEqual({ ok: true });

    await server.setEnabled(false);
    expect(await codeOf(() => client.call('ranks', {}))).toBe('not-running');
  });
});

describe('when Vantage is reachable', () => {
  it('round-trips a call and returns the result', async () => {
    const path = addressFor();
    const server = serverAt(path, (op, args) => ({ op, args }));
    await server.setEnabled(true);
    const client = createPipeClient({ path, timeoutMs: 2000 });
    expect(await client.call('heroDetail', { hero: 'Tracer' })).toEqual({
      op: 'heroDetail',
      args: { hero: 'Tracer' },
    });
  });

  it('propagates the app-side error code', async () => {
    const path = addressFor();
    const server = serverAt(path, () => { throw new McpOpError('demo-mode', 'demo is on'); });
    await server.setEnabled(true);
    const client = createPipeClient({ path, timeoutMs: 2000 });
    expect(await codeOf(() => client.call('logMatch', { input: {} } as never))).toBe('demo-mode');
  });

  it('keeps concurrent calls independent', async () => {
    const path = addressFor();
    const server = serverAt(path, (op, args) => ({ op, echo: (args as { n: number }).n }));
    await server.setEnabled(true);
    const client = createPipeClient({ path, timeoutMs: 3000 });
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => client.call('ranks', { n } as never)),
    );
    expect(results.map((r) => (r as { echo: number }).echo)).toEqual([1, 2, 3, 4]);
  });
});
