/**
 * Session-gap threshold for the sidebar's "Current session" card — how long a
 * pause has to be before the current sitting is considered over. Independent
 * of readiness's own internal session-gap tuning
 * (`READINESS_TUNING.sessionGapMinutes`); this one is a user-facing setting.
 */

export interface SessionSettings {
  /** Pause after which the current session is considered over; minutes. */
  gapMinutes: number;
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = { gapMinutes: 180 };

const clampGapMinutes = (n: number): number => Math.max(15, Math.min(720, Math.round(n)));

/** Coerce a partial/untrusted settings object into a valid, clamped one. */
export function normalizeSessionSettings(s: Partial<SessionSettings> | undefined): SessionSettings {
  return {
    gapMinutes: clampGapMinutes(s?.gapMinutes ?? DEFAULT_SESSION_SETTINGS.gapMinutes),
  };
}
