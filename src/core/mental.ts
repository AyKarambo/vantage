import { winLoss, type GameRecord } from './analytics';

/**
 * "Mental" analytics — the manual (◎) side of performance the game never
 * reports. Turns per-game self-reports into the composite the Mental view and
 * the sidebar show. Pure and I/O-free, like the rest of `core/`.
 */

export interface MentalSummary {
  calm: number; // 0..100
  tilted: number; // 0..100
  breakReminderAfterLosses: number;
  flags: { tilt: number; toxicMates: number; leaver: number; positiveComms: number };
  winWhenCalm: number; // 0..1
  winWhenTilted: number; // 0..1
}

const EMPTY: MentalSummary = {
  calm: 0,
  tilted: 0,
  breakReminderAfterLosses: 2,
  flags: { tilt: 0, toxicMates: 0, leaver: 0, positiveComms: 0 },
  winWhenCalm: 0,
  winWhenTilted: 0,
};

export function mentalSummary(games: GameRecord[]): MentalSummary {
  if (!games.length) return { ...EMPTY };

  const flags = { tilt: 0, toxicMates: 0, leaver: 0, positiveComms: 0 };
  const tiltedGames: GameRecord[] = [];
  const calmGames: GameRecord[] = [];
  for (const g of games) {
    const m = g.mental ?? {};
    if (m.tilt) flags.tilt++;
    if (m.toxicMates) flags.toxicMates++;
    if (m.leaver) flags.leaver++;
    if (m.positiveComms) flags.positiveComms++;
    (m.tilt ? tiltedGames : calmGames).push(g);
  }

  const n = games.length;
  const tiltShare = flags.tilt / n;
  const posShare = flags.positiveComms / n;

  return {
    // Two independent axes: tilt is how often you flagged tilt; calm blends
    // "not tilted" with positive-comms games.
    tilted: pct(tiltShare),
    calm: pct(0.5 * (1 - tiltShare) + 0.5 * posShare),
    breakReminderAfterLosses: 2,
    flags,
    winWhenCalm: winLoss(calmGames).winrate,
    winWhenTilted: winLoss(tiltedGames).winrate,
  };
}

const pct = (frac: number) => Math.round(Math.max(0, Math.min(1, frac)) * 100);
