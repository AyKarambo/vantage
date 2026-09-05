/**
 * The session back stack: a bounded trail of the routes BEHIND the current one,
 * oldest first. Pure and DOM-free (the `scrollNav.ts` discipline) so every rule
 * here is unit-tested under vitest's node environment — the renderer is not
 * under `src/core/`, so `test/backStack.test.ts` is where DoD 3 lands.
 *
 * The store owns the one mutable instance and supplies the staleness predicate;
 * nothing here knows about the store, the DOM, or a data snapshot. The only
 * import is type-only, so a *value* import of `./store` can never execute
 * `new Store()` (which would reach for `localStorage`) inside a test.
 *
 * Named `backStack`, not `history`: in this repo "history" already means the
 * player's *match* history everywhere else.
 */
import type { ViewId, ViewParams } from './store';

/**
 * Whether a param names a DESTINATION ('route') or is a one-shot COMMAND the
 * destination carries out on arrival ('effect'). This is the single
 * compiler-enforced mirror of `ViewParams` in the renderer — adding a key to
 * `ViewParams` without classifying it here stops this satisfying `Required<…>`
 * and fails the build.
 *
 * Classifying a new key: does replaying it on a Back press make sense? A
 * coordinate ("which match", "which day") is 'route'. An instruction ("open the
 * builder", "flash this row") is 'effect' — only route params are ever stored,
 * so a command can never be re-issued by going back.
 */
export type ParamKind = 'route' | 'effect';

export const PARAM_KINDS: Required<{ [K in keyof ViewParams]: ParamKind }> = {
  matchId: 'route',
  day: 'route',
  flag: 'route',
  playerName: 'route',
  targetId: 'route',
  // maps.ts re-runs its scroll-and-flash on every render while this is set.
  highlight: 'effect',
  // "open the builder pre-filled".
  prefillName: 'effect',
  // "open the builder in edit mode" — targets/index.ts guards it with a WeakSet
  // keyed on params object identity, which only works while the object is fresh.
  editTargetId: 'effect',
};

/** Every `ViewParams` key. */
export const ALL_PARAM_KEYS = Object.keys(PARAM_KINDS) as Array<keyof ViewParams>;
/** The subset that identifies a destination. */
export const ROUTE_PARAM_KEYS: ReadonlyArray<keyof ViewParams> =
  ALL_PARAM_KEYS.filter((k) => PARAM_KINDS[k] === 'route');

/** One visited route. `params` holds route keys only — see {@link routeParams}. */
export interface BackEntry {
  view: ViewId;
  params: ViewParams;
}

export type BackStack = readonly BackEntry[];

/** "Does this entry still point at something?" — supplied by the store. */
export type Resolver = (entry: BackEntry) => boolean;

export interface BackResult {
  /** Where to navigate; null when nothing resolvable is left. */
  entry: BackEntry | null;
  /**
   * The stack after the pop — skipped stale entries are consumed too. On a MISS
   * this is the INPUT array by reference: a deleted match has a 12-second Undo,
   * so a Back that finds nothing must not destroy the trail it could revive.
   */
  stack: BackStack;
}

/**
 * What {@link resolveEntry} needs, narrowed to plain data so a test can build
 * one by hand rather than stubbing a whole snapshot.
 */
export interface ResolveContext {
  /**
   * Every authored target the snapshot lists, archived ones flagged. NOT
   * filter-scoped — the filters affect a target's scores, never its membership.
   * `null` before the first snapshot: nothing can be *proved* gone, so
   * everything resolves.
   */
  targets: ReadonlyArray<{ id: string; archivedAt?: number }> | null;
  /** Matches this session has positive evidence are deleted. */
  deletedMatchIds: ReadonlySet<string>;
}

/**
 * Trail bound. Same-view runs collapse (see {@link pushEntry}), so a real
 * session's chain of DISTINCT screens rarely passes six; 20 is unreachable in
 * practice and trivially bounded in memory — an entry holds a `ViewId` and at
 * most five short strings, never a snapshot, a DOM node or a closure.
 */
export const MAX_DEPTH = 20;

/**
 * Structural equality over EVERY `ViewParams` key — `setView`'s "did anything at
 * all change" dedupe. Lives here, with the key table it iterates, so there is
 * one mirror of `ViewParams` rather than two.
 */
export function sameParams(a: ViewParams, b: ViewParams): boolean {
  return ALL_PARAM_KEYS.every((k) => a[k] === b[k]);
}

