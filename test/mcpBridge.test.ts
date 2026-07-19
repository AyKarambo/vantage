import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { createMcpBridge, pipePath, type PipeServer } from '../src/main/mcp';
import { NdjsonBuffer, encodeLine } from '../src/shared/mcp/ndjson';
import type { McpResponse } from '../src/shared/mcp/ops';
import type { DataProvider } from '../src/main/dashboard/provider';
import type { GameRecord } from '../src/core/analytics';
import { DEFAULT_MASTER_DATA } from '../src/core/masterData';
import { DEFAULT_BREAK_REMINDER } from '../src/core/breakReminder';
import { DEFAULT_STALENESS } from '../src/core/staleness';
import { DEFAULT_READINESS } from '../src/core/readiness';
import { DEFAULT_SESSION_SETTINGS } from '../src/core/sessionSettings';
import { DEFAULT_GRADING_SETTINGS } from '../src/core/gradingSettings';

/**
 * End-to-end over the assembled app-side edge: a real socket client talking to
 * the real pipe server, through the real dispatcher, onto a fake DataProvider.
 * This is the closest thing to "what the bridge process will actually see"
 * without booting Electron.
 */

let servers: PipeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  servers = [];
});

let seq = 0;
function setup(over: { demo?: boolean; games?: GameRecord[] } = {}) {
  seq += 1;
  const logged: string[] = [];
  const partial: Partial<DataProvider> = {
    games: () => over.games ?? [],
    pendingMatches: () => [],
    manualTargets: () => [],
    demoContext: () => ({
      active: over.demo ?? false,
      preference: over.demo ? 'on' : 'off',
      hasRealHistory: !over.demo,
    }),
    effectiveMasterData: () => DEFAULT_MASTER_DATA,
    getBreakReminder: () => DEFAULT_BREAK_REMINDER,
    getStaleness: () => DEFAULT_STALENESS,
    getReadiness: () => DEFAULT_READINESS,
    getSessionSettings: () => DEFAULT_SESSION_SETTINGS,
    getGrading: () => DEFAULT_GRADING_SETTINGS,
    rankAnchorMap: () => ({}),
    getRanks: () => [],
    getGepStatus: () => ({ state: 'idle' }) as never,
    logMatch: ((input: { map: string }) => {
      logged.push(`logMatch:${input.map}`);
      return { matchId: 'new-1' };
    }) as never,
  };
  const path = pipePath(`vantage-bridge-${process.pid}-${seq}`);
  const server = createMcpBridge({ provider: partial as DataProvider, path });
  servers.push(server);
  return { server, path, logged };
}

function request(path: string, payload: unknown): Promise<McpResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(path);
    const buffer = new NdjsonBuffer();
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, 4000);
    socket.on('connect', () => socket.write(encodeLine(payload)));
    socket.on('data', (chunk) => {
      const [first] = buffer.push(chunk).values;
      if (first) {
        clearTimeout(timer);
        socket.end();
        resolve(first as McpResponse);
      }
    });
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

describe('the assembled MCP bridge', () => {
  it('serves a read wrapped in a demo-flagged envelope', async () => {
    const { server, path } = setup({ demo: false });
    await server.setEnabled(true);
    const res = await request(path, { id: 1, op: 'ranks' });
    expect(res).toMatchObject({ id: 1, ok: true, result: { demo: false, data: [] } });
  });

  it('reports demo:true end-to-end when sample data is showing', async () => {
    const { server, path } = setup({ demo: true });
    await server.setEnabled(true);
    const res = await request(path, { id: 2, op: 'ranks' });
    expect(res).toMatchObject({ ok: true, result: { demo: true } });
  });

  it('refuses a write in demo mode all the way out to the wire', async () => {
    const { server, path, logged } = setup({ demo: true });
    await server.setEnabled(true);
    const res = await request(path, {
      id: 3,
      op: 'logMatch',
      args: { input: { result: 'Win', role: 'damage', map: 'A', gameType: 'Competitive' } },
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'demo-mode' } });
    expect(logged).toEqual([]);
  });

  it('performs a write against real history', async () => {
    const { server, path, logged } = setup({ demo: false });
    await server.setEnabled(true);
    const res = await request(path, {
      id: 4,
      op: 'logMatch',
      args: { input: { result: 'Win', role: 'damage', map: "King's Row", gameType: 'Competitive' } },
    });
    expect(res).toMatchObject({ ok: true, result: { matchId: 'new-1' } });
    expect(logged).toEqual(["logMatch:King's Row"]);
  });

  it('refuses a destructive op without confirmation, over the wire', async () => {
    const { server, path } = setup();
    await server.setEnabled(true);
    const res = await request(path, { id: 5, op: 'deactivateAllTargets', args: {} });
    expect(res).toMatchObject({ ok: false, error: { code: 'needs-confirmation' } });
  });

  it('keeps out-of-scope operations unreachable', async () => {
    const { server, path } = setup();
    await server.setEnabled(true);
    for (const op of ['exportNotion', 'setNotionToken', 'setDevKey', 'setDataFolder', 'deleteDetectedAccount']) {
      const res = await request(path, { id: 6, op, args: {} });
      expect(res).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    }
  });
});
