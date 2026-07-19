import * as net from 'node:net';
import { pipePath } from '../shared/mcp/pipe';
import { NdjsonBuffer, encodeLine } from '../shared/mcp/ndjson';
import type { McpOp, McpArgs, McpResult, McpResponse, McpErrorCode } from '../shared/mcp/ops';

/**
 * The bridge's side of the local pipe.
 *
 * One connection per call, deliberately. The alternative — a long-lived socket
 * with reconnect logic — buys negligible latency locally while adding a whole
 * class of stale-connection bugs, and Vantage starting or stopping mid-session
 * is the normal case rather than the exception: the user quits the app while
 * their MCP client keeps running. Connect-per-call makes "is it up right now?"
 * the only question that ever needs answering.
 */

export class McpBridgeError extends Error {
  constructor(readonly code: McpErrorCode, message: string) {
    super(message);
    this.name = 'McpBridgeError';
  }
}

/**
 * What the model is told when the endpoint can't be reached. It has to cover
 * both real causes — app not running, and app running with the endpoint switched
 * off — because from out here they are indistinguishable, and guessing one would
 * send the user to the wrong fix.
 */
export const NOT_RUNNING_MESSAGE =
  'Could not reach Vantage. Make sure the Vantage app is running and that the MCP endpoint is enabled '
  + '(Settings → the "MCP endpoint" toggle, which is off by default).';

export interface PipeClientOptions {
  path?: string;
  /** Give up on a single call after this long. */
  timeoutMs?: number;
}

export interface PipeClient {
  call<K extends McpOp>(op: K, args: McpArgs<K>): Promise<McpResult<K>>;
}

export function createPipeClient(options: PipeClientOptions = {}): PipeClient {
  const address = options.path ?? pipePath();
  const timeoutMs = options.timeoutMs ?? 10_000;
  let nextId = 1;

  function call<K extends McpOp>(op: K, args: McpArgs<K>): Promise<McpResult<K>> {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const socket = net.connect(address);
      const buffer = new NdjsonBuffer();
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn();
      };

      const timer = setTimeout(
        () => finish(() => reject(new McpBridgeError('internal', `Vantage did not answer \`${op}\` within ${timeoutMs}ms.`))),
        timeoutMs,
      );

      socket.on('connect', () => socket.write(encodeLine({ id, op, args })));

      socket.on('data', (chunk: Buffer) => {
        for (const value of buffer.push(chunk).values) {
          const res = value as McpResponse;
          // Connect-per-call means exactly one response belongs to us; ignore
          // anything that doesn't match rather than resolving with a stray.
          if (res?.id !== id) continue;
          if (res.ok) finish(() => resolve(res.result as McpResult<K>));
          else finish(() => reject(new McpBridgeError(res.error.code, res.error.message)));
          return;
        }
      });

      // ENOENT (no pipe) / ECONNREFUSED both mean "no one is listening".
      socket.on('error', () => finish(() => reject(new McpBridgeError('not-running', NOT_RUNNING_MESSAGE))));
      // Closed before answering — the app quit mid-call.
      socket.on('close', () => finish(() => reject(new McpBridgeError('not-running', NOT_RUNNING_MESSAGE))));
    });
  }

  return { call };
}
