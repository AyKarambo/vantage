import {
  NO_ENTITLEMENT, nextRecord, proAccess, resolveTier,
  type Entitlement, type EntitlementRecord, type ProAccess,
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
}

export interface EntitlementService {
  entitlement(): Entitlement;
  /** What the app gates on, for the current demo state. */
  access(demoActive: boolean): ProAccess;
  /** Re-check the source now; resolves with the (possibly unchanged) entitlement. */
  refresh(): Promise<Entitlement>;
  action(kind: ProAction): Promise<ProActionResult>;
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

  const tierOf = (r: EntitlementRecord) => resolveTier(r, now()).tier;

  return {
    entitlement: () => resolveTier(record, now()),
    access: (demoActive) => proAccess(resolveTier(record, now()), demoActive, deps.source.kind),
    refresh: async () => {
      let fresh: EntitlementRecord | undefined;
      try {
        fresh = await deps.source.check();
      } catch (err) {
        deps.log?.('entitlement check failed — keeping the cached state', { error: String(err) });
      }
      if (fresh) {
        const at = now();
        const before = tierOf(record);
        const next = nextRecord(record, fresh, at);
        record = next.record;
        deps.doc.write(record);
        if (next.resumedFrom !== undefined) deps.onResume?.(next.resumedFrom, at);
        if (tierOf(record) !== before) deps.onChange?.();
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