/**
 * A FRESH `ViewParams` holding only the route keys. Written as explicit field
 * copies rather than an indexed write, so a mis-typed key can't slip through a
 * `Record<string, unknown>` cast; the unit tests walk `PARAM_KINDS` and prove
 * this stays in step with the table.
 */
export function routeParams(p: ViewParams): ViewParams {
  const out: ViewParams = {};
  if (p.matchId !== undefined) out.matchId = p.matchId;
  if (p.day !== undefined) out.day = p.day;
  if (p.flag !== undefined) out.flag = p.flag;
  if (p.playerName !== undefined) out.playerName = p.playerName;
  if (p.targetId !== undefined) out.targetId = p.targetId;
  return out;
}

/** Same destination? View plus route params only — never object identity. */
export function sameEntry(a: BackEntry, b: BackEntry): boolean {
  return a.view === b.view && ROUTE_PARAM_KEYS.every((k) => a.params[k] === b.params[k]);
}

/**
 * Record the route being LEFT. Returns a new array, or the input when nothing
 * is recorded.
 *
 * A run of moves within ONE screen — the ←/→ match stepper, ‹Older/Newer›,
 * day-to-day on Matches, clearing a scope chip — collapses to where the run
 * STARTED, because the push is skipped when the stack top already holds the
 * outgoing view. Back leaves the run; it does not walk it. Without this, 200
 * left-arrows would be 200 entries.
 */
export function pushEntry(stack: BackStack, outgoing: BackEntry): BackStack {
  const top = stack[stack.length - 1];
  if (top && top.view === outgoing.view) return stack;
  const next = [...stack, outgoing];
  return next.length > MAX_DEPTH ? next.slice(next.length - MAX_DEPTH) : next;
}

/**
 * The reducer. Pop to the newest entry that still resolves and isn't where we
 * already stand, consuming everything skipped on the way. Never mutates.
 */
export function back(stack: BackStack, current: BackEntry, resolves: Resolver): BackResult {
  let rest = stack;
  while (rest.length) {
    const entry = rest[rest.length - 1];
    rest = rest.slice(0, -1);
    // A deleted match or a gone/archived target.
    if (!resolves(entry)) continue;
    // Never "navigate" to where we already are.
    if (sameEntry(entry, current)) continue;
    return { entry, stack: rest };
  }
  // Miss: hand back the ORIGINAL stack, by reference.
  return { entry: null, stack };
}

/**
 * Does this entry still point at something? Asks exactly the question the
 * destination view asks itself, and is optimistic by design: a false "still
 * resolves" costs one extra Back press onto an honest empty state the view
 * already renders, while a false "gone" silently eats a valid destination.
 */
export function resolveEntry(e: BackEntry, ctx: ResolveContext): boolean {
  if (e.view === 'matchDetail') {
    // NEVER test membership of the snapshot's match list: that array is
    // filter-scoped, and a match excluded by the current role/season/account
    // filters is not a deleted match. Only positive evidence of deletion counts,
    // so this predicate can produce a false negative but never a false positive.
    return e.params.matchId !== undefined && !ctx.deletedMatchIds.has(e.params.matchId);
  }
  if (e.view === 'targetDetail') {
    // No snapshot yet — never skip on ignorance.
    if (ctx.targets === null) return true;
    const t = ctx.targets.find((x) => x.id === e.params.targetId);
    // Archived counts as gone: the detail page's own Archive action navigates
    // away from it, so Back into it is a dead end the user just walked out of.
    return t !== undefined && t.archivedAt === undefined;
  }
  // Every other screen always exists. A player with no shared matches, or a
  // day-scoped Matches list with no rows, both render an honest empty state and
  // may repopulate under a different filter — emptiness is never a skip.
  return true;
}

/** Display name of a destination. Total over `ViewId` by construction. */
export const VIEW_TITLES: Record<ViewId, string> = {
  overview: 'Overview',
  live: 'Live',
  review: 'Review',
  matches: 'Matches',
  matchDetail: 'the match',
  playerHistory: 'the player',
  targetDetail: 'the target',
  maps: 'Maps',
  heroes: 'Heroes',
  focus: 'Focus',
  mental: 'Mental',
  trends: 'Trends',
  readiness: 'Readiness',
  targets: 'Targets',
  notion: 'Notion sync',
  logs: 'Logs',
  settings: 'Settings',
  about: 'About',
  faq: 'FAQ',
};

/** The ← button's tooltip / aria noun. */
export function entryLabel(e: BackEntry): string {
  if (e.view === 'playerHistory' && e.params.playerName) return e.params.playerName;
  return VIEW_TITLES[e.view];
}
