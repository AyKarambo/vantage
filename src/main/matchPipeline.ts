import type { HistoryStore } from '../store/history';
import {
  isMatchStartMessage, isRoundEndMessage, isRoundStartMessage, partyCountFromInfo, type MatchAggregator,
} from '../core/matchAggregator';
import type { AppConfig } from './config';
import type { GepMessage, MatchRecord, Result } from '../core/model';
import { matchToGame } from '../core/gameRecord';
import { streak, type GameRecord } from '../core/analytics';
import { classifyGameType, isCompetitive } from '../core/matchFilter';
import { isConfiguredAccount } from '../core/accountsManage';
import { sourceOf } from '../core/source';
import { autoParty, carriedParty } from '../core/party';
import type { GameLoggedPayload, PendingChangedPayload } from '../shared/contract';
import {
  nextBreakReminder, INITIAL_BREAK_REMINDER_STATE, type BreakReminderState,
} from '../core/breakReminder';

/**
 * The match pipeline: GEP message → aggregated MatchRecord → resolved GameRecord
 * persisted to history, plus break-reminder evaluation. No Electron imports
 * (deps are type-only slices), so unit tests drive it with plain objects — the
 * composition root in ./index supplies the real services.
 */

/** Everything the pipeline needs, as narrow structural slices so tests can inject plain objects. */
export interface MatchPipelineDeps {
  /** Durable game history: dedupe-add, full read for streak evaluation, plus the
   *  "needs review" holding store (hold on uncertainty / take on resolve / remove on dismiss). */
  history: Pick<HistoryStore, 'add' | 'all' | 'addPending' | 'takePending' | 'removePending'>;
  /**
   * Folds the GEP message stream into one finished MatchRecord per match. The
   * party-count methods are optional so tests can inject a bare `handle`.
   */
  aggregator: Pick<MatchAggregator, 'handle'> &
    Partial<Pick<MatchAggregator, 'hasPartyCount' | 'seedPartyCount' | 'checkpoint' | 'hasPendingResume'>>;
  /** Live app config — re-read on every use (breakReminder, accounts), never cached. */
  getConfig(): AppConfig;
  /** Surface a user-facing notification (the tray balloon in production). */
  notify(title: string, body: string): void;
  /** Diagnostic logging sink (console in production). */
  log(...args: unknown[]): void;
  /**
   * Fired once per NEWLY recorded competitive match (live or hand-logged), carrying
   * the account it landed on and whether that account is configured — the
   * composition root pushes this to the renderer so it can refresh the live
   * dashboard AND auto-switch onto the account just played. Optional: tests and
   * headless paths can omit it.
   */
  onGameLogged?(payload: GameLoggedPayload): void;
  /**
   * Fired when the pending ("needs result") holding store changes — drives the Review
   * refresh. `held` names a match that was JUST held; resolving or dismissing one
   * fires it with no payload.
   */
  onPendingChanged?(payload?: PendingChangedPayload): void;
  /**
   * Read GEP's current info state (`getInfo()`). Probed at `match_start` only
   * when no party count is held yet — the lobby's `party_player_count` update
   * stays the source of truth; this just fills the gap when it was missed.
   */
  probeInfo?(): Promise<unknown>;
  /**
   * Party keys of the players tagged as friends. A new capture whose own-team
   * friends account for the whole GEP-reported party is labelled with them
   * (see {@link autoParty}).
   */
  friendKeys?(): ReadonlySet<string>;
  /**
   * Where the match in progress is kept so an app restart mid-match resumes it
   * (see MatchCheckpointStore). Optional: tests and headless paths can omit it.
   */
  checkpoints?: { save(checkpoint: unknown): void; clear(): void };
  now?(): number;
}

/** Most time between two checkpoint writes while a match runs; round boundaries always write. */
export const CHECKPOINT_INTERVAL_MS = 5_000;

/**
 * The raw GEP-style outcome string a resolved {@link Result} maps back onto, so a
 * hand-completed pending match re-enters the pipeline exactly as a live capture
 * would (through {@link matchToGame}'s `resolveResult`).
 */
const OUTCOME_FOR_RESULT: Record<Result, string> = { Win: 'victory', Loss: 'defeat', Draw: 'draw' };

/**
 * Whether a captured record represents a match that was actually played — the
 * gate that separates a genuine no-outcome ranked game (hold it for Review) from
 * an empty/aborted capture (drop it). True if any local hero, any roster entry,
 * or an elimination count is present.
 */
