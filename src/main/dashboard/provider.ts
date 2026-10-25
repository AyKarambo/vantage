import type { GameRecord } from '../../core/analytics';
import type { AuthoredTarget } from '../../core/targets';
import type { SessionCheckIn } from '../../core/checkIn';
import type { DemoContext } from '../../core/demoPreference';
import type { RankAnchorMap } from '../../core/rank';
import type { PlacementRun } from '../../core/placements';
import type { MasterDataConfig } from '../config';
import type { ExportResult, MasterData, PendingMatch } from '../../shared/contract';
import type { ProviderContract } from './handlers';

/**
 * The data contract between the dashboard window and the composition root.
 * Every contract method the provider answers itself is taken from `OwStatsApi`
 * (see {@link ProviderContract}), so its signature is declared exactly once; only
 * the main-internal reads the composed handlers build on are declared here.
 */
export interface DataProvider extends ProviderContract {
  games(): GameRecord[];
  /**
   * Opaque revision of the history store — changes on every write, never
   * repeats. Main-internal (like {@link DataProvider.rankAnchorMap}); its only
   * consumer is the Players read's directory memo, which must not serve a page
   * from before a match landed.
   */
  historyRevision(): string;
  isSample(): boolean;
  /** Demo facts (effective display, raw choice, real-history presence) for the dashboard payload. */
  demoContext(): DemoContext;
  exportToNotion?(games: GameRecord[]): Promise<ExportResult>;
  /** The player's authored improvement targets (◎ manual). */
  manualTargets(): AuthoredTarget[];
  /** Anchors keyed for the rank engine, passed into the match-detail read. */
  rankAnchorMap(): RankAnchorMap;
  /** The raw runs, for the dashboard read — it needs `startedAt` and the counted
   *  set to suppress open-run deltas, which the summaries deliberately don't carry.
   *  Main-internal, like {@link DataProvider.rankAnchorMap}; never crosses IPC. */
  placementRuns(): PlacementRun[];
  /** Every stored pre-session check-in (S10 phase 2) — the dashboard payload
   *  reads this to split game-1 tilt by mood and to know whether a fresh
   *  prompt is due. */
  getCheckIns(): SessionCheckIn[];
  /** Played competitive matches held without a GEP outcome, awaiting a manual result (the "Needs result" section). */
  pendingMatches(): PendingMatch[];
  /** The effective master data (defaults ⊕ overrides) — feeds the dashboard read + the editor. */
  effectiveMasterData(): MasterData;
  /** The Master Data source's own settings — when it was last successfully checked (W1). */
  getMasterDataConfig(): MasterDataConfig;
}
