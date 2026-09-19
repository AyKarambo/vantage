/**
 * Shared vocabulary of the analytics layer, which turns a list of completed
 * games into the aggregates the dashboard charts and the "what to focus on"
 * insights are built from. Pure and I/O-free so it is fully unit-testable and
 * reusable in the renderer.
 */
import type { Result, Role, HeroStat, RosterPlayer, RoundSpan } from '../model';
// From `rank/types` rather than the `rank` barrel: that module imports only
// `../model`, so this stays a leaf type import with no cycle back through the
// rank engine (which itself reads `GameRecord` from here).
import type { RankPosition } from '../rank/types';
import type { MapMode } from '../maps';

export type { HeroStat } from '../model';

/**
 * The tenor of team comms for a match — a single self-reported axis. `positive`
 * is the old {@link MatchMental.positiveComms} signal; `banter` is neutral;
 * `abusive` is a negative comms signal (distinct from a toxic teammate). Read
 * via {@link ../comms commsTone} so legacy `positiveComms:true` records still
 * resolve to `positive`.
 */
export type CommsTone = 'positive' | 'banter' | 'abusive';

/**
 * Manual (◎) after-game self-report — the "mental" signals the game never
 * reports. All optional; absent means the player didn't flag anything.
 */
export interface MatchMental {
  tilt?: boolean;
  toxicMates?: boolean;
  /**
   * Legacy single "someone left" flag. Newer records use the team-specific
   * flags below; readers treat a legacy `leaver: true` as a my-team leaver
   * (see {@link ../leaver leaverFlags}).
   */
  leaver?: boolean;
  /** A player left on the tracked player's team. */
  leaverMyTeam?: boolean;
  /** A player left on the enemy team. */
  leaverEnemyTeam?: boolean;
  /**
   * Legacy boolean "positive comms" flag, superseded by {@link comms}. Kept so
   * stored records keep reading correctly — resolve the comms signal through
   * {@link ../comms commsTone}/{@link ../comms isPositiveComms}, never this field
   * directly.
   * @deprecated use {@link comms}.
   */
  positiveComms?: boolean;
  /** Three-state comms tone; new writes set this instead of {@link positiveComms}. */
  comms?: CommsTone;
}

/** How the player graded one improvement target for one game. */
export type TargetGrade = 'hit' | 'partial' | 'missed';

/** The manual (◎) read attached to a tracked game on the Review screen. */
export interface MatchReview {
  /** When the review was saved. */
  at: number;
  /** targetId → grade; grades for deleted targets stay inert. */
  grades: Record<string, TargetGrade>;
  /** Feel flags — same shape as the quick-log self-report. */
  flags: MatchMental;
}

