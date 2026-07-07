import { winLoss, type GameRecord } from './analytics';
import { leaverFlags, mergeLeaver } from './leaver';
import { isPositiveComms, isAbusiveComms } from './comms';

/**
 * "Mental" analytics — the manual (◎) side of performance the game never
 * reports. Turns per-game self-reports into the composite the Mental view and
 * the sidebar show. Pure and I/O-free, like the rest of `core/`.
 */

/** A drill-down-able per-row mental flag (the vocabulary `rowFlags` speaks). */
export type MatchFlagKey = 'tilt' | 'toxicMates' | 'leaver' | 'positiveComms' | 'abusive';

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
    /** Games flagged with abusive comms — a negative comms signal. */
    abusive: number;
  };
  winWhenCalm: number; // 0..1
  winWhenTilted: number; // 0..1
  /**
   * Decided (win+loss, draws excluded) sample sizes behind `winWhenCalm` /
   * `winWhenTilted` — `flags.tilt` counts ALL tilt-flagged games (incl.
   * draws), so it overstates how many decided games back the tilted
   * winrate. Callers must gate the tilt-tax claim on these, not `flags.tilt`.
   */
  tiltedDecided: number;
  calmDecided: number;
}

const EMPTY: MentalSummary = {
  calm: 0,
  tilted: 0,
  flags: { tilt: 0, toxicMates: 0, leaver: 0, leaverMyTeam: 0, leaverEnemyTeam: 0, positiveComms: 0, abusive: 0 },
  winWhenCalm: 0,
  winWhenTilted: 0,
  tiltedDecided: 0,
  calmDecided: 0,
};

export function mentalSummary(games: GameRecord[]): MentalSummary {
  if (!games.length) return { ...EMPTY, flags: { ...EMPTY.flags } };

  const flags = { tilt: 0, toxicMates: 0, leaver: 0, leaverMyTeam: 0, leaverEnemyTeam: 0, positiveComms: 0, abusive: 0 };
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
    if (isPositiveComms(m) || isPositiveComms(r)) flags.positiveComms++;
    if (isAbusiveComms(m) || isAbusiveComms(r)) flags.abusive++;
    (tilt ? tiltedGames : calmGames).push(g);
  }

  const n = games.length;
  const tiltShare = flags.tilt / n;
  const posShare = flags.positiveComms / n;
  const calmResult = winLoss(calmGames);
  const tiltedResult = winLoss(tiltedGames);

  return {
    // Two independent axes: tilt is how often you flagged tilt; calm blends
    // "not tilted" with positive-comms games.
    tilted: pct(tiltShare),
    calm: pct(0.5 * (1 - tiltShare) + 0.5 * posShare),
    flags,
    winWhenCalm: calmResult.winrate,
    winWhenTilted: tiltedResult.winrate,
    tiltedDecided: tiltedResult.wins + tiltedResult.losses,
    calmDecided: calmResult.wins + calmResult.losses,
  };
}

const pct = (frac: number) => Math.round(Math.max(0, Math.min(1, frac)) * 100);

/**
 * Per-row merged mental flags for one game — the same OR-merge (incl. the
 * leaver side-merge) `mentalSummary` uses, but keyed for a single `MatchRow`
 * instead of aggregated across a range. Returns `undefined` when nothing is
 * flagged, so `MatchRow.flags` can stay optional and lean.
 */
export function rowFlags(g: GameRecord): Partial<Record<MatchFlagKey, true>> | undefined {
  const m = g.mental ?? {};
  const r = g.review?.flags ?? {};
  const leaver = mergeLeaver(leaverFlags(m), leaverFlags(r));

  const out: Partial<Record<MatchFlagKey, true>> = {};
  if (m.tilt || r.tilt) out.tilt = true;
  if (m.toxicMates || r.toxicMates) out.toxicMates = true;
  if (leaver.myTeam || leaver.enemyTeam) out.leaver = true;
  if (isPositiveComms(m) || isPositiveComms(r)) out.positiveComms = true;
  if (isAbusiveComms(m) || isAbusiveComms(r)) out.abusive = true;

  return Object.keys(out).length ? out : undefined;
}