function matchPlayed(record: MatchRecord): boolean {
  return record.heroes.length > 0 || (record.roster?.length ?? 0) > 0 || record.eliminations != null;
}

/**
 * Whether GEP EXPLICITLY classified this match as one Vantage doesn't track —
 * quick play, arcade, custom, or stadium. Only these are safely skippable; a
 * missing/unknown `game_type` (e.g. after an account swap) is NOT one of them,
 * so it's held for the user to curate rather than silently dropped. We never
 * fabricate a game_type — this is a strict "GEP said so" gate.
 */
function isKnownNonCompetitive(gameType: string | undefined): boolean {
  return ['quickplay', 'arcade', 'custom', 'stadium'].includes(classifyGameType(gameType));
}

/**
 * Build the pipeline over injected deps. `feed` is the single entry point for
 * live GEP and dev simulation/replay; `recordGame` is also called directly for
 * manually logged matches so every game passes the same dedupe + reminder path.
 */
export function createMatchPipeline(deps: MatchPipelineDeps): {
  recordGame(game: GameRecord): boolean;
  addMatch(record: MatchRecord): void;
  resolvePending(matchId: string, result: Result): boolean;
  dismissPending(matchId: string): boolean;
  feed(msg: GepMessage): void;
} {
  // Lives in this closure — same lifetime as the pipeline (see recordGame JSDoc).
  let reminderState: BreakReminderState = INITIAL_BREAK_REMINDER_STATE;

  /**
   * Persist a finished game and, on success, evaluate the break reminder against
   * the unfiltered history — a manually logged loss counts the same as a live one.
   * Reminder state is in-memory only: a restart re-arms it (accepted trade-off).
   * Non-competitive games (quick play, arcade, etc.) are dropped before ever
   * reaching history — Vantage is competitive-only. Manual logs always carry
   * `gameType: 'Competitive'`, so this gate never blocks a manual entry.
   * Returns whether the game was newly added (false = duplicate matchId or
   * non-competitive).
   */
  function recordGame(game: GameRecord): boolean {
    if (!isCompetitive(game.gameType)) return false;
    if (!deps.history.add(game)) return false;
    // Announce the newly recorded match so the renderer can refresh the live
    // dashboard and follow onto the account just played. `configured` says whether
    // it maps to a known account.
    deps.onGameLogged?.({
      matchId: game.matchId,
      account: game.account,
      configured: isConfiguredAccount(game.account, deps.getConfig().accounts),
      // The track, and where the match came from — the renderer raises the
      // placement offer off these for auto-tracked matches, which never pass
      // through the log form that would otherwise ask (issue #200).
      role: game.role,
      source: sourceOf(game),
    });
    const s = streak(deps.history.all());
    const { fire, state } = nextBreakReminder(s, deps.getConfig().breakReminder, reminderState);
    reminderState = state;
    if (fire) {
      deps.notify('Time for a break?', `That's ${s.count} losses in a row — step away for a few minutes.`);
    }
    return true;
  }

  /** Persist a finished match into the analyzable history, or hold it for Review. */
  function addMatch(record: MatchRecord): void {
    const game = matchToGame(record, deps.getConfig().accounts);
    // Only fresh captures pass through here, so older history is never relabelled.
    // Tagged friends first; otherwise the group the player set on the previous
    // game of this sitting carries over while the roster still agrees.
    const party = game
      ? (deps.friendKeys ? autoParty(game, deps.friendKeys()) : undefined) ?? carriedParty(deps.history.all(), game)
      : undefined;
    if (game && party) game.party = party;
    // Happy path: clearly competitive AND has a resolvable result → auto-log it.
    // A manual log never reaches this branch.
    if (game && isCompetitive(record.gameType)) {
      recordGame(game);
      return;
    }
    // GEP EXPLICITLY marked it as something Vantage doesn't track (quick play,
    // arcade, custom, stadium) → skip it. Vantage is competitive-only.
    if (isKnownNonCompetitive(record.gameType)) return;
    // Uncertain: it played, but GEP didn't confirm it's a clean trackable
    // competitive game — either no result, an unknown/missing game_type (e.g.
    // after an account swap), or both. Never silently drop a possibly-real played
    // match: hold it in the SEPARATE pending store so the user can confirm a
    // result (→ history) or dismiss it in Review. It NEVER enters history/analytics
    // until resolved. We do NOT fabricate the game_type.
    if (matchPlayed(record) && deps.history.addPending(record)) {
      deps.notify(
        'Match needs review',
        'A match ended without a confirmed result — set it in Review, or dismiss it if it wasn’t a real match.',
      );
      deps.onPendingChanged?.({ held: record.matchId });
    }
  }

  /**
   * Complete a held pending match with a user-chosen result: take it out of the
   * holding store, stamp the raw outcome (and, when GEP left the game_type unknown,
   * stamp it competitive — the user's confirm is the track decision), and run it
   * back through {@link addMatch} so it lands in history via the identical
   * `matchToGame` → `recordGame` path a live capture would. Returns false for an
   * unknown id.
   */
  function resolvePending(matchId: string, result: Result): boolean {
    const rec = deps.history.takePending(matchId);
    if (!rec) return false;
    rec.outcome = OUTCOME_FOR_RESULT[result];
    // The user confirming a result IS the decision to track this match. A match
    // may have been held with an unknown/missing game_type (e.g. after an account
    // swap), which the competitive-only auto-log gate would otherwise re-hold or
    // drop. Vantage is competitive-only, so — exactly as a manual log is forced
    // competitive — stamp a confirmed match competitive when GEP left it unknown.
    // This is user curation on resolve, NOT fabricating a game_type during capture.
    if (!isCompetitive(rec.gameType)) rec.gameType = 'Competitive';
    addMatch(rec);
    return true;
  }

  /**
   * Dismiss a held pending match — the user's verdict that it wasn't a real /
   * trackable game. Removes it from the holding store WITHOUT logging it (it never
   * touches history/analytics). Returns false for an unknown id. Fires the
   * pending-changed signal only when something was actually removed.
   */
  function dismissPending(matchId: string): boolean {
    if (!deps.history.removePending(matchId)) return false;
    deps.onPendingChanged?.();
    return true;
  }

  // One entry point for a normalized GEP message — shared by the live feed and
  // dev simulation so both exercise the same pipeline.
  const feed = (msg: GepMessage): void => {
    const record = deps.aggregator.handle(msg);
    if (isMatchStartMessage(msg)) probePartyCount();
    if (record) addMatch(record);
    persistCheckpoint(msg, record !== null);
  };

  const now = deps.now ?? ((): number => Date.now());
  let checkpointWrittenAt = Number.NEGATIVE_INFINITY;
  // A file may be left over from before this launch — the aggregator holds it
  // as a pending resume until the feed names the match; cleared after that.
  let checkpointOnDisk = true;

  /**
   * Keep the on-disk checkpoint current: written on every round boundary (the
   * clock starts or stops there) and otherwise at most every
   * {@link CHECKPOINT_INTERVAL_MS}, removed once the match is recorded or there
   * is no match to resume. A failure is logged and never breaks the pipeline.
   */
  function persistCheckpoint(msg: GepMessage, ended: boolean): void {
    const { aggregator, checkpoints } = deps;
    if (!checkpoints || !aggregator.checkpoint) return;
    try {
      const boundary = isMatchStartMessage(msg) || isRoundStartMessage(msg) || isRoundEndMessage(msg);
      if (!ended && !boundary && now() - checkpointWrittenAt < CHECKPOINT_INTERVAL_MS) return;
      const cp = ended ? null : aggregator.checkpoint();
      if (cp) {
        checkpoints.save(cp);
        checkpointWrittenAt = now();
        checkpointOnDisk = true;
      } else if (checkpointOnDisk && !aggregator.hasPendingResume?.()) {
        checkpoints.clear();
        checkpointOnDisk = false;
      }
    } catch (err) {
      deps.log('match checkpoint failed', String(err));
    }
  }

  /** Seed the party count from `getInfo()` when the lobby update was missed. */
  function probePartyCount(): void {
    const { aggregator, probeInfo } = deps;
    if (!probeInfo || !aggregator.seedPartyCount || aggregator.hasPartyCount?.() !== false) return;
    probeInfo()
      .then((info) => aggregator.seedPartyCount?.(partyCountFromInfo(info)))
      .catch((err) => deps.log('party count probe failed', String(err)));
  }

  return { recordGame, addMatch, resolvePending, dismissPending, feed };
}
