import * as net from 'node:net';
import { NdjsonBuffer, encodeLine } from '../../shared/mcp/ndjson';
import { isMcpOp, mcpError, type McpRequest, type McpResponse } from '../../shared/mcp/ops';
import { McpOpError, type Dispatcher } from './dispatch';

/**
 * The local endpoint the MCP stdio bridge connects to.
 *
 * A Windows **named pipe**, deliberately not a loopback TCP socket: the spec
 * requires that nothing listens on a network port, and a named pipe is not one
 * — it cannot be reached from another machine, and it needs no port allocation
 * or firewall exception.
 *
 * It is only ever created while the user has switched the endpoint on
 * (`mcpEnabled`). "Off" means the pipe does not exist, not that requests are
 * answered with a refusal — there is nothing to connect to at all.
 */

/** Versioned so a future wire-format change can coexist with an old bridge. */
export const PIPE_NAME = 'vantage.mcp.v1';

/** Platform-correct address for a pipe name (POSIX path used by tests/dev on non-Windows). */
export function pipePath(name: string = PIPE_NAME): string {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : `/tmp/${name}.sock`;
}

/** Id used when a request could not be attributed to one (unparseable, or no numeric id). */
const UNATTRIBUTED = -1;

/** Structured log values, matching what the app's logger accepts. */
export type McpLogFields = Record<string, string | number | boolean>;

export interface PipeServerDeps {
  dispatch: Dispatcher;
  /** Address to bind; defaults to {@link pipePath}. Injectable so tests get an isolated pipe. */
  path?: string;
  log?: (message: string, fields?: McpLogFields) => void;
}

export interface PipeServer {
  /** Start or stop listening. Idempotent — calling it with the current state is a no-op. */
  setEnabled(enabled: boolean): Promise<void>;
  isListening(): boolean;
  /** Close the server and drop every open connection. */
  stop(): Promise<void>;
}

export function createPipeServer(deps: PipeServerDeps): PipeServer {
  const address = deps.path ?? pipePath();
  const log = deps.log ?? (() => {});
  let server: net.Server | undefined;
  const sockets = new Set<net.Socket>();

  /** Turn one decoded wire value into a response. Never throws. */
  function respond(value: unknown): McpResponse {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return mcpError(UNATTRIBUTED, 'invalid-input', 'expected a JSON object with { id, op, args }');
    }
    const req = value as Partial<McpRequest>;
    const id = typeof req.id === 'number' ? req.id : UNATTRIBUTED;
    // The allowlist check IS the surface boundary: an op absent from the
    // contract cannot be performed, however it is spelled on the wire.
    if (typeof req.op !== 'string' || !isMcpOp(req.op)) {
      return mcpError(id, 'invalid-input', `unknown op \`${String(req.op)}\``);
    }
    try {
      return { id, ok: true, result: deps.dispatch(req.op, req.args) };
    } catch (err) {
      if (err instanceof McpOpError) return mcpError(id, err.code, err.message);
      // An unexpected throw is a bug in Vantage, not bad input from the caller
      // — say so, rather than blaming the request.
      log('mcp op failed', { op: req.op, error: String(err) });
      return mcpError(id, 'internal', err instanceof Error ? err.message : String(err));
    }
  }

  function onConnection(socket: net.Socket): void {
    sockets.add(socket);
    const buffer = new NdjsonBuffer();
    const send = (res: McpResponse): void => {
      if (!socket.destroyed) socket.write(encodeLine(res));
    };

    socket.on('data', (chunk: Buffer) => {
      const { values, errors } = buffer.push(chunk);
      for (const e of errors) {
        send(mcpError(UNATTRIBUTED, 'invalid-input', `malformed request line: ${e.message}`));
      }
      for (const value of values) send(respond(value));
    });
    // A client vanishing mid-request is routine (the MCP client exited), not an
    // error worth surfacing to the user.
    socket.on('error', () => { sockets.delete(socket); });
    socket.on('close', () => { sockets.delete(socket); });
  }

  async function start(): Promise<void> {
    if (server) return;
    await new Promise<void>((resolve) => {
      const s = net.createServer(onConnection);
      s.on('error', (err) => {
        log('mcp pipe server error', { address, error: String(err) });
        // Failing to listen must never take the app down with it: the endpoint
        // is an optional extra, and the app is mid-session.
        if (server === s) server = undefined;
        resolve();
      });
      s.listen(address, () => {
        server = s;
        log('mcp endpoint listening', { address });
        resolve();
      });
    });
  }

  async function stop(): Promise<void> {
    const s = server;
    server = undefined;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (!s) return;
    await new Promise<void>((resolve) => s.close(() => resolve()));
    log('mcp endpoint stopped', { address });
  }

  return {
    setEnabled: async (enabled) => (enabled ? start() : stop()),
    isListening: () => Boolean(server?.listening),
    stop,
  };
}
