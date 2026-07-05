/**
 * Temporal splits: when you play vs how you perform. `byTimeOfDay` buckets games
 * into local day-parts; `bySessionPosition` buckets them by their game number
 * within a sitting (gap-based sessions, same 90-minute convention as the
 * readiness module). `sessionFade` reads the position split for the point where
 * winrate falls off — the "stop before game N" coach signal.
 */
import type { GameRecord, Group } from './types';
import { winLoss } from './grouping';

/** Day-part buckets in display order. Bounds are [from, to) local hours. */
const DAY_PARTS: Array<{ key: string; from: number; to: number }> = [
  { key: 'Morning', from: 5, to: 12 },
  { key: 'Afternoon', from: 12, to: 17 },
  { key: 'Evening', from: 17, to: 22 },
  { key: 'Night', from: 22, to: 5 }, // wraps midnight
];

/** Winrate per local day-part (Morning/Afternoon/Evening/Night), empty buckets omitted. */
export function byTimeOfDay(games: GameRecord[]): Group[] {
  const buckets = new Map<string, GameRecord[]>(DAY_PARTS.map((p) => [p.key, []]));
  for (const g of games) {
    const hour = new Date(g.timestamp).getHours();
    const part = DAY_PARTS.find((p) => (p.from < p.to ? hour >= p.from && hour < p.to : hour >= p.from || hour < p.to));
    buckets.get(part!.key)!.push(g);
  }
  return DAY_PARTS
    .map((p) => ({ key: p.key, ...winLoss(buckets.get(p.key)!) }))
    .filter((g) => g.games > 0);
}

/** Gap between match-end timestamps that starts a new sitting (readiness convention). */
const SESSION_GAP_MINUTES = 90;
/** Positions past this are pooled into the final "N+" bucket. */
const MAX_POSITION = 6;

/**
 * Winrate by game number within a session: '1'..'5' and '6+'. A session is a
 * run of games with less than `gapMinutes` between consecutive end timestamps.
 * Empty buckets are omitted; order is always 1 → 6+.
 */
export function bySessionPosition(games: GameRecord[], gapMinutes: number = SESSION_GAP_MINUTES): Group[] {
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = gapMinutes * 60_000;
  const buckets = new Map<string, GameRecord[]>();
  let prev: GameRecord | null = null;
  let position = 0;
  for (const g of sorted) {
    position = prev !== null && g.timestamp - prev.timestamp <= gapMs ? position + 1 : 1;
    const key = position >= MAX_POSITION ? `${MAX_POSITION}+` : String(position);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(g);
    prev = g;
  }
  const order = [...Array.from({ length: MAX_POSITION - 1 }, (_, i) => String(i + 1)), `${MAX_POSITION}+`];
  return order
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, ...winLoss(buckets.get(key)!) }));
}

/** The session-fade read: where late-session winrate falls off vs the session start. */
export interface SessionFade {
  /** Bucket key where the fade starts ('3'..'6+'). */
  position: string;
  /** Winrate at/after that position. */
  winrate: number;
  /** Early-session baseline (games 1–2). */
  baseline: number;
}

/** Winrate points a late bucket must sit below the early baseline to count as fade. */
const FADE_DROP = 0.08;

/**
 * Detect the first late-session position whose winrate sits well below the
 * games-1–2 baseline. Sample-size gated on both sides (`minGames` decided games)
 * so a couple of unlucky game-fives never triggers coaching. Null = no read.
 */
export function sessionFade(positions: Group[], minGames = 8): SessionFade | null {
  const early = positions.filter((p) => p.key === '1' || p.key === '2');
  const earlyDecided = early.reduce((n, p) => n + p.wins + p.losses, 0);
  if (earlyDecided < minGames) return null;
  const baseline = early.reduce((n, p) => n + p.wins, 0) / earlyDecided;
  for (const p of positions) {
    if (p.key === '1' || p.key === '2') continue;
    if (p.wins + p.losses >= minGames && p.winrate <= baseline - FADE_DROP) {
      return { position: p.key, winrate: p.winrate, baseline };
    }
  }
  return null;
}
