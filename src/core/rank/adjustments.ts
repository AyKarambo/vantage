import type { Role } from '../model';
import { applyAdjustment } from './engine';
import {
  rankKey,
  type RankAdjustment, type RankAdjustmentReason, type RankAdjustmentStep, type RankAnchor, type RankAnchorMap, type RankState,
} from './types';

/**
 * Rank adjustments — rank changes that are not matches (cheater compensation,
 * manual corrections). Pure and I/O-free: the store keeps the records, this
 * module decides which ones move a track and folds them into a replay.
 *
 * The rules (issue #341):
 * - an adjustment strictly after its track's anchor (`at > setAt`) moves the
 *   running position exactly like a match's ±% would ({@link applyAdjustment});
 * - one at or before the anchor is ignored — the anchor reading already includes it;
 * - re-anchoring therefore keeps every adjustment that comes after the new anchor
 *   and drops the older ones from the replay, without deleting any record;
 * - it is never a match: nothing here feeds games, winrate, readiness or streaks.
 */

const ROLES: readonly Role[] = ['tank', 'damage', 'support', 'openQ'];
const REASONS: readonly RankAdjustmentReason[] = ['cheater-compensation', 'manual'];

/** Largest single adjustment accepted (%-points) — a whole division and then some; anything bigger is a typo. */
export const MAX_ADJUSTMENT_PCT = 200;

/**
 * Return a copy of `anchors` whose entries carry the adjustments that move them:
 * the ones on the same (account, role) track strictly after the anchor, oldest
 * first. Tracks with no such adjustment keep their anchor object as-is (no
 * `adjustments` field), so a map without adjustments is unchanged in content.
 */
export function attachAdjustments(anchors: RankAnchorMap, adjustments: readonly RankAdjustment[]): RankAnchorMap {
  const byKey = new Map<string, RankAdjustmentStep[]>();
  for (const a of adjustments) {
    const key = rankKey(a.account, a.role);
    const anchor = anchors[key];
    if (!anchor || !(a.at > anchor.setAt)) continue;
    const list = byKey.get(key);
    const step = { at: a.at, deltaPct: a.deltaPct };
    if (list) list.push(step);
    else byKey.set(key, [step]);
  }
  if (!byKey.size) return anchors;
  const out: RankAnchorMap = { ...anchors };
  for (const [key, steps] of byKey) {
    steps.sort((x, y) => x.at - y.at);
    out[key] = { ...anchors[key], adjustments: steps };
  }
  return out;
}

/** The anchor's adjustments that apply strictly after it, oldest first (defensive re-filter of the attached list). */
export function adjustmentSteps(anchor: RankAnchor): readonly RankAdjustmentStep[] {
  const steps = anchor.adjustments;
  if (!steps?.length) return [];
  return steps.filter((s) => s.at > anchor.setAt);
}

/**
 * A forward replay cursor over an anchor's adjustments: `until(ts, inclusive)`
 * applies every not-yet-applied adjustment with `at < ts` (or `<= ts`) to the
 * given state. Lets the match replays interleave adjustments in time order with
 * one pass over each list.
 */
export function adjustmentCursor(anchor: RankAnchor): {
  until(state: RankState, ts: number, inclusive?: boolean): RankState;
  rest(state: RankState): RankState;
} {
  const steps = adjustmentSteps(anchor);
  let i = 0;
  return {
    until(state, ts, inclusive = false) {
      let s = state;
      while (i < steps.length && (inclusive ? steps[i].at <= ts : steps[i].at < ts)) s = applyAdjustment(s, steps[i++].deltaPct);
      return s;
    },
    rest(state) {
      let s = state;
      while (i < steps.length) s = applyAdjustment(s, steps[i++].deltaPct);
      return s;
    },
  };
}

/** The user-supplied part of a new adjustment (the id is assigned by the store). */
export interface RankAdjustmentDraft {
  account: string;
  role: Role;
  at: number;
  deltaPct: number;
  reason: RankAdjustmentReason;
  note?: string;
}

/**
 * Validate an untrusted adjustment (IPC input, a backup row). Returns the
 * normalized draft, or a human-readable reason it was rejected. `deltaPct` is
 * rounded to whole %-points — the game only ever shows whole numbers.
 */
export function parseRankAdjustment(raw: unknown): { ok: true; value: RankAdjustmentDraft } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'Adjustment is not an object.' };
  const r = raw as Record<string, unknown>;
  const account = typeof r.account === 'string' ? r.account.trim() : '';
  if (!account) return { ok: false, reason: 'Missing account.' };
  if (typeof r.role !== 'string' || !ROLES.includes(r.role as Role)) return { ok: false, reason: 'Unknown role.' };
  if (typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at <= 0) return { ok: false, reason: 'Invalid date.' };
  if (typeof r.deltaPct !== 'number' || !Number.isFinite(r.deltaPct)) return { ok: false, reason: 'Amount must be a number.' };
  const deltaPct = Math.round(r.deltaPct);
  if (deltaPct === 0) return { ok: false, reason: 'Amount must not be 0.' };
  if (Math.abs(deltaPct) > MAX_ADJUSTMENT_PCT) return { ok: false, reason: `Amount must be within ±${MAX_ADJUSTMENT_PCT}%.` };
  const reason = typeof r.reason === 'string' && REASONS.includes(r.reason as RankAdjustmentReason)
    ? (r.reason as RankAdjustmentReason)
    : 'manual';
  const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 200) : undefined;
  return { ok: true, value: { account, role: r.role as Role, at: r.at, deltaPct, reason, ...(note ? { note } : {}) } };
}

/** A small "something moved the rank here" marker on a rank-over-time chart — never a match point. */
export interface RankAdjustmentMark {
  id: string;
  at: number;
  deltaPct: number;
  reason: RankAdjustmentReason;
}

/** The adjustments on one track at/after `sinceTs`, oldest first, as chart markers. */
export function adjustmentMarks(
  adjustments: readonly RankAdjustment[],
  account: string,
  role: Role,
  sinceTs: number,
): RankAdjustmentMark[] {
  return adjustments
    .filter((a) => a.account === account && a.role === role && a.at >= sinceTs)
    .sort((a, b) => a.at - b.at)
    .map((a) => ({ id: a.id, at: a.at, deltaPct: a.deltaPct, reason: a.reason }));
}
