import type { ProAccess } from './entitlement';
import type { DashboardData, MatchRow } from '../shared/contract';

/**
 * Narrow a dashboard snapshot to what the viewer's Vantage Pro access allows
 * (spec #337). Pro-only fields are replaced by their values from `empty` — a
 * snapshot computed over no games — so the payload stays fully typed with no
 * optional-field ripple, and a free renderer simply has nothing Pro to show.
 *
 * Free stays untouched: matches, stats, maps, heroes, trends, focus, and every
 * mental INPUT (check-ins, review flags, the calm/tilted summary, the "How you
 * played" ratings). Only the coaching layer — readiness, targets, practice
 * mode and the mental analytics — is withheld.
 *
 * Pure: `full`/`empty` come from `computeDashboard`, `access` from the edge.
 */
export function gateDashboard(full: DashboardData, empty: DashboardData, access: ProAccess): DashboardData {
  if (access.full) return { ...full, pro: access };
  const keepTargets = access.targets === 'read-only';
  const recap = full.recap ? withoutKey(full.recap, 'targetHitRate') : undefined;
  return {
    ...full,
    pro: access,
    readiness: empty.readiness,
    practice: empty.practice,
    targets: keepTargets ? full.targets : empty.targets,
    focusItems: full.focusItems.map((e) => withoutKey(e, 'progress')),
    matches: full.matches.map(stripMatchRow),
    reviewInbox: full.reviewInbox.map(stripMatchRow),
    mentalCosts: empty.mentalCosts,
    tiltTrend: empty.tiltTrend,
    tiltBySession: empty.tiltBySession,
    tiltByTimeOfDay: empty.tiltByTimeOfDay,
    tiltAfterResult: empty.tiltAfterResult,
    tiltByMap: empty.tiltByMap,
    tiltByCheckIn: empty.tiltByCheckIn,
    tiltBySleep: empty.tiltBySleep,
    tiltByEnergy: empty.tiltByEnergy,
    ...(recap ? { recap } : {}),
  };
}

/** A match row without the target/practice layer. */
export function stripMatchRow(row: MatchRow): MatchRow {
  const { measuredGrades: _m, targetGrades: _t, suggestedFocus: _s, autoBreak: _b, ...rest } = row;
  return rest;
}

function withoutKey<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _drop, ...rest } = obj;
  return rest;
}
