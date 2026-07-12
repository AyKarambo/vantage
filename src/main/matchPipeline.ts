import type { HistoryStore } from '../store/history';
import type { MatchAggregator } from '../core/matchAggregator';
import type { AppConfig } from './config';
import type { GepMessage, MatchRecord } from '../core/model';
import { matchToGame } from '../core/gameRecord';
import { streak, type GameRecord } from '../core/analytics';
import { isCompetitive } from '../core/matchFilter';
import { isConfiguredAccount } from '../core/accountsManage';
import type { GameLoggedPayload } from '../shared/contract';
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
  /** Durable game history: dedupe-add, full read for streak evaluation. */
  history: Pick<HistoryStore, 'add' | 'all'>;
  /** Folds the GEP message stream into one finished MatchRecord per match. */
  aggregator: Pick<MatchAggregator, 'handle'>;
  /** Live app config — re-read on every use (breakReminder, accounts), never cached. */
  getConfig(): AppConfig;
  /** Surface a user-facing notification (the tray balloon in production). */
  notify(title: string, body: string): void;
  /** Diagnostic logging sink (console in production). */
  log(...args: unknown[]): void;
  /**
   * Fired once per NEWLY recorded competitive match (live or hand-logged),
   * carrying the account it landed on and whether that account is configured —
   * the composition root pushes this to the renderer so it can auto-switch the
   * account filter. Optional: tests and headless paths can omit it.
   */
  onGameLogged?(payload: GameLoggedPayload): void;
}

/**
 * Build the pipeline over injected deps. `feed` is the single entry point for
 * live GEP and dev simulation/replay; `recordGame` is also called directly for
 * manually logged matches so every game passes the same dedupe + reminder path.
 */
export function createMatchPipeline(deps: MatchPipelineDeps): {
  recordGame(game: GameRecord): boolean;
  addMatch(record: MatchRecord): void;
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
    // Announce the newly recorded match so the renderer can follow onto the
    // account just played. `configured` says whether it maps to a known account.
    deps.onGameLogged?.({
      matchId: game.matchId,
      account: game.account,
      configured: isConfiguredAccount(game.account, deps.getConfig().accounts),
    });
    const s = streak(deps.history.all());
    const { fire, state } = nextBreakReminder(s, deps.getConfig().breakReminder, reminderState);
    reminderState = state;
    if (fire) {
      deps.notify('Time for a break?', `That's ${s.count} losses in a row — step away for a few minutes.`);
    }
    return true;
  }

  /** Persist a finished match into the analyzable history. */
  function addMatch(record: MatchRecord): void {
    const game = matchToGame(record, deps.getConfig().accounts);
    if (!game) return;
    recordGame(game);
  }

  // One entry point for a normalized GEP message — shared by the live feed and
  // dev simulation so both exercise the same pipeline.
  const feed = (msg: GepMessage): void => {
    const record = deps.aggregator.handle(msg);
    if (record) addMatch(record);
  };

  return { recordGame, addMatch, feed };
}
