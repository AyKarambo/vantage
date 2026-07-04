/**
 * Review-session helpers. Reviews persist to the main-process store via
 * `bridge.saveReview` — the old renderer-only localStorage store is no longer a
 * source of truth. What remains here:
 *
 * 1. `gradedThisSession` — the match ids graded since the last data refetch.
 *    Saving a review deliberately does NOT refetch (the current snapshot stays
 *    stable), so the inbox and sidebar badge subtract this set instead.
 * 2. `migrateLegacyReviews` — a one-time import of the legacy `vantageReviews`
 *    localStorage payload into the main store.
 */
import type { MatchMental, ReviewInput, TargetGrade } from '../../src/shared/contract';
import { bridge } from './bridge';

const LEGACY_KEY = 'vantageReviews';

/**
 * Match ids graded since the last refetch — hides them from the inbox/badge.
 *
 * Decision record: deliberately module-level mutable state today. If renderer
 * unit tests arrive, this belongs in per-session state passed through
 * `ViewContext` — don't re-litigate this without that payoff.
 */
export const gradedThisSession = new Set<string>();

/** The pre-pipeline localStorage shapes (renderer-local flag names). */
interface LegacyFlags {
  tilted?: boolean;
  comms?: boolean;
  toxic?: boolean;
  leaver?: boolean;
}
interface LegacyReview {
  matchId: string;
  at: number;
  targets: Record<string, TargetGrade>;
  flags: LegacyFlags;
}

/** Old renderer flag names → the shared MatchMental keys. */
function toMental(f: LegacyFlags): MatchMental {
  const m: MatchMental = {};
  if (f.tilted) m.tilt = true;
  if (f.comms) m.positiveComms = true;
  if (f.toxic) m.toxicMates = true;
  if (f.leaver) m.leaver = true;
  return m;
}

/**
 * One-time migration of legacy localStorage reviews into the main store.
 * Idempotent: the key is cleared only after the import IPC resolves, so a
 * failure leaves it in place for the next launch; the store side never
 * overwrites existing reviews and skips unknown match ids. Returns whether
 * anything was imported (so the caller can refetch once).
 */
export async function migrateLegacyReviews(): Promise<boolean> {
  let legacy: Record<string, LegacyReview> | null = null;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null');
  } catch {
    legacy = null;
  }
  if (!legacy || typeof legacy !== 'object') return false;

  const inputs: ReviewInput[] = Object.values(legacy)
    .filter((r) => r && typeof r.matchId === 'string')
    .map((r) => ({ matchId: r.matchId, grades: r.targets ?? {}, flags: toMental(r.flags ?? {}) }));

  const result = inputs.length ? await bridge.importReviews(inputs) : { imported: 0, skipped: 0 };
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable — retried next launch, imports stay idempotent */
  }
  return result.imported > 0;
}
