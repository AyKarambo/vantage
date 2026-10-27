import { describe, it, expect, vi } from 'vitest';
import { dashboardHandlers } from '../src/main/dashboard/handlers';
import type { DataProvider } from '../src/main/dashboard/provider';
import { IPC_CHANNELS } from '../src/shared/contract';

describe('dashboardHandlers', () => {
  it('has a handler for every contract channel', () => {
    const handlers = dashboardHandlers({} as DataProvider) as unknown as Record<string, unknown>;
    for (const method of Object.keys(IPC_CHANNELS)) {
      expect(typeof handlers[method], method).toBe('function');
    }
  });

  it('forwards a provider method with its arguments and `this` intact', () => {
    const provider = {
      calls: [] as unknown[][],
      setTargetActive(id: string, active: boolean) {
        this.calls.push([id, active]);
      },
    };
    dashboardHandlers(provider as unknown as DataProvider).setTargetActive('t1', false);
    expect(provider.calls).toEqual([['t1', false]]);
  });

  it('reports Notion export unavailable when the provider has no exporter', async () => {
    const handlers = dashboardHandlers({ games: () => [] } as unknown as DataProvider);
    await expect(handlers.exportNotionMatches(['m1'])).resolves.toEqual({ ok: 0, failed: 0, unavailable: true });
  });

  it('retries only the named competitive matches', async () => {
    const exportToNotion = vi.fn(async () => ({ ok: 1, failed: 0 }));
    const games = [
      { matchId: 'a', gameType: 'Competitive' },
      { matchId: 'b', gameType: 'Quick Play' },
      { matchId: 'c', gameType: 'Competitive' },
    ];
    const handlers = dashboardHandlers({ games: () => games, exportToNotion } as unknown as DataProvider);
    await handlers.exportNotionMatches(['a', 'b']);
    expect(exportToNotion).toHaveBeenCalledWith([games[0]]);
  });
});
