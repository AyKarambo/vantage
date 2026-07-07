/**
 * Automatic grading of MEASURED (⚡) improvement targets from a match's stats.
 * A measured target's rule (`"${stat} ${op} ${value}"`) is evaluated against the
 * match's per-10-minute value for that stat — no human read required. This is the
 * single evaluator behind all three consumers (in-app scoring, the Review
 * read-only display, and the Notion export), so the number shown in-app always
 * equals the one exported.
 *
 * Pure and Electron-free. Per-10 math mirrors {@link ../analytics/heroStats}: rate
 * stats are `total × 10 / durationMinutes`, rounded to integers for damage/healing/
 * mitigation and one decimal for the count rates; KDA is the ratio, not a rate.
 */
import type { GameRecord, HeroStat, TargetGrade } from '../analytics';
import { aggregateImprovementGrade } from './aggregateGrade';
import { NOTION_IMPROVEMENT_TARGET_ID } from './notionBookkeeping';
import type { AuthoredTarget } from './types';

export type MeasuredOp = '≤' | '≥' | '=';

export interface ParsedRule {
  stat: string;
  op: MeasuredOp;
  value: number;
}

// Keep this regex identical to the builder's round-trip (renderer/src/views/targets/builder.ts):
// the stat is everything before the operator, the value everything after.
const RULE_RE = /^(.+) (≤|≥|=) (.+)$/;

/** Parse a measured rule string into stat/op/value, or `null` if it isn't one. */
export function parseMeasuredRule(rule: string): ParsedRule | null {
  const m = rule.match(RULE_RE);
  if (!m) return null;
  const value = Number(m[3].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return { stat: m[1], op: m[2] as MeasuredOp, value };
}

/** Serialize a measured rule — the inverse of {@link parseMeasuredRule}. */
export function formatMeasuredRule(stat: string, op: string, value: string | number): string {
  return `${stat} ${op} ${value}`;
}

/** Stat label → the `HeroStat` numeric field it sums. KDA is derived, not a field. */
const STAT_FIELD: Record<string, keyof Pick<HeroStat, 'eliminations' | 'deaths' | 'assists' | 'damage' | 'healing' | 'mitigation'>> = {
  Eliminations: 'eliminations',
  Deaths: 'deaths',
  Assists: 'assists',
  Damage: 'damage',
  Healing: 'healing',
  Mitigation: 'mitigation',
};

const round1 = (n: number): number => Math.round(n * 10) / 10;
const sum = (rows: readonly HeroStat[], field: keyof HeroStat): number =>
  rows.reduce((n, r) => n + (r[field] as number), 0);

/**
 * The match's value for a measured stat: per-10-minute rate for volume stats,
 * the match KDA ratio for `KDA`. Returns `null` when the stat can't be measured
 * for this match — no per-hero stats, or (for rate stats) no duration — so the
 * caller can skip it rather than record a false grade.
 */
export function matchStatValue(game: GameRecord, stat: string): number | null {
  const rows = game.perHero;
  if (!rows || !rows.length) return null;

  if (stat === 'KDA') {
    const deaths = sum(rows, 'deaths');
    return round1((sum(rows, 'eliminations') + sum(rows, 'assists')) / Math.max(deaths, 1));
  }

  const field = STAT_FIELD[stat];
  if (!field) return null;
  const minutes = game.durationMinutes;
  if (!minutes || minutes <= 0) return null;
  const per10 = sum(rows, field) * (10 / minutes);
  // Integer for damage/healing/mitigation, one decimal for the count rates —
  // exactly what heroStats shows, so the grade matches the displayed number.
  return field === 'damage' || field === 'healing' || field === 'mitigation'
    ? Math.round(per10)
    : round1(per10);
}

/** Partial-credit margin: within 10% of the threshold on the failing side. */
const MARGIN = 0.1;

function gradeFor(op: MeasuredOp, threshold: number, value: number): TargetGrade {
  if (op === '≥') {
    if (value >= threshold) return 'hit';
    return value >= threshold * (1 - MARGIN) ? 'partial' : 'missed';
  }
  if (op === '≤') {
    if (value <= threshold) return 'hit';
    return value <= threshold * (1 + MARGIN) ? 'partial' : 'missed';
  }
  // '=' — a tolerance window; near-useless on per-10 floats but kept for completeness.
  const diff = Math.abs(value - threshold);
  if (diff <= Math.abs(threshold) * MARGIN) return 'hit';
  return diff <= Math.abs(threshold) * 2 * MARGIN ? 'partial' : 'missed';
}

/**
 * Auto-grade a measured target against one match. Returns the grade and the
 * underlying per-10/ratio value, or `null` when the match can't measure this
 * target (no stat / no duration) — a skip, never a miss.
 */
export function evaluateMeasured(
  game: GameRecord,
  target: Pick<AuthoredTarget, 'rule'>,
): { grade: TargetGrade; value: number } | null {
  const rule = parseMeasuredRule(target.rule);
  if (!rule) return null;
  const value = matchStatValue(game, rule.stat);
  if (value === null) return null;
  return { grade: gradeFor(rule.op, rule.value, value), value };
}

/**
 * The effective per-target grade map an export/aggregate should see: the stored
 * (self-rated) grades with every MEASURED target's grade replaced by its
 * stat-derived value, or removed when this match can't measure it — so a stale
 * stored grade can never leak through. Ids not in `targets` pass through
 * untouched. Used by the Notion export so measured targets contribute to the
 * exported aggregate exactly as they do in-app.
 */
export function foldMeasuredGradesForExport(
  base: Record<string, TargetGrade> | undefined,
  targets: readonly AuthoredTarget[],
  game: GameRecord,
): Record<string, TargetGrade> {
  const out: Record<string, TargetGrade> = { ...(base ?? {}) };
  for (const t of targets) {
    if (t.mode !== 'measured') continue;
    const res = evaluateMeasured(game, t);
    if (res) out[t.id] = res.grade;
    else delete out[t.id];
  }
  return out;
}

/**
 * The single Improvement Target grade a Notion export should write for one
 * match, with measured (⚡) targets auto-graded from stats folded in over the
 * stored (self-rated) grades. The export loop and the import-ledger baseline
 * both call this, so they compute an identical grade — and therefore an
 * identical {@link ../targets/notionBookkeeping matchExportSignature} — which is
 * what keeps "changed since last export" detection correct.
 */
export function effectiveImprovementGrade(
  game: GameRecord,
  authored: readonly AuthoredTarget[],
  visibleTargetIds: ReadonlySet<string>,
): TargetGrade | undefined {
  const grades = foldMeasuredGradesForExport(game.review?.grades, authored, game);
  const review = game.review ? { ...game.review, grades } : { at: 0, grades, flags: {} };
  return aggregateImprovementGrade(review, { visibleTargetIds, bookkeepingId: NOTION_IMPROVEMENT_TARGET_ID });
}
