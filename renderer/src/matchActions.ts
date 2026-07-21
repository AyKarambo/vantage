/**
 * Cross-view match actions. Today: deleting a match from the Review card or the
 * Matches list, and the Undo that follows it.
 *
 * Lives outside `views/` because more than one view drives it and every caller
 * must behave identically — a delete that reports success from one screen and
 * silence from another is worse than no delete at all.
 */
import { toast } from './components/toast';
import { bridge } from './bridge';
import { store } from './store';

/** What the caller needs to describe the match in the confirmation and the toast. */
export interface DeletableMatch {
  matchId: string;
  map: string;
}

/**
 * Delete one recorded match, then resync.
 *
 * Deliberately refetches rather than patching the snapshot locally: deleting a
 * game moves win rate, streaks, priority maps and the whole rank chain, so the
 * only honest thing to show afterwards is a fresh read. Awaiting the refresh is
 * also what lets the toast tell the truth about the demo trapdoor below.
 *
 * The toast carries an Undo — see {@link undoDelete}. It is a real restore, not
 * a re-log, but it is not a recycle bin: the record lives in main-process memory
 * and is gone on restart.
 *
 * `reset` re-enables the button when the delete didn't happen, so a failure
 * leaves a live control rather than a dead one.
 */
export async function deleteMatch(m: DeletableMatch, reset: () => void): Promise<void> {
  // Sampled BEFORE the delete: the notice below is about the demo dataset
  // *appearing*, so what matters is the flip, not the end state. Someone
  // already browsing demo data hasn't lost anything.
  const wasDemo = store.get().data?.isSample === true;
  let deleted: boolean;
  try {
    ({ deleted } = await bridge.deleteMatch(m.matchId));
  } catch (err) {
    reset();
    toast(`Couldn't delete that match — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // A no-op means the row was already gone (a stale snapshot, or a delete that
  // raced another surface). Say so instead of claiming a delete that never was.
  if (!deleted) {
    reset();
    toast('That match was already gone — refreshing.');
    await store.refresh();
    return;
  }
  await store.refresh();
  // Deleting the last real game drops history to empty, and an empty history
  // with the demo preference on refills every view with generated sample games
  // (see dataProvider.games). Watching your history be replaced by matches you
  // never played reads as data loss unless we name it.
  const turnedDemo = !wasDemo && store.get().data?.isSample === true;
  toast(
    turnedDemo
      ? `Deleted your ${m.map} match — that was your last tracked game, so the demo dataset is showing again.`
      : `Deleted your ${m.map} match.`,
    {
      // Longer than the default: this is the only window in which a delete can
      // be taken back, and the confirm that precedes it means the user is
      // already reading carefully. Hovering the toast pauses the countdown.
      ttl: 12_000,
      action: { label: 'Undo', run: () => void undoDelete(m) },
    },
  );
}

/**
 * Put a just-deleted match back. The main process kept the removed record, so
 * this restores the real game — same id, same ⚡ provenance, same grades — not a
 * re-logged approximation. Fails honestly once the buffer has rolled over or
 * the app has restarted.
 */
async function undoDelete(m: DeletableMatch): Promise<void> {
  let restored: boolean;
  try {
    ({ restored } = await bridge.undoDeleteMatch(m.matchId));
  } catch (err) {
    toast(`Couldn't restore that match — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!restored) {
    toast(`Your ${m.map} match can't be restored any more.`);
    return;
  }
  await store.refresh();
  toast(`Restored your ${m.map} match.`);
}
