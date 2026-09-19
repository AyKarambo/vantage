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

/**
 * One decimal, never abbreviated: 5.6 → "5.6" (H5). For small per-10 rates —
 * eliminations/deaths/assists — where `fmt`'s whole-number rounding hides the
 * real signal (5.6 and 6.4 deaths/10 both used to print "6"); damage/healing/
 * mitigation stay on `fmt`'s k-suffix since they're large enough to need it.
 */
export function fmt1(n: number | null | undefined): string {
  if (n == null) return '–';
  return n.toFixed(1);
}

/** Thousands-separated integer: 1511 → "1,511". */
export const int = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * signed(3) → "+3"; signed(-3) → "−3" (U+2212 MINUS SIGN, not the ASCII
 * hyphen-minus a bare template string gives you) — Mental and the readiness
 * wiki hand-wrote U+2212 already; this is the one place every other signed
 * number in the app should come from, so a column never mixes both glyphs at
 * two widths in the mono font (K7).
 */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/**
 * games(8) → "8 games"; games(1) → "1 game". The long form, for prose and
 * column headers — see {@link gamesShort} for the compact chart-label form.
 * K7: this quantity used to be spelled five different ways across the app
 * ('8g', '8 games', a bare 'G' header, 'Games together', 'Games' vs 'Rtg'
 * casing) — reach for one of these two instead of a template string.
 */
export const games = (n: number): string => `${int(n)} game${n === 1 ? '' : 's'}`;

/** gamesShort(8) → "8g" — chart labels and tooltips ONLY; prose wants {@link games}. */
export const gamesShort = (n: number): string => `${int(n)}g`;

/** duration(125) → "2h 5m"; duration(45) → "45m" — minutes to a compact hour+minute label (H5's Heroes Time column). */
export const duration = (minutes: number): string => {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h > 0 ? `${h}h ${rem}m` : `${rem}m`;
};

/**
 * net(3) → "+3 net"; net(-4) → "−4 net" (wins − losses, signed via {@link signed}).
 * K7: this read as '-4 net' on Focus/Matches but 'net -4' on Overview and a
 * bare signed number on the Maps mode cards — one wording, one glyph.
 */
export const net = (n: number): string => `${signed(n)} net`;

/** pts(18) → "+18 pts"; pts(-24) → "−24 pts" — a winrate-point delta (Mental's cost cards, target lift). */
export const pts = (n: number): string => `${signed(n)} pts`;

/** ratio(0.76) → "0.76×" — always one decimal, the multiplier form used for load-vs-baseline reads. */
export const ratio = (n: number): string => `${n.toFixed(1)}×`;

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

/** True when `ts` falls on today's LOCAL calendar day — used to decide when a badge/label needs to name the date at all, not just the time (L5). */
export function isToday(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/**
 * epoch ms → a `<input type="datetime-local">` value, in LOCAL time (no
 * timezone suffix — matches how the browser itself both displays and
 * re-parses the field, so the round trip through `new Date(value).getTime()`
 * lands back on the same instant, L5's Played backfill on the log card and
 * the match editor).
 */
export function toDatetimeLocal(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `groupByDay` key/label ("Today", "Yesterday", or a raw `YYYY-MM-DD`) → a friendly short date. Shared by Matches and Review's day headers. */
export function prettyDay(label: string): string {
  if (label === 'Today' || label === 'Yesterday') return label;
  const d = new Date(`${label}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? label
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * The "played alongside" vs "played against" relation, spelled one way
 * everywhere (K7): Players called them "With me / Against me", the match
 * card called them "Together / As opponents", the player page mixed "As
 * teammates / As opponents" with "with you / vs you", and Live used a bare
 * "with / vs" — different enough that the CHANGELOG once had to explain that
 * "together" didn't mean your record together. `long` is for column headers
 * and split-out lines; `short` is for pills and a compact Side column.
 */
export const RELATION_LABEL = {
  with: { long: 'With you', short: 'with' },
  against: { long: 'Against you', short: 'vs' },
} as const;

/** Greeting appropriate to the local hour. */
export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}
