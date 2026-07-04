/**
 * The single point where the renderer touches the preload IPC bridge. Every
 * view goes through `bridge` rather than reaching for `window.owstats`, so the
 * main-process contract has exactly one consumer to keep in sync.
 *
 * Each property forwards to `window.owstats` at access time rather than
 * snapshotting it, so load order never matters (the preview harness can inject
 * its mock after this module initialises). The member list is derived from the
 * contract's channel map, so a new API method is available here without edits.
 */
import { IPC_CHANNELS, type OwStatsApi } from '../../src/shared/contract';

declare global {
  interface Window {
    owstats: OwStatsApi;
  }
}

const MEMBERS = [...Object.keys(IPC_CHANNELS), 'window'] as Array<keyof OwStatsApi>;

export const bridge = {} as OwStatsApi;
for (const member of MEMBERS) {
  Object.defineProperty(bridge, member, {
    get: () => window.owstats[member],
    enumerable: true,
  });
}
