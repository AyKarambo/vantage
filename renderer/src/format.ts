/** Presentation helpers — pure formatting, shared across every view. */
import type { Role, Streak } from '../../src/shared/contract';
import { rankLabelOf } from '../../src/core/rankDisplay';

/** Display copy for each queue role; the canonical role → label mapping. */
export const ROLE_LABEL: Record<string, string> = {
  tank: 'Tank',
  damage: 'Damage',
  support: 'Support',
  openQ: 'Open Q',
};

/** roleLabel('openQ') → "Open Q"; falls back to the raw value for unmapped roles. */
export const roleLabel = (role: Role | string): string => ROLE_LABEL[role] ?? role;

/** 0..1 → "54%". */
export const pct = (winrate: number): string => `${Math.round(winrate * 100)}%`;

/** Compact number: 12345 → "12k", 1234 → "1.2k". */
export function fmt(n: number | null | undefined): string {
  if (n == null) return '–';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** Thousands-separated integer: 1511 → "1,511". */
export const int = (n: number): string => Math.round(n).toLocaleString('en-US');

/** signed(3) → "+3"; signed(-3) → "-3" (positive values get an explicit plus, negatives keep JS's native hyphen-minus). */
export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** Winrate → semantic state class used across components. */
export function wrState(winrate: number): 'win' | 'loss' | 'mid' {
  if (winrate >= 0.55) return 'win';
  if (winrate <= 0.45) return 'loss';
  return 'mid';
}

/** streakText({ type: 'W', count: 3 }) → "W3"; no active streak → "–". */
export function streakText(s: Streak): string {
  return s.type === 'none' ? '–' : `${s.type}${s.count}`;
}

/** rankLabel('Gold', 3) → "Gold 3". Re-exports the shared core rank renderer. */
export const rankLabel = rankLabelOf;

const DAY = 86400000;

/** Short relative time: "just now", "3h", "2d", or a date. */
export function relTime(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < DAY) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** time(ts) → "2:45 PM" (local clock time, ms epoch in). */
export function time(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** dateLong(ts) → "Saturday, July 4" (local long date, ms epoch in; defaults to now). */
export function dateLong(ts = Date.now()): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Greeting appropriate to the local hour. */
export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}
