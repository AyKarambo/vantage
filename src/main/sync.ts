import type { AppConfig } from './config';
import type { MatchRecord } from '../core/model';
import { resolveAccount } from '../core/resolvers/account';
import { resolveRole } from '../core/resolvers/role';
import { resolveResult } from '../core/resolvers/result';
import { shouldLog } from '../core/matchFilter';
import { NotionWriter, type ResolvedMatch } from '../notion/notionWriter';
import { MapsCache } from '../notion/mapsCache';
import { OutboxStore } from '../store/outbox';

export interface Notifier {
  notify(title: string, body: string): void;
  notifyError(title: string, body: string): void;
}

/**
 * Turns finished matches into Gametracker rows: dedupe → competitive filter →
 * resolve the four core fields → write → notify. Failed writes are queued in the
 * outbox and retried on a timer.
 */
export class SyncService {
  paused = false;
  private retryTimer?: NodeJS.Timeout;
  private writer?: NotionWriter;
  private maps?: MapsCache;
  private warnedNoNotion = false;

  constructor(
    private config: AppConfig,
    private readonly outbox: OutboxStore,
    private readonly notifier: Notifier,
  ) {}

  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  /** Wire up (or rebuild) the Notion-dependent collaborators once a token exists. */
  setNotion(writer: NotionWriter, maps: MapsCache): void {
    this.writer = writer;
    this.maps = maps;
    this.warnedNoNotion = false;
    void this.flushPending();
  }

  private ready(): boolean {
    return Boolean(this.writer && this.maps);
  }

  async handleRecord(record: MatchRecord): Promise<void> {
    if (this.paused) return;
    if (this.outbox.isProcessed(record.matchId)) return;

    if (!shouldLog(record, this.config.logFilter)) {
      // Remember non-competitive matches so we don't re-evaluate them.
      this.outbox.markProcessed(record.matchId);
      return;
    }

    if (!this.ready()) {
      this.outbox.enqueue(record);
      if (!this.warnedNoNotion) {
        this.warnedNoNotion = true;
        this.notifier.notifyError('Notion not configured', 'Match queued — set your Notion token from the tray menu.');
      }
      return;
    }
    await this.writeOrQueue(record);
  }

  /** Retry any matches buffered from earlier failures. */
  async flushPending(): Promise<void> {
    if (!this.ready()) return;
    for (const record of this.outbox.pending()) {
      const ok = await this.tryWrite(record);
      if (ok) {
        this.outbox.remove(record.matchId);
        this.outbox.markProcessed(record.matchId);
      }
    }
  }

  startRetryLoop(intervalMs = 60_000): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      void this.flushPending();
    }, intervalMs);
  }

  stop(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = undefined;
  }

  private async writeOrQueue(record: MatchRecord): Promise<void> {
    const ok = await this.tryWrite(record, /* notifyWarnings */ true);
    if (ok) {
      this.outbox.markProcessed(record.matchId);
    } else {
      this.outbox.enqueue(record);
    }
  }

  private async tryWrite(record: MatchRecord, notifyWarnings = false): Promise<boolean> {
    if (!this.ready()) return false;
    let resolved: ResolvedMatch;
    try {
      resolved = await this.resolve(record);
    } catch (err) {
      this.notifier.notifyError('Resolve failed', String(err));
      return false;
    }

    if (notifyWarnings) this.warnOnGaps(resolved);

    try {
      await this.writer!.createMatchPage(resolved);
      this.notifier.notify('Match logged', this.successText(resolved));
      return true;
    } catch (err) {
      this.notifier.notifyError('Notion sync failed (will retry)', String(err));
      return false;
    }
  }

  private async resolve(record: MatchRecord): Promise<ResolvedMatch> {
    const account = resolveAccount(record.battleTag, this.config.accounts);
    const role = resolveRole(record.queueType, record.heroRole);
    const result = resolveResult(record.outcome);
    const map = await this.maps!.resolve(record.mapName);
    return { record, account, role, result, mapPageId: map.pageId };
  }

  private warnOnGaps(m: ResolvedMatch): void {
    if (!m.account && m.record.battleTag) {
      this.notifier.notifyError(
        'Unmapped account',
        `BattleTag "${m.record.battleTag}" isn't in your accounts map — add it in config.`,
      );
    }
    if (!m.mapPageId && m.record.mapName) {
      this.notifier.notifyError(
        'Unmapped map',
        `Map "${m.record.mapName}" wasn't found in your Notion Maps DB — add it or a map alias.`,
      );
    }
  }

  private successText(m: ResolvedMatch): string {
    const map = m.record.mapName ?? 'Unknown map';
    const bits = [m.result, m.account, m.role].filter(Boolean).join(', ');
    return bits ? `${map} — ${bits}` : map;
  }
}
