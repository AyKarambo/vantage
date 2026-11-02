import type { DashboardData, TargetSummary } from '../../src/shared/contract';

/**
 * The Pro coaching layer as the FREE screens may use it (#337). Main already
 * withholds it from a free payload, but a lapsed subscriber keeps their
 * targets list (read-only, for the Targets screen) — so the free screens that
 * grade or brief against targets ask here instead of reading `data.targets`.
 */

/** Active, unarchived targets a free screen may grade or brief against — none without full access. */
export function gradableTargets(data: Pick<DashboardData, 'pro' | 'targets'>): TargetSummary[] {
  return data.pro.full ? data.targets.filter((t) => t.isActive && !t.archivedAt) : [];
}

/** Practice focus mode (#321) is Pro: it's on only with full access, whatever the setting says. */
export function practiceOn(data: Pick<DashboardData, 'pro' | 'practice'>): boolean {
  return data.pro.full && data.practice.on;
}
