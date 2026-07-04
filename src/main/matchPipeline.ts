import type { HistoryStore } from '../store/history';
import type { MatchAggregator } from '../core/matchAggregator';
import type { ScreenshotService } from './screenshots';
import type { AppConfig } from './config';
import type { GepMessage, MatchRecord } from '../core/model';
import { matchToGame } from '../core/gameRecord';
import { streak, type GameRecord } from '../core/analytics';
import {
  nextBreakReminder, INITIAL_BREAK_REMINDER_STATE, type BreakReminderState,
} from '../core/breakReminder';

/**
 * The match pipeline: GEP message → aggregated MatchRecord → resolved GameRecord
 * persisted to history, plus break-reminder evaluation and best-effort screenshots.
 * No Electron imports (deps are type-only slices), so unit tests drive it with
 * plain objects — the composition root in ./index supplies the real services.
 */

/** Everything the pipeline needs, as narrow structural slices so tests can inject plain objects. */
export interface MatchPipelineDeps {
  /** Durable game history: dedupe-add, full read for streak evaluation, screenshot attach. */
  history: Pick<HistoryStore, 'add' | 'all' | 'addScreenshots'>;
  /** Folds the GEP message stream into one finished MatchRecord per match. */
  aggregator: Pick<MatchAggregator, 'handle'>;
  /** Best-effort end-of-match capture — never throws, never blocks the pipeline. */
  screenshots: Pick<ScreenshotService, 'capture'>;
  /** Live app config — re-read on every use (breakReminder, accounts), never cached. */
  getConfig(): AppConfig;
  /** Surface a user-facing notification (the tray balloon in production). */
  notify(title: string, body: string): void;
  /** Diagnostic logging sink (console in production). */
  log(...args: unknown[]): void;
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
   * Returns whether the game was newly added (false = duplicate matchId).
   */
  function recordGame(game: GameRecord): boolean {
    if (!deps.history.add(game)) return false;
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
    if (!game || !recordGame(game)) return;
    // Best-effort end-of-match capture (~2s later, while the summary screen is
    // up). Every failure inside is a logged no-op; a manual log never gets here.
    deps.screenshots.capture(game.matchId, (paths) => {
      if (deps.history.addScreenshots(game.matchId, paths)) {
        deps.log('[shots]', paths.length, 'screenshot(s) attached to', game.matchId);
      }
    });
  }

  // One entry point for a normalized GEP message — shared by the live feed and
  // dev simulation so both exercise the same pipeline.
  const feed = (msg: GepMessage): void => {
    const record = deps.aggregator.handle(msg);
    if (record) addMatch(record);
  };

  return { recordGame, addMatch, feed };
}
