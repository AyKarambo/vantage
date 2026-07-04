/**
 * The raw GEP wire shape. Isolated here so consumers that only need to
 * recognize a GEP message don't have to import the match-record types too.
 */

/**
 * A single normalized GEP message. Both `new-info-update` and `new-game-event`
 * arrive from Overwolf as `{ gameId, feature, category?, key, value }`
 * (see @overwolf/ow-electron-packages-types modules/gep.d.ts).
 */
export interface GepMessage {
  /** 'info' = persistent state update, 'event' = discrete occurrence. */
  kind: 'info' | 'event';
  /** The GEP feature, e.g. 'game_info', 'match_info', 'roster', 'kill'. */
  feature: string;
  /** Info-update category (events have none). */
  category?: string;
  /** The info/event key, e.g. 'map', 'match_outcome', 'match_start'. */
  key: string;
  /** Raw value — may be a primitive or an already-parsed object. */
  value: unknown;
}
