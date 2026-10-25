import type { GameRecord } from '../core/analytics';

/** A manual-layer edit: a value sets the field, `null` deletes it, `undefined` leaves it. */
export type ManualPatch =
  Partial<Pick<GameRecord, 'result' | 'role' | 'map' | 'heroes' | 'gameType' | 'timestamp' | 'mental' | 'review'>> &
  { srDelta?: number | null; performance?: number | null; factsEditedAt?: number | null;
    playedMinutesOverride?: number | null;
    party?: GameRecord['party'] | null;
    rankAtStart?: GameRecord['rankAtStart'] | null };

/** Apply a {@link ManualPatch} to a record in place. */
export function applyManualPatch(game: GameRecord, patch: ManualPatch): void {
  const target = game as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else if (v !== undefined) target[k] = v;
  }
}
