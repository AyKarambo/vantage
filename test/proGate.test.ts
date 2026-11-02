import { describe, it, expect } from 'vitest';
import { generateSampleGames } from '../src/core/sampleData';
import { computeDashboard } from '../src/core/dashboardData';
import { gateDashboard } from '../src/core/proGate';
import { proAccess, FULL_PRO_ACCESS } from '../src/core/entitlement';

const demo = { active: true, preference: 'on' as const, hasRealHistory: false };
// The demo dataset carries sample targets, practice and grades — a payload with every Pro field populated.
const full = computeDashboard(generateSampleGames(180, 42), { days: 'all' }, demo);
// The edge computes the neutral snapshot with demo OFF — gating only bites when demo isn't showing.
const empty = computeDashboard([], { days: 'all' }, { active: false, preference: 'off', hasRealHistory: true });
const free = proAccess({ tier: 'free' }, false, 'none');
const lapsed = proAccess({ tier: 'lapsed' }, false, 'none');

describe('gateDashboard', () => {
  it('ungated snapshots default to full access', () => {
    expect(full.pro).toEqual(FULL_PRO_ACCESS);
  });

  it('full access passes the snapshot through, stamping the access', () => {
    const access = proAccess({ tier: 'pro' }, false, 'simulated');
    const d = gateDashboard(full, empty, access);
    expect(d.pro).toBe(access);
    expect(d.targets).toBe(full.targets);
    expect(d.readiness).toBe(full.readiness);
  });

  it('free: readiness, practice, targets and mental analytics carry empty-history values', () => {
    expect(full.targets.length).toBeGreaterThan(0); // the fixture really has Pro data to strip
    const d = gateDashboard(full, empty, free);
    expect(d.pro).toBe(free);
    expect(d.readiness).toEqual({ ...empty.readiness, mainAccount: full.readiness.mainAccount });
    expect(d.practice).toEqual(empty.practice);
    expect(d.targets).toEqual([]);
    expect(d.mentalCosts).toEqual(empty.mentalCosts);
    expect(d.tiltTrend).toEqual(empty.tiltTrend);
    expect(d.tiltBySession).toEqual(empty.tiltBySession);
    expect(d.tiltByCheckIn).toEqual(empty.tiltByCheckIn);
    expect(d.recap?.targetHitRate).toBeUndefined();
  });

  it('free: match rows lose the target/practice layer but keep everything else', () => {
    const d = gateDashboard(full, empty, free);
    for (const row of [...d.matches, ...d.reviewInbox]) {
      expect(row.measuredGrades).toBeUndefined();
      expect(row.targetGrades).toBeUndefined();
      expect(row.suggestedFocus).toBeUndefined();
      expect(row.autoBreak).toBeUndefined();
    }
    expect(d.matches.length).toBe(full.matches.length);
    expect(d.focusItems.every((e) => e.progress === undefined)).toBe(true);
    expect(d.focusItems.length).toBe(full.focusItems.length);
  });

  it('free: stats, matches and mental inputs are untouched', () => {
    const d = gateDashboard(full, empty, free);
    expect(d.overall).toBe(full.overall);
    expect(d.byMap).toBe(full.byMap);
    expect(d.heroStats).toBe(full.heroStats);
    expect(d.trend).toBe(full.trend);
    expect(d.checkIns).toBe(full.checkIns);
    expect(d.mental).toBe(full.mental);
    expect(d.performance).toBe(full.performance);
  });

  it('lapsed keeps the targets list (read-only) but withholds the rest', () => {
    const d = gateDashboard(full, empty, lapsed);
    expect(d.targets).toBe(full.targets);
    expect(d.readiness).toEqual({ ...empty.readiness, mainAccount: full.readiness.mainAccount });
    expect(d.practice).toEqual(empty.practice);
  });
});
