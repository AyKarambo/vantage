/**
 * Pure label composition for the tray's live-match and current-sitting menu
 * items (S5) — kept separate from Electron (`main/tray.ts`) so the strings
 * are unit-testable without spinning up a real `Tray`, and separate from
 * `liveMatch.ts` (GEP message folding) since this is presentation, not
 * parsing. `now` is threaded in rather than read live, so both stay pure
 * functions of their inputs.
 */

/** "Live: Ilios · started 12m ago" — null while no match is running. */
export function liveTrayLabel(live: { map?: string; startedAt: number } | undefined, now: number): string | null {
  if (!live) return null;
  const minutes = Math.max(0, Math.floor((now - live.startedAt) / 60_000));
  return `Live: ${live.map ?? 'match in progress'} · started ${minutes}m ago`;
}

/** "This sitting: 3–1" — null while no sitting is open. */
export function sessionTrayLabel(session: { wins: number; losses: number } | undefined): string | null {
  if (!session) return null;
  return `This sitting: ${session.wins}–${session.losses}`;
}
