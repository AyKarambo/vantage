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
import type { Role } from '../model';
import { effectiveHeroMinutes, mergeHeroStats } from '../perHero';
import { heroMatchKey } from '../heroes';
import { aggregateImprovementGrade } from './aggregateGrade';
import { NOTION_IMPROVEMENT_TARGET_ID } from './notionBookkeeping';
import type { AuthoredTarget } from './types';

export type MeasuredOp = '≤' | '≥' | '=';

/** Optional role/hero scope for a measured evaluation (D). Both absent = global. */
export interface MeasuredScope {
  roleScope?: Role;
  heroScope?: string;
}

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
 * Compute a measured stat over a set of hero rows spanning `minutes`. KDA is the
 * (elim + assist) / max(death, 1) ratio (duration-independent); volume stats are
 * `Σfield × 10 / minutes`, rounded to integers for damage/healing/mitigation and
 * one decimal for the count rates — exactly what {@link ../analytics/heroStats}
 * shows, so the grade always matches the displayed number. Returns `null` for a
 * rate stat when `minutes <= 0` (KDA still computes). Shared by the unscoped and
 * scoped paths so the rounding can never drift between them.
 */
function statOver(rows: readonly HeroStat[], stat: string, minutes: number): number | null {
  if (stat === 'KDA') {
    const deaths = sum(rows, 'deaths');
    return round1((sum(rows, 'eliminations') + sum(rows, 'assists')) / Math.max(deaths, 1));
  }
  const field = STAT_FIELD[stat];
  if (!field) return null;
  if (minutes <= 0) return null;
  const per10 = sum(rows, field) * (10 / minutes);
  return field === 'damage' || field === 'healing' || field === 'mitigation'
    ? Math.round(per10)
    : round1(per10);
}

/**
 * The match's value for a measured stat: per-10-minute rate for volume stats,
 * the match KDA ratio for `KDA`. Returns `null` when the stat can't be measured
 * for this match — no per-hero stats, or (for rate stats) no duration — so the
 * caller can skip it rather than record a false grade.
 *
 * With a `scope` (D), the value is computed over only the in-scope hero rows:
 * `roleScope` keeps rows of that role (and skips open-queue matches entirely),
 * `heroScope` keeps a single hero (matched via {@link ../heroes heroMatchKey}).
 * When no row is in scope the match is skipped (`null`) — never a miss; this also
 * makes a contradictory role+hero combo permanently skip, and skips a role-scoped
 * target on rows whose role GEP never reported. Both scope fields absent keeps the
 * original whole-match behavior exactly.
 */
export function matchStatValue(game: GameRecord, stat: string, scope?: MeasuredScope): number | null {
  const rows = game.perHero;
  if (!rows || !rows.length) return null;

  const roleScope = scope?.roleScope;
  const heroScope = scope?.heroScope;

  // Unscoped: sum every row over the whole match duration (legacy behavior).
  if (roleScope == null && heroScope == null) {
    return statOver(rows, stat, game.durationMinutes ?? 0);
  }

  // A role-scoped target can't apply to an open-queue match.
  if (roleScope != null && game.role === 'openQ') return null;

  const merged = mergeHeroStats(rows);
  const scoped = merged.filter(
    (r) =>
      (roleScope == null || r.role === roleScope) &&
      (heroScope == null || heroMatchKey(r.hero) === heroMatchKey(heroScope)),
  );
  if (scoped.length === 0) return null;

  // Effective minutes are the real (or equal-split) minutes of the in-scope
  // heroes; the equal split still divides by the full merged roster size.
  const minutes = scoped.reduce(
    (m, r) => m + (effectiveHeroMinutes(r, merged.length, game.durationMinutes) ?? 0),
    0,
  );
  return statOver(scoped, stat, minutes);
}

/**
 * Default partial-credit margin: a measured value within 20% of the threshold on
 * the failing side still grades `partial` rather than `missed`. This is the
 * fallback and the single default source; the user can override it globally via
 * {@link ../gradingSettings GradingSettings.partialMargin}, threaded in as the
 * `margin` argument on every function below.
 */
