import { describe, it, expect } from 'vitest';
import { claudeDesktopMcpConfig, formatClaudeDesktopMcpConfig } from '../src/core/mcpConfig';

describe('claudeDesktopMcpConfig', () => {
  it('shapes the mcpServers entry Claude Desktop expects, args as a single-element array', () => {
    expect(claudeDesktopMcpConfig('C:\\Vantage\\resources\\mcp\\stdio.js')).toEqual({
      mcpServers: { vantage: { command: 'node', args: ['C:\\Vantage\\resources\\mcp\\stdio.js'] } },
    });
  });
});

describe('formatClaudeDesktopMcpConfig', () => {
  it('pretty-prints the same shape as valid, parseable JSON', () => {
    const text = formatClaudeDesktopMcpConfig('/dev/dist/mcp/stdio.js');
    expect(text).toContain('"vantage"');
    expect(JSON.parse(text)).toEqual(claudeDesktopMcpConfig('/dev/dist/mcp/stdio.js'));
  });
});
