import type { GepMessage, RosterPlayer, Role } from '../core/model';
import {
  INITIAL_LIVE_MATCH, liveMatchDetached, liveRoster, liveTeamTotals, localTeam, reduceLiveMatch,
  type LiveMatchState,
} from '../core/liveMatch';
import { resolveRole } from '../core/resolvers/role';
import { roleOfHero } from '../core/heroes';
import { orderScoreboard } from '../core/matchDetail';
import type { LiveMatchPayload, ScoreboardEntry } from '../shared/contract';

/**
 * Publishes the in-progress match to the renderer.
 *
 * Thin by design: the folding is pure (`core/liveMatch`), and this owns only the
 * three things that need the process — the current state, a publish throttle,
 * and the detach signal.
 *
 * ## Why the throttle
 *
 * `roster_XX` ticks continuously during a match, and each one would otherwise be
 * a serialize + IPC hop + full renderer repaint. A scoreboard that updates once
 * a second is indistinguishable from one that updates 20 times a second, so this
 * publishes at most once per {@link PUBLISH_INTERVAL_MS} — except for phase
 * changes, which are published immediately: "a match started" and "a match
 * ended" are the two things a delay would actually be felt on.
 */

/** Minimum gap between mid-match pushes. Phase changes bypass it. */
export const PUBLISH_INTERVAL_MS = 1000;

export interface LiveMatchMonitor {
  /** Feed one normalized GEP message. */
  message(msg: GepMessage): void;
  /**
   * GEP attached/detached. Detaching ENDS any live match: the game closing,
   * crashing, or being alt-F4'd emits no `match_end`, and without this the
   * board would present a stale scoreboard as current for the rest of the
   * session — contradicting the status indicator, which does reset on detach.
   */
  setAttached(attached: boolean): void;
  /** The current payload, for a renderer that opens mid-match. */
  snapshot(): LiveMatchPayload;
}

export function createLiveMatchMonitor(deps: {
  publish(payload: LiveMatchPayload): void;
  /** Whether the user wants the kill feed — read live, so a toggle applies at once. */
  killFeedEnabled(): boolean;
  now?(): number;
}): LiveMatchMonitor {
  const now = deps.now ?? ((): number => Date.now());
  let state: LiveMatchState = INITIAL_LIVE_MATCH;
  let lastPublishedAt = 0;

  const flush = (previous: LiveMatchState, force: boolean): void => {
    if (state === previous) return;
    const phaseChanged = state.phase !== previous.phase;
    const at = now();
    if (!phaseChanged && !force && at - lastPublishedAt < PUBLISH_INTERVAL_MS) return;
    lastPublishedAt = at;
    deps.publish(toPayload(state, deps.killFeedEnabled()));
  };

  return {
    message: (msg) => {
      const previous = state;
      state = reduceLiveMatch(state, msg, now());
      flush(previous, false);
    },
    setAttached: (attached) => {
      if (attached) return;
      const previous = state;
      state = liveMatchDetached(state, now());
      flush(previous, true);
    },
    snapshot: () => toPayload(state, deps.killFeedEnabled()),
  };
}

/**
 * Project the folded state into the renderer's payload.
 *
 * `liveRoster` resolves who is local across the whole roster HERE, at read time,
 * rather than when each row arrived — roster rows routinely arrive before the
 * feed names the local player, and a row stamped on arrival is never revisited.
 */
export function toPayload(state: LiveMatchState, killFeedEnabled: boolean): LiveMatchPayload {
  const roster = liveRoster(state);
  const mine = localTeam(roster);
  // A tally is only meaningful if the feed ever said which side an attacker was
  // on. Reporting 0–0 when it never did would read as "nobody has died yet".
  const known = killFeedEnabled && state.feed.some((k) => k.attackerFriendly !== undefined);
  return {
    live: state.phase === 'live',
    ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
    ...(state.endedAt !== undefined ? { endedAt: state.endedAt } : {}),
    ...(state.mapName !== undefined ? { map: state.mapName } : {}),
    ...(state.gameType !== undefined ? { gameType: state.gameType } : {}),
    // Ordered by the SAME function the stored match detail uses — your team
    // first, then Tank → DPS → DPS → Support → Support — so the live board and
    // the one you open afterwards can't read differently for the same match.
    roster: orderScoreboard(roster.map(toScoreboardEntry)),
    totals: liveTeamTotals(roster),
    // With the kill feed off, NOTHING kill-derived crosses the bridge — not the
    // per-kill strip and not the elimination count, which is only a sum of the
    // same events. Leaving a running kill count on screen would defeat the point
    // of switching it off. Withheld at the source rather than hidden in the
    // view, so the data genuinely does not reach the window.
    kills: killFeedEnabled ? { ...state.kills, known } : { yours: 0, theirs: 0, known: false },
    feed: killFeedEnabled ? state.feed : [],
    teamsKnown: mine !== undefined && roster.some((p) => !p.isLocal && p.team !== undefined),
  };
}

/** One roster row as the shared scoreboard component consumes it. */
function toScoreboardEntry(p: RosterPlayer): ScoreboardEntry {
  // Same precedence the stored scoreboard uses (core/matchDetail): prefer GEP's
  // own heroRole, else derive it from the hero — never guessed for an unknown one.
  const role: Role | undefined = resolveRole(undefined, p.heroRole) ?? roleOfHero(p.heroName);
  return {
    name: p.battleTag?.trim() || 'Unknown',
    isLocal: Boolean(p.isLocal),
    ...(p.heroName ? { hero: p.heroName } : {}),
    ...(role ? { role } : {}),
    ...(p.team !== undefined ? { team: p.team } : {}),
    ...(p.kills !== undefined ? { eliminations: p.kills } : {}),
    ...(p.deaths !== undefined ? { deaths: p.deaths } : {}),
    ...(p.assists !== undefined ? { assists: p.assists } : {}),
    ...(p.damage !== undefined ? { damage: p.damage } : {}),
    ...(p.healing !== undefined ? { healing: p.healing } : {}),
    ...(p.mitigation !== undefined ? { mitigation: p.mitigation } : {}),
  };
}
