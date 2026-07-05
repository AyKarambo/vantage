import { Client } from '@notionhq/client';
import type { MatchRecord, Result, Role } from '../core/model';
import type { MatchMental, TargetGrade } from '../core/analytics';
import { leaverFlags } from '../core/leaver';
import { gameTypeLabel } from '../core/matchFilter';

/** A {@link MatchRecord} plus the resolved Notion values for the four core fields. */
export interface ResolvedMatch {
  record: MatchRecord;
  account?: string;
  role?: Role;
  result?: Result;
  mapPageId?: string;
  /** The merged after-game self-report (quick-log + Review flags), if any. */
  mental?: MatchMental;
  /** The imported "Improvement Target" grade for this match, if the user graded it. */
  improvementGrade?: TargetGrade;
}

/**
 * Creates a Gametracker row from a resolved match. Only properties that have a
 * value are written, leaving the subjective fields (Leaver/Comms/Tilt/…) blank
 * for the user to fill in later. Every auto-created row is tagged `Source = Auto`.
 *
 * Property names match the existing Gametracker schema plus the additive
 * "full stat set" columns created by the one-time Notion migration.
 */
export class NotionWriter {
  constructor(
    private readonly client: Client,
    private readonly gametrackerDatabaseId: string,
    /**
     * Whether the target database has the optional `Played At` date column. Set
     * from the cached shape validation. Guarded because `pages.create` rejects a
     * property the database doesn't define — writing it to a pre-`Played At`
     * database would fail every row.
     */
    private readonly hasPlayedAt = false,
    /**
     * The subjective columns the target database actually defines (from the cached
     * shape validation). `pages.create` rejects a property the database lacks, so a
     * subjective field is written only when its column is in this set — the same
     * guard as `hasPlayedAt`, generalized. Empty (write nothing extra) by default.
     */
    private readonly writableColumns: ReadonlySet<string> = new Set(),
  ) {}

  async createMatchPage(m: ResolvedMatch): Promise<string> {
    const r = m.record;
    const props: Record<string, any> = {
      Name: title(this.titleFor(m)),
      Source: select('Auto'),
    };

    if (m.account) props['Account'] = select(m.account);
    if (m.role) props['Role'] = select(m.role);
    if (m.result) props['Result'] = select(m.result);
    if (m.mapPageId) props['Map'] = { relation: [{ id: m.mapPageId }] };

    if (r.heroes.length) {
      props['Hero(es) Played'] = { multi_select: r.heroes.map((name) => ({ name: safeOption(name) })) };
    }
    putNumber(props, 'Eliminations', r.eliminations);
    putNumber(props, 'Deaths', r.deaths);
    putNumber(props, 'Assists', r.assists);
    putNumber(props, 'Damage', r.damage);
    putNumber(props, 'Healing', r.healing);
    putNumber(props, 'Mitigation', r.mitigation);
    putNumber(props, 'Match Duration (min)', r.durationMinutes);
    putNumber(props, 'Group Size', r.groupSize);

    if (r.gameType) props['Game Type'] = select(gameTypeLabel(r.gameType));
    if (r.queueType) props['Queue Type'] = select(r.queueType.toLowerCase());

    putText(props, 'Final Score', r.finalScore);
    putText(props, 'Battletag', r.battleTag);
    putText(props, 'Match ID', r.matchId);

    // The match-end time, so import can restore the real timeline rather than
    // inheriting the Notion row-creation time. Only when the database carries
    // the column (see the constructor doc).
    if (this.hasPlayedAt && typeof r.endedAt === 'number' && Number.isFinite(r.endedAt)) {
      props['Played At'] = { date: { start: new Date(r.endedAt).toISOString() } };
    }

    // The subjective self-report + improvement grade the user filled in inside
    // Vantage — written into the matching columns (mirroring NotionImporter's
    // readers) so the round-trip is symmetric instead of dropping them into the
    // page title. Each is guarded by column presence and by having a value.
    const mental = m.mental;
    if (this.writableColumns.has('Comms') && mental?.positiveComms) props['Comms'] = select('positive');
    if (this.writableColumns.has('Improvement Target') && m.improvementGrade) {
      props['Improvement Target'] = select(GRADE_TO_NOTION[m.improvementGrade]);
    }
    if (this.writableColumns.has('Leaver')) {
      const leaver = leaverFlags(mental);
      if (leaver.myTeam) props['Leaver'] = select('team');
      else if (leaver.enemyTeam) props['Leaver'] = select('enemy');
    }
    if (this.writableColumns.has('Tilt') && mental?.tilt) props['Tilt'] = { checkbox: true };
    if (this.writableColumns.has('Toxic Mates') && mental?.toxicMates) props['Toxic Mates'] = { checkbox: true };

    const res: any = await this.client.pages.create({
      parent: { database_id: this.gametrackerDatabaseId },
      properties: props,
    });
    return res.id as string;
  }

  private titleFor(m: ResolvedMatch): string {
    const who = m.account ?? m.record.battleTag ?? 'Match';
    const parts = [who, m.role, m.record.mapName, m.result].filter(Boolean);
    return parts.join(' · ');
  }
}

// --- Notion property builders -------------------------------------------------

/** Our {@link TargetGrade} → the Notion "Improvement Target" select option (inverse of the importer's map). */
const GRADE_TO_NOTION: Record<TargetGrade, string> = { hit: 'hit', partial: 'partially', missed: 'missed' };

function title(content: string) {
  return { title: [{ text: { content: content.slice(0, 2000) } }] };
}
function select(name: string) {
  return { select: { name: safeOption(name) } };
}
function putNumber(props: Record<string, any>, name: string, value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) props[name] = { number: value };
}
function putText(props: Record<string, any>, name: string, value: string | undefined): void {
  if (value) props[name] = { rich_text: [{ text: { content: value.slice(0, 2000) } }] };
}
/** Notion select/multi-select option names may not contain commas and cap at 100 chars. */
function safeOption(name: string): string {
  return name.replace(/,/g, ' ').slice(0, 100);
}
