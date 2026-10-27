import { DEFAULT_BREAK_REMINDER, type BreakReminderSettings } from '../../core/breakReminder';
import { DEFAULT_STALENESS, type StalenessSettings } from '../../core/staleness';
import { DEFAULT_READINESS, type ReadinessSettings } from '../../core/readiness';
import { DEFAULT_SESSION_SETTINGS, type SessionSettings } from '../../core/sessionSettings';
import { DEFAULT_COACHING, type CoachingSettings } from '../../core/coachingSettings';
import { DEFAULT_GRADING_SETTINGS, type GradingSettings } from '../../core/gradingSettings';
import type { DemoPreference } from '../../core/demoPreference';

/**
 * The AppConfig shape and its defaults. Electron-free, so the browser preview
 * and tests can build a complete config; loading and saving it lives in
 * ./appConfig.
 */

/** The outcome of the last real sync attempt (W6) — survives a view repaint or app restart, unlike the in-card transient readout. */
export interface NotionSyncResult {
  at: number;
  ok: number;
  updated: number;
  failed: number;
  firstError?: string;
}

export interface NotionConfig {
  gametrackerDatabaseId: string;
  mapsDatabaseId: string;
  gametrackerUrl: string;
  /** When the last successful sync finished (epoch ms). */
  lastSyncedAt?: number;
  /** What that (or any) last sync attempt actually did (W6). */
  lastSyncResult?: NotionSyncResult;
}

export type Sensor = 'counterwatch' | 'gep';

/** Editable-master-data settings: the (configurable) online source for the Update fetch. */
export interface MasterDataConfig {
  /** Base URL of the OverFast-compatible API used by the "Update" action. */
  overfastBaseUrl: string;
  /** When "Update from online source" last successfully fetched (epoch ms) — regardless of whether it found anything new (W1). Absent until the first check. */
  lastCheckedAt?: number;
}

/** The dashboard window's last-seen placement, restored on launch. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** App-behavior settings owned by the Settings screen. */
export interface UiConfig {
  /** ✕ keeps the app in the tray (true, today's behavior) or quits (false). */
  closeToTray: boolean;
  /** First-run demo-data choice. 'unset' until the user is asked on first run. */
  demoPreference: DemoPreference;
  /**
   * Dev Mode enabled for the next launch. `scripts/ow-dev.mjs` injects Overwolf
   * dev credentials unless this is explicitly `false`, so the default `true`
   * keeps existing dev setups working; toggling it off is the in-app kill switch.
   * Inert for a packaged build (Dev Mode can't activate there).
   */
  devMode: boolean;
  /** OS notifications on GEP service down/recovery (default true). */
  gepNotifications: boolean;
  /** Show the kill feed on the live-match screen (default true). */
  liveKillFeed: boolean;
  /** Switch to the Live screen when a match starts (default false). Never focuses the window. */
  autoSwitchToLive: boolean;
  /** Switch to the finished game's Review page once it is recorded (default false). Never focuses the window. */
  autoSwitchToReview: boolean;
  /**
   * Whether the local MCP endpoint listens (spec #174). Default **false**: it
   * exposes match history and the manual-write surface to any process running
   * as this user (a Windows named pipe carries no per-process ACL), so it stays
   * off until the user turns it on in Settings — local-first, explicit action
   * (guardrail 5). Off also means no pipe is created at all, not merely that
   * calls are rejected.
   */
  mcpEnabled: boolean;
  /**
   * The app version the user was last shown a "What's new" highlight for.
   * Optional with **no entry in DEFAULTS** — absent means "never shown
   * anything", which a fresh install must resolve to (see
   * `src/core/whatsNew.ts`'s `shouldShowWhatsNew`). Giving this a default
   * value here (e.g. `'0.0.0'`) would make every fresh install look like an
   * upgrade and pop the changelog on first launch, so it rides the ui merge
   * in {@link loadConfig} same as every other field but is deliberately left
   * out of `DEFAULTS.ui`.
   */
  lastSeenVersion?: string;
  windowBounds?: WindowBounds;
  /**
   * Renderer text-size zoom factor (W7) — 1 = 100%, clamped 0.9–1.3. Optional
   * with no `DEFAULTS` entry, same convention as {@link lastSeenVersion}:
   * absent means "never changed from 100%", not a fabricated `1`.
   */
  uiZoom?: number;
}

export interface AppConfig {
  overwatchGameId: number;
  runAtLogin: boolean;
  /** Where match data comes from. 'counterwatch' reads Counterwatch's local DB. */
  sensor: Sensor;
  notion: NotionConfig;
  /** BattleTag → Notion Account select value. */
  accounts: Record<string, string>;
  /** GEP map name → Notion Maps page Name. */
  mapAliases: Record<string, string>;
  /** "Time for a break?" tray notification after N consecutive losses. */
  breakReminder: BreakReminderSettings;
  /** Active-target staleness thresholds (days / matches) for the rotation cue. */
  staleness: StalenessSettings;
  /** Readiness / training-load coach settings (feature toggle + opt-in launch toast). */
  readiness: ReadinessSettings;
  /** The sidebar "Current session" card's gap threshold. */
  sessionSettings: SessionSettings;
  /** Measured-target grading settings (the partial-credit margin). */
  grading: GradingSettings;
  /** Practice-focus / check-in / break-detection settings (issue #321). */
  coaching: CoachingSettings;
  /** Editable-master-data source config (the Update action's endpoint). */
  masterData: MasterDataConfig;
  /**
   * Folder holding all Vantage data files (SQLite match history, manual log,
   * outbox ledger, rank anchors). Absent ⇒ the default
   * `<userData>/data`. Point it at a cloud-synced folder (OneDrive/Dropbox) for
   * off-machine backup. Single-machine use only — simultaneous multi-machine
   * access to the synced files can corrupt SQLite.
   *
   * Renamed from `historyDbFolder` (which only ever moved the DB). A config
   * still carrying the legacy key is honored on read via {@link loadConfig}
   * and rewritten under `dataFolder` on next persist.
   */
  dataFolder?: string;
  /** @deprecated legacy alias for {@link dataFolder}; read-only back-compat. */
  historyDbFolder?: string;
  ui: UiConfig;
}

/** A fresh copy of the built-in defaults (every nested section is its own object). */
export function defaultConfig(): AppConfig {
  return {
    overwatchGameId: 10844, // kGepSupportedGameIds.Overwatch (Overwatch)
    runAtLogin: false,
    sensor: 'counterwatch',
    notion: { gametrackerDatabaseId: '', mapsDatabaseId: '', gametrackerUrl: '' },
    accounts: {},
    mapAliases: {},
    breakReminder: { ...DEFAULT_BREAK_REMINDER },
    staleness: { ...DEFAULT_STALENESS },
    readiness: { ...DEFAULT_READINESS },
    sessionSettings: { ...DEFAULT_SESSION_SETTINGS },
    grading: { ...DEFAULT_GRADING_SETTINGS },
    coaching: { ...DEFAULT_COACHING, checkInQuestions: { ...DEFAULT_COACHING.checkInQuestions } },
    masterData: { overfastBaseUrl: 'https://overfast-api.tekrop.fr' },
    ui: {
      closeToTray: true, demoPreference: 'unset', devMode: true, gepNotifications: true,
      liveKillFeed: true, autoSwitchToLive: false, autoSwitchToReview: false, mcpEnabled: false,
    },
  };
}
