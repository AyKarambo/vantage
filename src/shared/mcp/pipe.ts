/**
 * The local endpoint address, shared by the app (which listens) and the stdio
 * bridge (which connects). It lives in `shared/` so the bridge process never
 * has to import anything out of `src/main/`.
 */

/** Versioned so a future wire-format change can coexist with an older bridge. */
export const PIPE_NAME = 'vantage.mcp.v1';

/**
 * Platform-correct address for a pipe name. Windows named pipes are the real
 * target; the POSIX socket path keeps the code runnable on other platforms for
 * development and tests.
 */
export function pipePath(name: string = PIPE_NAME): string {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : `/tmp/${name}.sock`;
}
