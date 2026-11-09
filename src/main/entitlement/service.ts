import {
  NO_ENTITLEMENT, nextRecord, nextTierChange, proAccess, resolveTier, simulatedRecord,
  type Entitlement, type EntitlementRecord, type ProAccess, type ProTier,
} from '../../core/entitlement';
import type { ProAction, ProActionResult } from '../../shared/contract';
import type { JsonDoc } from '../../store/jsonDocs';
import type { EntitlementSource } from './source';

export interface EntitlementServiceDeps {
  source: EntitlementSource;
  /** The cached record — `<userData>/entitlement.json` in production (per machine, not the relocatable data folder). */
  doc: Pick<JsonDoc, 'read' | 'write'>;
  now?: () => number;
  /** Access changed (tier flipped): open windows should refetch. */
  onChange?(): void;
  /** Access came back after a lapse: pause active targets' staleness across it (spec §5). */
  onResume?(lapsedSince: number, resumedAt: number): void;
  log?(message: string, fields?: Record<string, string | number | boolean>): void;
  /**
   * Allow the developer tier override (Settings › Developer). False in a
   * packaged build, so a forged IPC call can't grant Pro there.
   */
  devOverrides?: boolean;
  /** The override to start with (`OW_PRO_SIMULATE`); ignored without `devOverrides`. */
  initialOverride?: ProTier;
}

export interface EntitlementService {
  entitlement(): Entitlement;
  /** What the app gates on, for the current demo state. */
  access(demoActive: boolean): ProAccess;
  /** Re-check the source now; resolves with the (possibly unchanged) entitlement. */
  refresh(): Promise<Entitlement>;
  action(kind: ProAction): Promise<ProActionResult>;
  /** Announce a tier change that time alone caused (no check needed) — call on a timer. */
  tick(): void;
  /** When the tier next changes by time alone, if it will. */
  nextChange(): number | undefined;
  /** The developer tier override in effect, or null for the real entitlement. */
  devOverride(): ProTier | null;
  /** Pin the tier for testing (null = back to the real one). In memory only; a no-op unless `devOverrides`. */
  setDevOverride(tier: ProTier | null): void;
}

/**
 * Holds the last answer the {@link EntitlementSource} gave, cached on disk so
 * Pro keeps working offline for the grace window, and derives the tier on
 * every read (the grace clock runs even when nothing re-checks).
 *
 * The only network traffic is whatever the source does — this service never
 * sends match or manual data anywhere (Guardrail 5 amendment).
 */
export function createEntitlementService(deps: EntitlementServiceDeps): EntitlementService {
  const now = deps.now ?? Date.now;
  let record: EntitlementRecord = readRecord(deps.doc.read());
  // The developer override sits ON TOP of the real record and never touches it
  // or the cache, so switching it off restores exactly the real state.
  let override: { tier: ProTier; record: EntitlementRecord } | null =
    deps.devOverrides && deps.initialOverride
      ? { tier: deps.initialOverride, record: simulatedRecord(deps.initialOverride, now()) }
      : null;
  const effective = (): EntitlementRecord => override?.record ?? record;

  const tierOf = (r: EntitlementRecord) => resolveTier(r, now()).tier;
  // The tier the app was last told about — time alone can move it (a trial or
  // the offline grace running out), and `tick` announces that.
  let announced = tierOf(effective());
  const announceIfChanged = (): void => {
    const tier = tierOf(effective());
    if (tier === announced) return;
    announced = tier;
    deps.onChange?.();
  };

  return {
    tick: announceIfChanged,
    nextChange: () => nextTierChange(effective(), now()),
    entitlement: () => resolveTier(effective(), now()),
    access: (demoActive) =>
      proAccess(resolveTier(effective(), now()), demoActive, override ? 'simulated' : deps.source.kind),
    devOverride: () => override?.tier ?? null,
    setDevOverride: (tier) => {
      if (!deps.devOverrides) return;
      override = tier ? { tier, record: simulatedRecord(tier, now()) } : null;
      deps.log?.('developer tier override', { tier: tier ?? 'off' });
      // Always refetch: flipping trial ↔ pro keeps `full` but changes what Settings shows.
      announced = tierOf(effective());
      deps.onChange?.();
    },
    refresh: async () => {
      let fresh: EntitlementRecord | undefined;
      try {
        fresh = await deps.source.check();
      } catch (err) {
        deps.log?.('entitlement check failed — keeping the cached state', { error: String(err) });
      }
      if (fresh) {
        const at = now();
        const next = nextRecord(record, fresh, at);
        record = next.record;
        deps.doc.write(record);
        if (next.resumedFrom !== undefined) deps.onResume?.(next.resumedFrom, at);
        announceIfChanged();
      }
      return resolveTier(record, now());
    },
    action: (kind) => deps.source.action(kind),
  };
}

/** Accept only a well-formed cached record; anything else starts from `free`. */
function readRecord(raw: unknown): EntitlementRecord {
  if (!raw || typeof raw !== 'object') return { ...NO_ENTITLEMENT };
  const r = raw as Record<string, unknown>;
  if (r.plan !== 'none' && r.plan !== 'trial' && r.plan !== 'pro') return { ...NO_ENTITLEMENT };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const out: EntitlementRecord = { plan: r.plan };
  const validUntil = num(r.validUntil);
  const lastCheckedAt = num(r.lastCheckedAt);
  const lapsedSince = num(r.lapsedSince);
  if (validUntil !== undefined) out.validUntil = validUntil;
  if (lastCheckedAt !== undefined) out.lastCheckedAt = lastCheckedAt;
  if (lapsedSince !== undefined) out.lapsedSince = lapsedSince;
  if (r.everPro === true) out.everPro = true;
  return out;
}
