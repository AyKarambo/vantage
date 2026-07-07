import { Client } from '@notionhq/client';
import type { MatchRecord, Result, Role } from '../core/model';
import type { MatchMental, TargetGrade } from '../core/analytics';
import { leaverFlags } from '../core/leaver';
import { commsTone } from '../core/comms';
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
    /**
     * Whether the target database has the optional `SR Delta` number column. Same
     * presence guard as `hasPlayedAt` — a Vantage-authored value, written only when
     * the column exists and the match carries a competitive SR change.
     */
    private readonly hasSrDelta = false,
    /**
     * The validated database's data source id (from `NotionAdmin.validate`), if
     * known. New rows parent on it directly; falling back to `database_id` only
     * covers the pre-validation window — valid since Gametracker/Maps are always
     * single-source databases, so the database-id parent still resolves correctly.
     */
    private readonly dataSourceId?: string,
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
    // The signed competitive SR change, so import restores it instead of dropping
    // it. Guarded by column presence, like Played At.
    if (this.hasSrDelta && typeof r.srDelta === 'number' && Number.isFinite(r.srDelta)) {
      props['SR Delta'] = { number: r.srDelta };
    }

    // The subjective self-report + improvement grade the user filled in inside
    // Vantage — written into the matching columns (mirroring NotionImporter's
    // readers) so the round-trip is symmetric instead of dropping them into the
    // page title. Create omits columns with no value (see `subjectiveProps`).
    Object.assign(props, this.subjectiveProps(m, { forUpdate: false }));

    const parent = this.dataSourceId
      ? { data_source_id: this.dataSourceId }
      : { database_id: this.gametrackerDatabaseId };
    const res: any = await this.client.pages.create({ parent, properties: props });
    return res.id as string;
  }

  /**
   * Updates an already-exported Gametracker row in place. Unlike
   * {@link createMatchPage}, a present-but-now-empty subjective column is sent
   * its explicit empty form (`select: null` / `checkbox: false`) so clearing a
   * flag or grade locally clears the corresponding Notion cell on next sync.
   *
   * `opts.stampMatchId` additionally writes `Match ID` into the update payload —
   * used only to heal a row the export create-guard *adopted* (a hand-added row
   * whose `Match ID` cell was empty, or a legacy-backfilled row): not a normal
   * part of this method's signature, and never set for an ordinary update of an
   * already-ledgered match (that would re-send `Match ID` on every sync for no
   * reason). Stamping is not part of `matchExportSignature`, so it must never be
   * the only reason a call to this method happens for an otherwise-unchanged match.
   */
  async updateMatchPage(pageId: string, m: ResolvedMatch, opts?: { stampMatchId?: boolean }): Promise<void> {
    const props = this.subjectiveProps(m, { forUpdate: true });
    if (opts?.stampMatchId) putText(props, 'Match ID', m.record.matchId);
    await this.client.pages.update({ page_id: pageId, properties: props });
  }

  /**
   * Writes ONLY the `Match ID` cell of an existing row — nothing else. Used when
   * adopting a found row that has nothing to push (empty export signature):
   * {@link updateMatchPage} would actively blank the subjective columns
   * (`select: null` / `checkbox: false`), destroying values the user filled in by
   * hand on a row the app has never written to. Stamping alone must never touch
   * any other cell.
   */
  async stampMatchId(pageId: string, matchId: string): Promise<void> {
    const props: Record<string, any> = {};
    putText(props, 'Match ID', matchId);
    await this.client.pages.update({ page_id: pageId, properties: props });
  }

  private titleFor(m: ResolvedMatch): string {
    const who = m.account ?? m.record.battleTag ?? 'Match';
    const parts = [who, m.role, m.record.mapName, m.result].filter(Boolean);
    return parts.join(' · ');
  }

  /**
   * Builds the subjective-column properties (Comms/Improvement Target/Leaver/
   * Tilt/Toxic Mates), guarded by column presence. `forUpdate: false` (create)
   * omits any column with no value, leaving it blank for the user to fill in.
   * `forUpdate: true` (update) actively blanks a present-but-now-empty column
   * so a locally-cleared flag/grade clears the Notion cell too.
   */
  private subjectiveProps(m: ResolvedMatch, opts: { forUpdate: boolean }): Record<string, any> {
    const props: Record<string, any> = {};
    const mental = m.mental;

    if (this.writableColumns.has('Comms')) {
      const tone = commsTone(mental);
      if (tone) props['Comms'] = select(tone);
      else if (opts.forUpdate) props['Comms'] = { select: null };
    }
    if (this.writableColumns.has('Improvement Target')) {
      if (m.improvementGrade) props['Improvement Target'] = select(GRADE_TO_NOTION[m.improvementGrade]);
      else if (opts.forUpdate) props['Improvement Target'] = { select: null };
    }
    if (this.writableColumns.has('Leaver')) {
      const leaver = leaverFlags(mental);
      if (leaver.myTeam) props['Leaver'] = select('team');
      else if (leaver.enemyTeam) props['Leaver'] = select('enemy');
      else if (opts.forUpdate) props['Leaver'] = { select: null };
    }
    if (this.writableColumns.has('Tilt') && (mental?.tilt || opts.forUpdate)) {
      props['Tilt'] = { checkbox: Boolean(mental?.tilt) };
    }
    if (this.writableColumns.has('Toxic Mates') && (mental?.toxicMates || opts.forUpdate)) {
      props['Toxic Mates'] = { checkbox: Boolean(mental?.toxicMates) };
    }
    return props;
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
