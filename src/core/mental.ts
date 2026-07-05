import { winLoss, type GameRecord } from './analytics';
import { leaverFlags, mergeLeaver } from './leaver';

/**
 * "Mental" analytics — the manual (◎) side of performance the game never
 * reports. Turns per-game self-reports into the composite the Mental view and
 * the sidebar show. Pure and I/O-free, like the rest of `core/`.
 */

export interface MentalSummary {
  calm: number; // 0..100
  tilted: number; // 0..100
  /**
   * Per-flag game counts. `leaver` is the combined count (either team, incl.
   * legacy records); `leaverMyTeam`/`leaverEnemyTeam` break it down by side.
   */
  flags: {
    tilt: number;
    toxicMates: number;
    leaver: number;
    leaverMyTeam: number;
    leaverEnemyTeam: number;
    positiveComms: number;
  };
  winWhenCalm: number; // 0..1
  winWhenTilted: number; // 0..1
}

const EMPTY: MentalSummary = {
  calm: 0,
  tilted: 0,
  flags: { tilt: 0, toxicMates: 0, leaver: 0, leaverMyTeam: 0, leaverEnemyTeam: 0, positiveComms: 0 },
  winWhenCalm: 0,
  winWhenTilted: 0,
};

export function mentalSummary(games: GameRecord[]): MentalSummary {
  if (!games.length) return { ...EMPTY, flags: { ...EMPTY.flags } };

  const flags = { tilt: 0, toxicMates: 0, leaver: 0, leaverMyTeam: 0, leaverEnemyTeam: 0, positiveComms: 0 };
  const tiltedGames: GameRecord[] = [];
  const calmGames: GameRecord[] = [];
  for (const g of games) {
    // A flag can come from the quick-log self-report or the Review-screen read;
    // OR-merge per flag so a game flagged in both sources still counts once.
    const m = g.mental ?? {};
    const r = g.review?.flags ?? {};
    const tilt = Boolean(m.tilt || r.tilt);
    if (tilt) flags.tilt++;
    if (m.toxicMates || r.toxicMates) flags.toxicMates++;
    const leaver = mergeLeaver(leaverFlags(m), leaverFlags(r));
    if (leaver.myTeam) flags.leaverMyTeam++;
    if (leaver.enemyTeam) flags.leaverEnemyTeam++;
    if (leaver.myTeam || leaver.enemyTeam) flags.leaver++;
    if (m.positiveComms || r.positiveComms) flags.positiveComms++;
    (tilt ? tiltedGames : calmGames).push(g);
  }

  const n = games.length;
  const tiltShare = flags.tilt / n;
  const posShare = flags.positiveComms / n;

  return {
    // Two independent axes: tilt is how often you flagged tilt; calm blends
    // "not tilted" with positive-comms games.
    tilted: pct(tiltShare),
    calm: pct(0.5 * (1 - tiltShare) + 0.5 * posShare),
    flags,
    winWhenCalm: winLoss(calmGames).winrate,
    winWhenTilted: winLoss(tiltedGames).winrate,
  };
}

const pct = (frac: number) => Math.round(Math.max(0, Math.min(1, frac)) * 100);