/** One finished game, already resolved to display values. */
export interface GameRecord {
  matchId: string;
  timestamp: number; // ms epoch (match end)
  account: string;
  role: Role;
  map: string;
  result: Result;
  gameType: string;
  /**
   * Where the record came from. Absent on older records — inferred from the
   * matchId prefix by {@link ../source sourceOf} (manual ids start with
   * `manual`). Auto-tracked (GEP) records keep their `source` even when their
   * facts are hand-corrected (see {@link factsEditedAt}).
   */
  source?: 'manual' | 'gep';
  /**
   * Epoch ms of the last hand-correction to an auto-tracked (GEP) match's game
   * facts (result/map/role/heroes) in the match editor — the honest "this was
   * edited" marker. Set only on `gep` records, and only when a fact actually
   * changed; the original game-reported value is not preserved (no revert).
   * Never set on hand-logged (`manual`) records, which are editable by nature.
   * See {@link ../../main/dataProvider editMatch}.
   */
  factsEditedAt?: number;
  /**
   * Signed skill-rating change for this competitive match, in percentage points
   * of a division (e.g. +22, -19) — the exact number the game showed. Manual,
   * competitive-only; feeds the calculated-rank engine ({@link ../rank}).
   */
  srDelta?: number;
  /**
   * The rank held going INTO this match — a SNAPSHOT, written when {@link srDelta}
   * is recorded and cleared when it is cleared.
   *
   * Stored rather than derived on read, deliberately. Every other rank figure in
   * the app is recomputed from the anchor and the ±% chain, which is right for
   * "what is my rank now" and wrong for "what did I have when I queued into this
   * game": correcting an older match's ±% would silently rewrite the answer for
   * every match after it. A stored snapshot keeps saying what it said.
   *
   * Absent when the match has no ±% at all. Without one the rank did not move
   * here, so a value would only repeat the previous match's and imply a
   * progression Vantage cannot actually vouch for. Also absent when the track had
   * no rank anchor at the time — nothing to snapshot from.
   */
  rankAtStart?: RankPosition;
  /** Wall-clock match length in whole minutes (the displayed "Duration"). Not a per-10 divisor — see {@link playedMinutes}. */
  durationMinutes?: number;
  /**
   * Minutes the player could actually fight — the per-10-minute divisor.
   * Measured from GEP round events on newer captures (see {@link ../playedTime});
   * absent on older captures and manual logs, where `playedTimeOf` estimates
   * it from the wall-clock duration at read time.
   */
  playedMinutes?: number;
  /** The GEP rounds behind {@link playedMinutes}, when the feed reported them. */
  rounds?: RoundSpan[];
  /** Self-rated performance for this match, 0-100, if the player rated it. */
  performance?: number;
  heroes: string[];
  /** Per-hero breakdown for the local player (from GEP roster), if available. */
  perHero?: HeroStat[];
  /** Round score, e.g. "2–1", when the feed reported one. */
  finalScore?: string;
  /** Latest roster snapshot per slot — whatever teams GEP reported (may be
   *  local team only). Absent on older records and manual logs. */
  roster?: RosterPlayer[];
  /** Manual self-report captured in the Log Match card, if the player added one. */
  mental?: MatchMental;
  /** The saved Review-screen read (target grades + feel flags), if graded. */
  review?: MatchReview;
  /**
   * Epoch ms of the import that brought this record into local history — set
   * only on imported games (never on live-tracked or hand-logged ones). Flags
   * the record so an import can be wiped and re-run cleanly without touching real
   * history ({@link ../../store/history HistoryStore.removeImported}). Pair with
   * {@link importSource} to tell which importer it came from.
   */
  importedAt?: number;
  /**
   * Which importer brought this record in — the provenance discriminator that
   * lets one import channel be cleared without disturbing another (e.g. wipe
   * file-imports while keeping Notion imports). Absent on live-tracked and
   * hand-logged records; also absent on legacy Notion imports that predate this
   * field, which are treated as `'notion'` (see `COALESCE(importSource,'notion')`
   * in {@link ../../store/history HistoryStore}).
   */
  importSource?: 'notion' | 'file';
}

/** Win/loss tally over a set of games — the unit every chart aggregates. */
export interface WinLoss {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Wins / decided games (draws excluded), 0..1. */
  winrate: number;
  /**
   * Net SR change (C2) over the games behind this bucket that logged one —
   * suppressed (placement-run) games are excluded, since a placement's SR
   * swing isn't comparable to a normal match's. Absent when nothing in the
   * bucket logged a delta, so "—" never reads as a real 0.
   */
  srNet?: number;
  /** How many games (unweighted count, even on a time-share-credited bucket) contributed to {@link srNet}. */
  srLogged?: number;
}

/** A WinLoss bucket labeled by its grouping key (map, role, hero, …). */
export interface Group extends WinLoss {
  key: string;
}

/**
 * A `trend` bucket (C6) with its trailing rolling winrate attached — see
 * {@link rollingWinrate}. Its own type rather than a field on the shared
 * {@link Group}: "rolling" only means something over a chronologically
 * ordered series, not an arbitrary grouping like by-map or by-hero.
 */
export interface TrendGroup extends Group {
  /** Game-weighted winrate over the trailing window ending at this bucket. */
  rolling: number;
}

/** The winrate-chart momentum read (C6): a trailing window compared against the one before it. */
export interface Momentum {
  /** Window length in days behind each side (7 daily, 28 = 4 ISO weeks in weekly mode). */
  days: number;
  recent: WinLoss;
  previous: WinLoss;
  /** `recent.winrate − previous.winrate`, in whole percentage points (already ×100, rounded). */
  deltaPts: number;
}

/** Net losses = losses − wins. Positive ⇒ a weakness worth focusing on. */
export interface FocusItem extends WinLoss {
  key: string;
  net: number;
}

/** Which gameplay dimension a focus entry ranks: a map, a hero, or a role queue. */
export type FocusDimension = 'map' | 'hero' | 'role';

/** Recent-half vs earlier-half winrate verdict for a focus entry's games. */
export type FocusTrend = 'improving' | 'flat' | 'declining';

/**
 * Feedback for a focus entry the player is already working on via a linked
 * improvement target — "is focusing this actually helping?".
 */