export const DEFAULT_PARTIAL_MARGIN = 0.2;

function gradeFor(op: MeasuredOp, threshold: number, value: number, margin: number = DEFAULT_PARTIAL_MARGIN): TargetGrade {
  if (op === '≥') {
    if (value >= threshold) return 'hit';
    return value >= threshold * (1 - margin) ? 'partial' : 'missed';
  }
  if (op === '≤') {
    if (value <= threshold) return 'hit';
    return value <= threshold * (1 + margin) ? 'partial' : 'missed';
  }
  // '=' — a tolerance window; near-useless on per-10 floats but kept for completeness.
  const diff = Math.abs(value - threshold);
  if (diff <= Math.abs(threshold) * margin) return 'hit';
  return diff <= Math.abs(threshold) * 2 * margin ? 'partial' : 'missed';
}

/**
 * Auto-grade a measured target against one match. Returns the grade and the
 * underlying per-10/ratio value, or `null` when the match can't measure this
 * target (no stat / no duration) — a skip, never a miss.
 */
export function evaluateMeasured(
  game: GameRecord,
  target: Pick<AuthoredTarget, 'rule' | 'roleScope' | 'heroScope'>,
  margin: number = DEFAULT_PARTIAL_MARGIN,
): { grade: TargetGrade; value: number } | null {
  const rule = parseMeasuredRule(target.rule);
  if (!rule) return null;
  const value = matchStatValue(game, rule.stat, { roleScope: target.roleScope, heroScope: target.heroScope });
  if (value === null) return null;
  return { grade: gradeFor(rule.op, rule.value, value, margin), value };
}

/**
 * The active, non-archived MEASURED targets that auto-grade a match — excludes
 * the internal Notion bookkeeping id. The single shared filter behind the
 * dashboard match rows and the match-detail Grades card, so they can't drift on
 * which targets count.
 */
export function activeMeasuredTargets(authored: readonly AuthoredTarget[]): AuthoredTarget[] {
  return authored.filter(
    (t) => t.mode === 'measured' && t.isActive && !t.archivedAt && t.id !== NOTION_IMPROVEMENT_TARGET_ID,
  );
}

/**
 * Auto-grade every target in `targets` against one match, keyed by id: the
 * derived grade + underlying per-10/ratio value, or the `'no-stat'` sentinel
 * when the match can't measure it (a skip shown neutral — never a miss). Shared
 * by the dashboard match rows and the match-detail Grades card so both compute
 * identically. `margin` defaults to {@link DEFAULT_PARTIAL_MARGIN}; callers pass
 * the user's configured value.
 */
export function measuredGradesForMatch(
  game: GameRecord,
  targets: readonly AuthoredTarget[],
  margin: number = DEFAULT_PARTIAL_MARGIN,
): Record<string, { grade: TargetGrade; value: number } | 'no-stat'> {
  const out: Record<string, { grade: TargetGrade; value: number } | 'no-stat'> = {};
  for (const t of targets) {
    const res = evaluateMeasured(game, t, margin);
    out[t.id] = res ? { grade: res.grade, value: res.value } : 'no-stat';
  }
  return out;
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
  margin: number = DEFAULT_PARTIAL_MARGIN,
): Record<string, TargetGrade> {
  const out: Record<string, TargetGrade> = { ...(base ?? {}) };
  for (const t of targets) {
    if (t.mode !== 'measured') continue;
    const res = evaluateMeasured(game, t, margin);
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
  margin: number = DEFAULT_PARTIAL_MARGIN,
): TargetGrade | undefined {
  const grades = foldMeasuredGradesForExport(game.review?.grades, authored, game, margin);
  const review = game.review ? { ...game.review, grades } : { at: 0, grades, flags: {} };
  return aggregateImprovementGrade(review, { visibleTargetIds, bookkeepingId: NOTION_IMPROVEMENT_TARGET_ID });
}
