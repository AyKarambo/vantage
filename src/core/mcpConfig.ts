/**
 * The MCP client config Settings offers to copy once the endpoint is on (W4).
 * Turning "MCP endpoint" on used to leave the user to find the absolute path
 * to `stdio.js` by hand from the README — this builds the exact JSON block
 * Claude Desktop's own config file expects, from the one path the main
 * process already resolves (`AppInfo.mcpBridgePath`). Pure and Electron-free
 * so it's unit-testable and drives the browser preview harness.
 */

/** The `mcpServers` entry Claude Desktop's config file expects for Vantage. */
export function claudeDesktopMcpConfig(bridgePath: string): object {
  return { mcpServers: { vantage: { command: 'node', args: [bridgePath] } } };
}

/** Pretty-printed JSON of {@link claudeDesktopMcpConfig}, ready to paste into Claude Desktop's config file. */
export function formatClaudeDesktopMcpConfig(bridgePath: string): string {
  return JSON.stringify(claudeDesktopMcpConfig(bridgePath), null, 2);
}
