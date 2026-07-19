import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPipeClient } from './pipeClient';
import { buildServer, type ToolRegistrar } from './server';
import { registerReadTools } from './readTools';

/**
 * The bridge entrypoint — the command an MCP client is configured to spawn.
 *
 * Kept deliberately thin: everything testable lives in `server.ts`, so this
 * file is only process wiring.
 */

/** Every tool this server exposes. Write tools land in T12. */
const REGISTRARS: readonly ToolRegistrar[] = [registerReadTools];

export async function main(): Promise<void> {
  const server = buildServer(createPipeClient(), REGISTRARS);
  await server.connect(new StdioServerTransport());
}

// stdout is the JSON-RPC channel: anything written there that isn't a protocol
// message corrupts the stream, so diagnostics go to stderr only.
main().catch((err: unknown) => {
  process.stderr.write(`vantage-mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
