/**
 * The Overview's computed headline (O1) — one sentence stating the single
 * most useful thing the dashboard already knows, instead of the same
 * "you're 51% — here's where the points are hiding" every day regardless of
 * what's actually going on. The app already derives sharper reads and hides
 * them behind navigation (rank movement on Trends, a role deficit on Focus,
 * session fade on Trends); this surfaces the strongest one where the player
 * actually lands first.
 *
 * Renderer-side, not `src/core/`, on purpose: every input here is already a
 * DERIVED `DashboardData` field (not raw games), and composing "which
 * already-computed fact is most worth saying right now, and which screen
 * explains it" is a presentation decision, not new domain analytics — this
 * would otherwise need `src/core/` to import contract-shaped types it isn't
 * allowed to depend on. Still pure and fully unit-testable (this codebase
 * already tests other renderer-side pure modules the same way).
 *
 * Comparing "a 31% rank swing" against "a role costing 8 net losses" against
 * "you fade from game 4 on" has no objectively correct common unit, so this
 * deliberately does NOT try to score them against each other — it checks a
 * FIXED priority order (most consequential and most actionable first) and
 * returns the first candidate that clears its own sample gate, rather than
 * inventing a cross-domain number nobody could sanity-check.
 */
import type { DashboardData, FocusEntry } from '../../src/shared/contract';
import { sessionFade } from '../../src/core/analytics';
import { RANK_MOVEMENT_NEUTRAL_THRESHOLD } from '../../src/core/rankDisplay';
import { roleLabel } from './format';
import type { ViewId, ViewParams } from './store';

/** A role/map deficit needs at least this many games before it's a headline-worthy claim, not noise. */
const ROLE_DEFICIT_MIN_GAMES = 30;

export interface CoachHeadline {
  text: string;
  /** Present when the headline has a screen that explains it further — renders as a "Why →" link. */
  source?: ViewId;
  params?: ViewParams;
}

const FALLBACK: CoachHeadline = { text: 'No strong signal yet — keep logging.' };

/** The strongest single coaching read available right now, or {@link FALLBACK}. */
export function coachHeadline(d: DashboardData): CoachHeadline {
  return rankMovementHeadline(d) ?? roleDeficitHeadline(d) ?? sessionFadeHeadline(d) ?? FALLBACK;
}

/** A real anchored rank that's moved meaningfully — the single most consequential number the app tracks. */
function rankMovementHeadline(d: DashboardData): CoachHeadline | undefined {
  const r = d.primaryRank;
  if (!r || Math.abs(r.movement) <= RANK_MOVEMENT_NEUTRAL_THRESHOLD) return undefined;
  const dir = r.movement > 0 ? 'up' : 'down';
  const verb = r.movement > 0 ? 'climbing' : 'sliding';
  // Attribute to whichever role is dragging/carrying the range, when one
  // clearly is — "Tank is carrying it" needs a real deficit/surplus behind
  // it, not just whichever role happens to sort first.
  const roles = d.byRole.filter((g) => g.wins + g.losses >= 8);
  const standout = roles.length
    ? [...roles].sort((a, b) => Math.abs(b.wins - b.losses) - Math.abs(a.wins - a.losses))[0]
    : undefined;
  const attribution = standout && Math.abs(standout.wins - standout.losses) >= 3
    ? ` — ${roleLabel(standout.key)} is ${standout.wins >= standout.losses ? 'carrying it' : 'dragging it down'}`
    : '';
  return {
    text: `You're ${dir} ${signedPct(r.movement)} this range, ${verb}${attribution}.`,
    source: 'trends',
  };
}

/** A well-evidenced net-losing role — Focus's own sample-aware ranking, gated further to a real sample. */
function roleDeficitHeadline(d: DashboardData): CoachHeadline | undefined {
  const worst = d.focusItems
    .filter((e): e is FocusEntry => e.dimension === 'role' && e.games >= ROLE_DEFICIT_MIN_GAMES)
    .sort((a, b) => b.net - a.net)[0];
  if (!worst) return undefined;
  return {
    text: `${roleLabel(worst.key)} is costing you ${worst.net} net losses over ${worst.games} games this range.`,
    source: 'focus',
  };
}

/** A detected late-sitting decline — a concrete behavioral fix ("stop earlier"), not just a number. */
function sessionFadeHeadline(d: DashboardData): CoachHeadline | undefined {
  const fade = sessionFade(d.sessionPosition);
  if (!fade) return undefined;
  return {
    text: `You drop to ${Math.round(fade.winrate * 100)}% from game ${fade.position} on — ending sessions earlier is free rank.`,
    source: 'trends',
  };
}

const signedPct = (n: number): string => `${n > 0 ? '+' : '−'}${Math.round(Math.abs(n))}%`;
