import type { DataProvider } from '../dashboard/provider';
import { createDispatcher } from './dispatch';
import { createPipeServer, type PipeServer, type McpLogFields } from './pipeServer';

/**
 * The MCP edge, assembled: the op table bound to the live DataProvider, behind
 * the opt-in named-pipe endpoint. The composition root constructs one of these
 * and toggles it from the Settings flag; nothing else in the app knows the MCP
 * bridge exists.
 */

export interface McpBridgeDeps {
  /** The SAME provider instance the renderer's IPC uses — single writer. */
  provider: DataProvider;
  log?: (message: string, fields?: McpLogFields) => void;
  /** Pipe address override (tests). */
  path?: string;
}

export function createMcpBridge(deps: McpBridgeDeps): PipeServer {
  return createPipeServer({
    dispatch: createDispatcher(deps.provider),
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.path ? { path: deps.path } : {}),
  });
}

export { PIPE_NAME, pipePath, type PipeServer } from './pipeServer';
export { McpOpError } from './dispatch';
