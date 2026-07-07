import type { CommsTone, MatchMental } from './analytics';

/**
 * Comms-tone resolution for a mental self-report. New records carry the
 * three-state {@link CommsTone} on `mental.comms`; older records only have the
 * legacy boolean `positiveComms`. These helpers give every reader one place to
 * fold both shapes together, so a legacy `positiveComms:true` and a fresh
 * `comms:'positive'` are treated identically. Pure and I/O-free, like the rest
 * of `core/`.
 */

/** The comms tone for a mental record, or `undefined` when none was reported. */
export function commsTone(mental?: MatchMental | null): CommsTone | undefined {
  if (mental?.comms) return mental.comms;
  return mental?.positiveComms ? 'positive' : undefined;
}

/** True when comms were flagged positive (new tone or legacy boolean). */
export function isPositiveComms(mental?: MatchMental | null): boolean {
  return commsTone(mental) === 'positive';
}

/** True when comms were flagged abusive. */
export function isAbusiveComms(mental?: MatchMental | null): boolean {
  return commsTone(mental) === 'abusive';
}