export interface FocusProgress {
  targetId: string;
  targetName: string;
  /** When the linked target was flagged (its `activatedAt ?? createdAt`). */
  since: number;
  /** Games matching this entry since {@link since}, over unfiltered history. */
  gamesSince: number;
  /**
   * Winrate change in points since the target was flagged (winrate since −
   * winrate before, ×100); only present when both windows hold ≥3 decided games.
   */
  deltaPts?: number;
}

/**
 * One row of the cross-dimension "work on these" list on the Focus screen: a
 * net-losing map, hero or role, with the closing-the-loop signals attached.
 */
export interface FocusEntry extends FocusItem {
  dimension: FocusDimension;
  /** Absent when the entry has too few games in range to split into halves. */
  trend?: FocusTrend;
  /**
   * The point delta behind {@link trend} (recent-half winrate − earlier-half,
   * H2) — same number the map row's tinted pill and the Focus Trend line
   * render, alongside the qualitative arrow.
   */
  trendPts?: number;
  /** Present when an active improvement target is linked to this entry. */
  progress?: FocusProgress;
  /**
   * The game mode a map entry sits in (H2), resolved in `dashboardData` with
   * the same resolver Matches rows use. Map entries only.
   */
  mode?: MapMode;
  /**
   * Top 3 heroes played in a map entry's games, by game count, each with its
   * OWN per-game win/loss record (H2) — deliberately per-game credit, not the
   * Heroes screen's time-share credit, since a swap segment isn't "most of
   * the game" on either hero. Map entries only.
   */
  heroes?: Array<{ hero: string; wins: number; losses: number }>;
  /**
   * Whether the entry's key is in the current competitive pool (H1) — only
   * ever `false` for a map dimension entry tagged out of pool via master
   * data; absent (heroes/roles, or when no lookup was supplied) reads as
   * in-pool, matching master data's own "missing ⇒ active" convention.
   */
  inPool?: boolean;
}

/**
 * Recent-form window for one hero (H6): the last {@link FORM_WINDOW} decided
 * WHOLE games on the hero, oldest → newest, plus how that window's winrate
 * compares to the hero's full (filtered) range.
 */
export interface HeroForm {
  results: Result[];
  /**
   * Window winrate − full-range winrate, in points. Absent when the window
   * covers every decided game in range (there's no distinct "earlier" to
   * compare against, so a delta would just be a number against itself).
   */
  deltaPp?: number;
}

/**
 * Per-hero rollup: winrate plus exact stat totals and per-10-minute averages.
 * `games`/`wins`/`losses`/`draws` are the career-profile style TIME-SHARE
 * credit (a hero played for a quarter of a won game earns 0.25 of a win),
 * rounded to whole numbers for display; `winrate` is computed from the
 * unrounded credit, which the `credited*` fields expose.
 */
export interface HeroSummary extends WinLoss {
  hero: string;
  role?: Role;
  /**
   * Recent-vs-earlier verdict (H6), computed in `dashboardData` over the
   * hero's WHOLE games in range via `focusTrend`/`focusGamesFor` — absent
   * under the same ≥6-game floor `focusTrend` applies to map entries.
   */
  trend?: FocusTrend;
  /** The last-10-games form strip (H6); absent when the hero has no decided games in range. */
  form?: HeroForm;
  /** Unrounded fractional credit behind `games` (sum of the hero's time shares). */
  creditedGames?: number;
  /** Unrounded fractional credit behind `wins`. */
  creditedWins?: number;
  /** Unrounded fractional credit behind `losses`. */
  creditedLosses?: number;
  totals: Omit<HeroStat, 'hero' | 'role' | 'minutes'>;
  /** Per-10-PLAYED-minute averages (null when no usable time data). */
  per10: Pick<HeroStat, 'eliminations' | 'deaths' | 'assists' | 'damage' | 'healing' | 'mitigation'> | null;
  kda: number; // (elims + assists) / max(deaths, 1)
  /** Total played minutes on this hero (H5) — the sample-size signal a rounded game count can't carry: a 3-game hero with 9 minutes reads very differently from one with 40. */
  minutes: number;
  /**
   * Winrate change vs. the same hero's line in the previous comparison
   * window (C3, `DashboardData.previous`), in whole percentage points
   * (already ×100, e.g. `+3.2`). Absent when either window has zero decided
   * games for this hero — a delta against nothing isn't a real number.
   */
  deltaWinrate?: number;
  /** Games played this window minus games played in the previous one (C3); 0 when the hero wasn't touched by the delta, absent only when there's no previous window at all. */
  deltaGames?: number;
}

/** Streak of the most recent decided games. */
export interface Streak {
  type: 'W' | 'L' | 'none';
  count: number;
}
