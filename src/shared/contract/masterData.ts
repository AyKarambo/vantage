/**
 * Master-data DTOs of the IPC contract — re-exported from the pure core module
 * so the renderer consumes them through `'shared/contract'` (never importing
 * `core/` directly) exactly like the other payloads. Electron-free.
 */
export type {
  HeroRole,
  HeroEntry,
  MapEntry,
  SeasonEntry,
  MasterData,
  HeroChange,
  MapChange,
  UpdatePreview,
  AcceptedUpdate,
} from '../../core/masterData';
export type { MapMode } from '../../core/maps';

/** The Master Data online source's own check history (W1) — when "Update from online source" last successfully fetched, regardless of whether it found anything new. Absent until the first check. */
export interface MasterDataCheckInfo {
  lastCheckedAt?: number;
}
