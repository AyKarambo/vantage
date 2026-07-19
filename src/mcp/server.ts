import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpBridgeError, type PipeClient } from './pipeClient';

/**
 * The MCP server an LLM coach spawns — assembled here so tests can build one
 * without connecting a stdio transport.
 *
 * It holds no data of its own and never touches the database. Every tool call
 * is forwarded over a local named pipe to the RUNNING Vantage app, which
 * services it through the same core/store the UI uses. That is what keeps a
 * single writer: this process is a translator, not a second source of truth.
 *
 * It exists as a separate process because an MCP stdio client *spawns* its
 * server, but the data lives in an app that is already running and holds
 * Electron's single-instance lock — so it cannot be that app.
 */

export const SERVER_NAME = 'vantage';
export const SERVER_VERSION = '1.0.0';

export const INSTRUCTIONS =
  "Vantage is the user's own Overwatch match tracker. Read tools return their real recorded history — "
  + 'always check the `demo` flag on a result, because when it is true the data is generated sample data '
  + 'and must not be treated as real performance. Write tools record only what the user could type into '
  + 'the app by hand. Destructive tools require confirm: true and must only be called after the user has '
  + 'explicitly agreed to that specific action.';

export interface ToolContent {
  /** The SDK's CallToolResult carries an open index signature; mirror it so
   *  these results are structurally assignable to it. */
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: true;
}

/** Tool results are text; structured payloads are JSON-stringified into it. */
export function toolText(value: unknown): ToolContent {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

/**
 * Turn a rejected call into an MCP tool error the model can act on.
 *
 * Every failure reaches the model as `isError: true` carrying the classified
 * message, so a refusal (demo mode, missing confirmation, app not running)
 * reads as an answerable condition rather than a transport fault.
 */
export function toolError(err: unknown): ToolContent {
  const message = err instanceof McpBridgeError
    ? `${err.message} [${err.code}]`
    : `Unexpected failure: ${err instanceof Error ? err.message : String(err)}`;
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Run one op and shape the result — never throws out of a tool handler. */
export async function runTool(fn: () => Promise<unknown>): Promise<ToolContent> {
  try {
    return toolText(await fn());
  } catch (err) {
    return toolError(err);
  }
}

export type ToolRegistrar = (server: McpServer, client: PipeClient) => void;

/**
 * Build the server from an explicit list of registrars — passed in rather than
 * self-registered, so what this server exposes is decided in exactly one place
 * and a test can build a server with a known subset.
 */
export function buildServer(client: PipeClient, registrars: readonly ToolRegistrar[]): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  for (const register of registrars) register(server, client);
  return server;
}
