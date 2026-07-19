import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { createPipeServer, pipePath, type PipeServer } from '../src/main/mcp/pipeServer';
import { McpOpError } from '../src/main/mcp/dispatch';
import { NdjsonBuffer, encodeLine } from '../src/shared/mcp/ndjson';
import type { McpResponse } from '../src/shared/mcp/ops';

/**
 * Integration tests over a real pipe: the server, the NDJSON framing and the
 * dispatcher wired together, exercised by an actual socket client.
 *
 * The two properties that matter most here are negative ones — that no pipe
 * exists while the endpoint is switched off (AC 13/16), and that no TCP port is
 * ever bound (AC 14).
 */

let servers: PipeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  servers = [];
});

let seq = 0;
function uniquePath(): string {
  seq += 1;
  return pipePath(`vantage-test-${process.pid}-${seq}`);
}

/** A server whose dispatcher echoes the op, or throws whatever the test asks for. */
function makeServer(dispatch = (op: string, args: unknown) => ({ op, args })): {
  server: PipeServer; path: string;
} {
  const path = uniquePath();
  const server = createPipeServer({
    path,
    dispatch: dispatch as never,
  });
  servers.push(server);
  return { server, path };
}

/** Connect, send the given lines, and collect responses until `expected` arrive. */
function roundTrip(path: string, lines: string[], expected = 1): Promise<McpResponse[]> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(path);
    const buffer = new NdjsonBuffer();
    const out: McpResponse[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out with ${out.length}/${expected} responses`));
    }, 4000);
    socket.on('connect', () => { for (const l of lines) socket.write(l); });
    socket.on('data', (chunk) => {
      for (const v of buffer.push(chunk).values) out.push(v as McpResponse);
      if (out.length >= expected) {
        clearTimeout(timer);
        socket.end();
        resolve(out);
      }
    });
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

describe('the endpoint only exists when enabled', () => {
  it('does not listen until switched on', async () => {
    const { server, path } = makeServer();
    expect(server.isListening()).toBe(false);
    // Nothing to connect to — not "connected but refused".
    await expect(roundTrip(path, [encodeLine({ id: 1, op: 'ranks' })])).rejects.toThrow();
  });

  it('listens once enabled and stops again when disabled', async () => {
    const { server, path } = makeServer();
    await server.setEnabled(true);
    expect(server.isListening()).toBe(true);
    const [res] = await roundTrip(path, [encodeLine({ id: 1, op: 'ranks' })]);
    expect(res).toMatchObject({ id: 1, ok: true });

    await server.setEnabled(false);
    expect(server.isListening()).toBe(false);
    await expect(roundTrip(path, [encodeLine({ id: 2, op: 'ranks' })])).rejects.toThrow();
  });

  it('is idempotent when enabled twice', async () => {
    const { server } = makeServer();
    await server.setEnabled(true);
    await server.setEnabled(true);
    expect(server.isListening()).toBe(true);
  });

  it('addresses a pipe, never a host:port', () => {
    // The mechanical check behind "nothing listens on a network port": the
    // address the server binds is a pipe/socket path, with no host or port to
    // reach from another machine. The round-trip tests above prove the server
    // actually listens on exactly this address.
    const addr = pipePath('probe');
    expect(addr).not.toMatch(/:\d+$/);
    expect(addr).toMatch(process.platform === 'win32' ? /^\\\\\.\\pipe\\probe$/ : /^\/tmp\/probe\.sock$/);
  });
});

describe('request handling', () => {
  it('round-trips a valid request to the dispatcher', async () => {
    const { server, path } = makeServer((op, args) => ({ saw: op, args }));
    await server.setEnabled(true);
    const [res] = await roundTrip(path, [encodeLine({ id: 42, op: 'dashboard', args: { filters: {} } })]);
    expect(res).toEqual({ id: 42, ok: true, result: { saw: 'dashboard', args: { filters: {} } } });
  });

  it('answers several pipelined requests, preserving ids', async () => {
    const { server, path } = makeServer((op) => ({ op }));
    await server.setEnabled(true);
    const lines = [
      encodeLine({ id: 1, op: 'ranks' }),
      encodeLine({ id: 2, op: 'masterData' }),
      encodeLine({ id: 3, op: 'status' }),
    ];
    const out = await roundTrip(path, [lines.join('')], 3);
    expect(out.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(out.every((r) => r.ok)).toBe(true);
  });

  it('rejects an op that is not in the contract', async () => {
    const { server, path } = makeServer();
    await server.setEnabled(true);
    // The allowlist is the surface boundary — this is how out-of-scope
    // operations (exportNotion, setNotionToken, setDevKey…) stay unreachable.
    const [res] = await roundTrip(path, [encodeLine({ id: 5, op: 'setNotionToken', args: { token: 'x' } })]);
    expect(res).toMatchObject({ id: 5, ok: false, error: { code: 'invalid-input' } });
  });

  it('maps a classified McpOpError to its code', async () => {
    const { server, path } = makeServer(() => { throw new McpOpError('not-found', 'no such match'); });
    await server.setEnabled(true);
    const [res] = await roundTrip(path, [encodeLine({ id: 6, op: 'matchDetail', args: { matchId: 'x' } })]);
    expect(res).toMatchObject({ id: 6, ok: false, error: { code: 'not-found', message: 'no such match' } });
  });

  it('reports an unexpected throw as internal, not as bad input', async () => {
    const { server, path } = makeServer(() => { throw new TypeError('boom'); });
    await server.setEnabled(true);
    const [res] = await roundTrip(path, [encodeLine({ id: 7, op: 'ranks' })]);
    expect(res).toMatchObject({ id: 7, ok: false, error: { code: 'internal' } });
  });

  it('answers a malformed line without dropping the connection', async () => {
    const { server, path } = makeServer((op) => ({ op }));
    await server.setEnabled(true);
    const out = await roundTrip(path, [`{oops}\n${encodeLine({ id: 8, op: 'ranks' })}`], 2);
    expect(out[0]).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(out[1]).toMatchObject({ id: 8, ok: true });
  });

  it('handles a request whose id is missing', async () => {
    const { server, path } = makeServer((op) => ({ op }));
    await server.setEnabled(true);
    const [res] = await roundTrip(path, [encodeLine({ op: 'ranks' })]);
    expect(res.id).toBe(-1);
  });
});
