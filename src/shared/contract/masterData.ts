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
