import type { DataProvider } from '../dashboard/provider';
import type { ManualMatchInput, MatchEditInput, ReviewInput } from '../../shared/contract';

/** A Pro-only write reached the provider without Pro access (#337). */
export class ProRequiredError extends Error {
  constructor(readonly method: string) {
    super(`${method} is part of Vantage Pro`);
    this.name = 'ProRequiredError';
  }
}

/**
 * The target writes that are Vantage Pro outright. A lapsed subscriber's
 * targets are read-only, a free user has none to touch — both are refused.
 */
export const PRO_TARGET_WRITES = [
  'saveTarget', 'updateTarget', 'setTargetActive', 'setTargetArchived', 'deleteTarget',
  'deactivateAllTargets', 'suggestThreshold',
  // Settings only Pro screens read — the Readiness/Mental demo preview must not write the real ones.
  'setReadiness', 'setStaleness', 'setGrading',
] as const satisfies readonly (keyof DataProvider)[];

/**
 * Enforce Vantage Pro at the provider, so every caller — a renderer view, a
 * stale window, the MCP server — meets the same gate as the payload. Checked
 * per call (the tier can change while the app runs).
 *
 * Target ops throw. Review/log/edit writes are free and still save — only
 * their target layer (grades, focus choice) is dropped, and a re-saved review
 * keeps the grades it already had instead of wiping them.
 */
export function proGuarded(provider: DataProvider): DataProvider {
  const full = () => provider.proAccess().full;
  const out: DataProvider = { ...provider };
  for (const name of PRO_TARGET_WRITES) {
    const fn = provider[name] as (...args: unknown[]) => unknown;
    (out as unknown as Record<string, unknown>)[name] = (...args: unknown[]): unknown => {
      if (!full()) throw new ProRequiredError(name);
      return fn.apply(provider, args);
    };
  }
  out.saveReview = (input) => provider.saveReview(full() ? input : keepStoredTargetLayer(provider, input));
  out.logMatch = (input) => provider.logMatch(full() ? input : withoutTargetLayer(input));
  out.editMatch = (input) => provider.editMatch(full() ? input : withoutTargetLayer(input));
  return out;
}

/** A review re-saved without Pro carries the match's already-stored grades, focus and break mark, untouched. */
function keepStoredTargetLayer(provider: DataProvider, input: ReviewInput): ReviewInput {
  const stored = provider.games().find((g) => g.matchId === input.matchId)?.review;
  const { focusTargetIds: _drop, ...rest } = input;
  return {
    ...rest,
    grades: stored?.grades ?? {},
    ...(stored?.focusTargetIds ? { focusTargetIds: stored.focusTargetIds } : {}),
    // The break mark is a practice-mode control, so a free card never sends one.
    ...(rest.breakBefore === undefined && stored?.breakBefore !== undefined ? { breakBefore: stored.breakBefore } : {}),
  };
}

function withoutTargetLayer<T extends ManualMatchInput | MatchEditInput>(input: T): T {
  const { grades: _g, focusTargetIds: _f, ...rest } = input as T & { focusTargetIds?: unknown };
  return rest as T;
}
