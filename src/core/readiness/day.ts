/**
 * Local-time day bucketing with a configurable reset hour (default 04:00).
 *
 * Fatigue is about the player's day/night, so a late-night session must count as
 * a single day rather than being split across UTC midnight. This is deliberately
 * distinct from the app-wide UTC `dayKey` used elsewhere (`analytics/grouping.ts`).
 *
 * It reads the *runtime's* local timezone (pure JS `Date`, no Electron), and is
 * DST-safe because the offset is recomputed per timestamp. `dayOrdinal` returns an
 * integer day index so day differences are exact. Tests stay timezone-robust by
 * building fixtures from local `Date` values — the same local components are used
 * on the way in and out.
 */

import { READINESS_TUNING } from './constants';

const DAY_MS = 86_400_000;

/** Canonical ms at the start of the local day (shifted by the reset hour) containing `ts`. */
export function localDayStamp(ts: number, resetHour: number = READINESS_TUNING.resetHour): number {
  const shifted = new Date(ts - resetHour * 3_600_000);
  return Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate());
}

/** Integer day index (days since the Unix epoch, local + reset-hour aware). */
export function dayOrdinal(ts: number, resetHour: number = READINESS_TUNING.resetHour): number {
  return Math.floor(localDayStamp(ts, resetHour) / DAY_MS);
}

/** YYYY-MM-DD label for the local day containing `ts`. */
export function localDayKey(ts: number, resetHour: number = READINESS_TUNING.resetHour): string {
  return new Date(localDayStamp(ts, resetHour)).toISOString().slice(0, 10);
}

/** YYYY-MM-DD label for a raw day ordinal. */
export function ordinalToKey(ordinal: number): string {
  return new Date(ordinal * DAY_MS).toISOString().slice(0, 10);
}
