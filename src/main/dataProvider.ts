import type { DataProvider } from './dashboard';
import type { HistoryStore } from '../store/history';
import type { ManualStore } from '../store/manualLog';
import type { NotionRuntime } from './notionRuntime';
import type { AppConfig } from './config';
import type { Logger } from './logger';
import { normalizeBreakReminder, type BreakReminderSettings } from '../core/breakReminder';
import { normalizeStaleness, type StalenessSettings } from '../core/staleness';
import { normalizeReadiness, type ReadinessSettings } from '../core/readiness';
import { normalizeSessionSettings, type SessionSettings } from '../core/sessionSettings';
import { normalizeGradingSettings, type GradingSettings } from '../core/gradingSettings';
import { effectiveDemo } from '../core/demoPreference';
import { openIfAllowed } from '../core/externalLink';
import { LOG_LEVELS, formatLogLine, type LogLevel } from '../core/logging';
import { redactForExport } from '../core/logRedaction';
import { formatDiagnostics } from '../core/about';
import { currentRank, srDeltaForSetRank, type RankAnchorMap } from '../core/rank';
import { classifyGameType } from '../core/matchFilter';
import { sourceOf } from '../core/source';
import { parseVantageImport } from '../core/importEnvelope';
import { mostPlayedHeroes as rankHeroesByPlays } from '../core/analytics';
import { mergeAccountList, UNKNOWN_ACCOUNT } from '../core/accountsManage';
import { resolveRole } from '../core/resolvers/role';
import { resolveAccount } from '../core/resolvers/account';
import { resolveMapId } from '../core/resolvers/mapId';
import { resolveResult } from '../core/resolvers/result';
import type { Role, Result, MatchRecord } from '../core/model';
import {
  DEFAULT_MASTER_DATA, mergeMasterData, applyAccepted, diffMasterData,
  upsertHeroOverride, removeHeroOverride, upsertMapOverride, removeMapOverride,
  upsertSeasonOverride, removeSeasonOverride, type FetchedCatalog, type MasterData,
} from '../core/masterData';
import type { RankAnchorStore } from '../store/rankAnchors';
import type { PlacementStore } from '../store/placements';
import {
  PLACEMENT_RUN_LENGTH, countedMatches, trackMatchesFrom, trackMatches, hasDrifted, isAwaitingRank,
  runProgress, shouldOfferRun, shouldOfferNewTrackRun, suppressedMatchIds,
  type PlacementRun,
} from '../core/placements';
import type { MasterDataStore } from '../store/masterData';
import type {
  AccountSummary, AppInfo, AppUiSettings, DataLocation, DataLocationResult,
  DevModeAuthStatusPayload, GepStatusPayload, ImportFileResult, LogExportResult, MatchEditInput, PendingMatch, RankSummary,
  PlacementRunSummary, PlacementOffer, PlacementTrackInput,
} from '../shared/contract';
import type { GameRecord } from '../core/analytics';

/**
 * Order-insensitive equality for two hero lists — a pure edit-change check used
 * by {@link editMatch} to decide whether a save actually altered the hero facts
 * (so re-ordering alone never trips the "facts edited" marker).
 */
function sameHeroes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((h, i) => h === sb[i]);
}

/**
 * Builds the {@link DataProvider} the dashboard consumes: every renderer-facing
 * read/write, mapped onto injected stores and edges. No Electron imports (deps
 * are type-only slices) — the composition root in ./index supplies the real
 * services.
 */

/** Backing services for the dashboard's DataProvider, as narrow structural slices so tests can inject plain objects. */
export interface DataProviderDeps {
  /** Durable game history: dataset reads plus review + manual-layer writes, account
   *  management (relabel/delete), per-match delete, and the pending-store read. */
  history: Pick<HistoryStore, 'count' | 'all' | 'setReview' | 'setReviews' | 'clearReview' | 'editManual' | 'add' | 'addMany' | 'mergeImported' | 'relabelAccount' | 'deleteByAccount' | 'deleteMatch' | 'removeImported' | 'importedCount' | 'allPending'>;
  /** Authored-target (◎ manual) persistence. */
  manual: Pick<ManualStore, 'targets' | 'addTarget' | 'updateTarget' | 'setActive' | 'deactivateAll' | 'setArchived' | 'removeTarget'>;
  /** Per-(account, role) rank anchors for the calculated-rank engine. */
  rankAnchors: Pick<RankAnchorStore, 'all' | 'get' | 'map' | 'set' | 'remove' | 'relabel' | 'removeAccount'>;
  /** Per-(account, role) placement-run tracking and its declined-season bookkeeping. */
  placements: Pick<
    PlacementStore,
    'allRuns' | 'getRun' | 'setRun' | 'removeRun' | 'declinedFor' | 'addDeclined' | 'relabel' | 'removeAccount'
  >;
  /** Persisted master-data override deltas (heroes/maps/seasons add/edit/remove). */
  masterDataStore: Pick<MasterDataStore, 'all' | 'replace'>;
  /** The online-catalog fetch edge (main-process `net.fetch` of OverFast); injected so this stays Electron-free. */
  fetchMasterDataUpdate(): Promise<FetchedCatalog>;
  /** The Notion edge: export/import, status, token lifecycle, the database picker, and the
   *  export-ledger clear (so a deleted imported match starts fresh on re-import/re-export). */
  notion: Pick<
    NotionRuntime,
    | 'export' | 'import' | 'status' | 'setToken' | 'clearToken'
    | 'listDatabases' | 'listPages' | 'selectDatabase' | 'createDatabase' | 'clearExports'
    | 'cleanupDuplicates'
  >;
  /** Live app config — re-read on every use (accounts, breakReminder), never cached. */
  getConfig(): AppConfig;
  /** Persist the full accounts map (battleTag → label) into the user's local config. */
  persistAccounts(accounts: Record<string, string>): void;
  /**
   * The file-import edge: show a picker, read the chosen file, and JSON.parse it.
   * Injected so this provider stays Electron/fs-free (mirrors {@link dataLocation}).
   * Resolves `undefined` when the user cancels; throws when the file can't be read
   * or isn't JSON (the caller turns that into an error result).
   */
  importFile: { pick(): Promise<unknown | undefined> };
  /** Persist new break-reminder settings into the user's local config file. */
  persistBreakReminder(s: BreakReminderSettings): void;
  /** Persist new target-staleness thresholds into the user's local config file. */
  persistStaleness(s: StalenessSettings): void;
  /** Persist new readiness feature settings into the user's local config file. */
  persistReadiness(s: ReadinessSettings): void;
  /** Persist a new session-gap threshold into the user's local config file. */
  persistSessionSettings(s: SessionSettings): void;
  /** Persist the measured-grade settings (partial-credit margin) into the user's local config file. */
  persistGrading(s: GradingSettings): void;
  /** Match-pipeline entry for manually logged games (same dedupe + reminder path as live ones). */
  recordGame(g: GameRecord): boolean;
  /** Match-pipeline entry to complete a held pending match (takes it out of the pending store into history). */
  resolvePending(matchId: string, result: Result): boolean;
  /** Match-pipeline entry to dismiss a held pending match (removes it from the pending store; never logged). */
  dismissPending(matchId: string): boolean;
  /** Surface a user-facing notification (the tray balloon in production). */
  notify(title: string, body: string): void;
  /**
   * Announce that a write changed what the dashboard would return, so open
   * windows refetch (see {@link DASHBOARD_WRITES}). Optional: tests and headless
   * paths omit it and the provider behaves exactly as it did before.
   */
  announceChange?(): void;
  /** Demo dataset shown until the first real game is tracked. */
  sampleGames(): GameRecord[];
  /** The release log: viewer ring, session level, renderer error sink. */
  logger: Pick<Logger, 'entries' | 'getLevel' | 'setLevel' | 'error'>;
  /**
   * Live secrets (e.g. the Notion token) to strip from an exported log bundle
   * — the same source the composition root feeds the logger's own redaction.
   */
  getSecrets(): string[];
  /** Live connection/data-flow status snapshot (from the GEP status monitor). */
  gepStatus(): GepStatusPayload;
  /** Dev-mode auth status snapshot (from the dev-mode auth monitor). */
  devModeAuthStatus(): DevModeAuthStatusPayload;
  /** App-behavior settings: current values + apply/persist (owned by the composition root). */
  appSettings: {
    get(): AppUiSettings;
    apply(patch: Partial<AppUiSettings>): AppUiSettings;
  };
  /** Persist the Overwolf dev key to ~/.ow-cli/dev-key; returns whether one is now present. */
  setDevKey(key: string): { hasKey: boolean };
  /** Version + build/runtime facts + support contact for the About screen. */
  appInfo(): AppInfo;
  /** Open an external URL — the composition root's `shell.openExternal`. */
  openExternal(url: string): Promise<void>;
  /**
   * Show a native save dialog defaulting to `defaultName` and write `contents`
   * to wherever the user picks; resolves `undefined` when they cancel (nothing
   * is written). Injected so this stays Electron/fs-free, and so it never
   * writes anywhere but the user's own chosen path (guardrail 5).
   */
  saveTextFile(defaultName: string, contents: string): Promise<string | undefined>;
  /** Restart the app to apply a staged GEP package fix (`app.relaunch()` + exit). */
  applyGepUpdate(): void;
  /** Data-folder location: current value, Settings folder-picker/migrate, and the
   *  first-run picker (owned by the composition root — it holds the mutable data
   *  dir and the live store handles the migration executor repoints). */
  dataLocation: {
    get(): DataLocation;
    choose(): Promise<DataLocationResult>;
    set(input: { folder: string; adopt?: boolean }): Promise<DataLocationResult>;
    chooseFirstRun(): Promise<DataLocationResult>;
  };
}

/** Assemble the dashboard's DataProvider over the injected deps. */
export function createDataProvider(deps: DataProviderDeps): DataProvider {
  const demoPref = () => deps.getConfig().ui.demoPreference;
  const effectiveMasterData = (): MasterData => mergeMasterData(DEFAULT_MASTER_DATA, deps.masterDataStore.all());
  // The manageable account list: configured accounts unioned with the accounts
  // only detected in history (Unknown bucket + unlabelled raw BattleTags),
  // de-duped by resolveAccount matching. Read live from config + history so it
  // reflects every account mutation immediately.
  const accountList = (): AccountSummary[] =>
    mergeAccountList(deps.getConfig().accounts, deps.history.all().map((g) => g.account));
  // Undo buffer for deleted matches, keyed by matchId. In memory only and never
  // persisted: the Undo exists for the lifetime of a toast, not as a recycle
  // bin, and a delete the user walked away from should stay done. Bounded so a
  // long session of cleanup can't accumulate records without limit.
  const deletedUndo = new Map<string, GameRecord>();
  const UNDO_BUFFER = 20;
  const provider: DataProvider = {
    // Sample games fill an empty history ONLY when the user opted into demo mode;
    // a fresh-start user sees nothing until they track real matches.
    games: () => (deps.history.count() ? deps.history.all() : demoPref() === 'on' ? deps.sampleGames() : []),
    isSample: () => effectiveDemo(demoPref(), deps.history.count()),
    demoContext: () => ({
      active: effectiveDemo(demoPref(), deps.history.count()),
      preference: demoPref(),
      hasRealHistory: deps.history.count() > 0,
    }),
    exportToNotion: (games) => deps.notion.export(games),
    notionStatus: () => deps.notion.status(),
    setNotionToken: (token) => deps.notion.setToken(token),
    clearNotionToken: () => deps.notion.clearToken(),
    manualTargets: () => deps.manual.targets(),
    saveTarget: (input) => {
      const now = Date.now();
      deps.manual.addTarget({
        id: `t-${now}`, createdAt: now, isActive: true, activatedAt: now, scope: 'season', ...input,
      });
    },
    saveReview: (input) => {
      deps.history.setReview(input.matchId, { at: Date.now(), grades: input.grades, flags: input.flags });
      if (input.performance !== undefined) deps.history.editManual(input.matchId, { performance: input.performance });
      // GEP can't report SR, so the player may set it here (competitive only);
      // `null` clears, `undefined` leaves it unchanged (editManual deletes on null).
      if (input.srDelta !== undefined) deps.history.editManual(input.matchId, { srDelta: input.srDelta });
    },
    importReviews: (inputs) =>
      deps.history.setReviews(inputs.map((i) => ({
        matchId: i.matchId,
        review: { at: Date.now(), grades: i.grades, flags: i.flags },
      }))),
    updateTarget: (input) => {
      deps.manual.updateTarget(input.id, {
        name: input.name, mode: input.mode, rule: input.rule,
        roleScope: input.roleScope, heroScope: input.heroScope,
      });
    },
    setTargetActive: (id, active) => deps.manual.setActive(id, active),
    deactivateAllTargets: () => deps.manual.deactivateAll(),
    setTargetArchived: (id, archived) => deps.manual.setArchived(id, archived),
    deleteTarget: (id) => deps.manual.removeTarget(id),
    logMatch: (input) => {
      const matchId = `manual-${Date.now()}`;
      const grades = input.grades && Object.keys(input.grades).length ? input.grades : undefined;
      deps.recordGame({
        matchId,
        timestamp: input.playedAt != null ? Math.min(input.playedAt, Date.now()) : Date.now(),
        account: input.account || Object.values(deps.getConfig().accounts)[0] || 'You',
        role: input.role,
        map: input.map,
        result: input.result,
        gameType: input.gameType,
        source: 'manual',
        heroes: input.heroes ?? (input.hero ? [input.hero] : []),
        mental: input.mental,
        ...(input.srDelta != null ? { srDelta: input.srDelta } : {}),
        ...(input.performance != null ? { performance: input.performance } : {}),
        // Inline target grades captured while logging are stored as a review, the
        // same shape the Review screen writes — so they score identically.
        ...(grades ? { review: { at: Date.now(), grades, flags: input.mental ?? {} } } : {}),
      });
      deps.notify('Match logged', `${input.result} · ${input.map}`);
      return { matchId };
    },
    editMatch: (input: MatchEditInput) => {
      const game = deps.history.all().find((g) => g.matchId === input.matchId);
      if (!game) return;
      const isManual = sourceOf(game) === 'manual';
      const patch: Parameters<HistoryStore['editManual']>[1] = {};
      // Game facts are editable on EVERY match now — a result the feed got wrong
      // (a leaver scored as a loss, a misread draw) can be hand-corrected on an
      // auto-tracked match too. `heroes` (the multi-hero list) wins when provided;
      // fall back to the legacy single-hero coercion. Both honour `[]`/'' as "clear".
      const nextHeroes =
        input.heroes !== undefined ? input.heroes
        : input.hero !== undefined ? (input.hero ? [input.hero] : [])
        : undefined;
      if (input.result !== undefined) patch.result = input.result;
      if (input.role !== undefined) patch.role = input.role;
      if (input.map !== undefined) patch.map = input.map;
      if (input.gameType !== undefined) patch.gameType = input.gameType;
      if (nextHeroes !== undefined) patch.heroes = nextHeroes;
      // Provenance honesty: when a hand-edit actually CHANGES a game fact on an
      // auto-tracked match, stamp `factsEditedAt` so the UI can show a subtle
      // "edited" marker (the record keeps source 'gep'). Never on manual matches
      // (editable by nature), and not when the save leaves every fact untouched.
      const factsChanged =
        (input.result !== undefined && input.result !== game.result) ||
        (input.role !== undefined && input.role !== game.role) ||
        (input.map !== undefined && input.map !== game.map) ||
        (input.gameType !== undefined && input.gameType !== game.gameType) ||
        (nextHeroes !== undefined && !sameHeroes(nextHeroes, game.heroes ?? []));
      if (!isManual && factsChanged) patch.factsEditedAt = Date.now();
      // The manual layer applies to any match. srDelta: number sets it, null
      // clears it (editManual deletes on null), undefined leaves it unchanged.
      if (input.mental !== undefined) patch.mental = input.mental;
      // Rank movement arrives as a plain srDelta, always. "Set current rank" is
      // an input aid the renderer resolves through `rankEntryPreview` before
      // saving, so there is no absolute-rank branch to maintain here.
      if (input.srDelta !== undefined) patch.srDelta = input.srDelta;
      if (input.performance !== undefined) patch.performance = input.performance;
      // Stamp a review when there are grades to save, OR when the match is
      // already reviewed — an edit with no targets shouldn't mark an otherwise-
      // ungraded match as reviewed, but if it's already reviewed we must
      // re-stamp review.flags alongside patch.mental so the two layers can't
      // drift (an editor flag-only edit would otherwise leave review.flags
      // stale while mental moves on, resurrecting the old flag on read).
      const hasGrades = !!(input.grades && Object.keys(input.grades).length);
      if (hasGrades || game.review) {
        patch.review = {
          at: Date.now(),
          grades: hasGrades ? input.grades! : game.review?.grades ?? {},
          flags: input.mental ?? game.mental ?? {},
        };
      }
      deps.history.editManual(input.matchId, patch);
    },
    deleteMatch: (matchId) => {
      // Gated behind a renderer confirm: drop the history row outright — the
      // user's verdict that a tracked game was never real. The whole record
      // goes with it (review, grades, mental, roster, srDelta all live on that
      // row), and every derived stat recomputes on the next read since nothing
      // in core/ memoizes. Reversible only via undoDeleteMatch below, and only
      // while the record is still in the in-memory buffer.
      const removed = deps.history.deleteMatch(matchId);
      if (!removed) return { deleted: false };
      // Hold the removed record so Undo can put it back byte-identically —
      // same id, same provenance, same review — rather than re-logging an
      // impostor. Oldest entry falls off once the buffer is full.
      deletedUndo.set(matchId, removed);
      if (deletedUndo.size > UNDO_BUFFER) {
        const oldest = deletedUndo.keys().next().value;
        if (oldest !== undefined) deletedUndo.delete(oldest);
      }
      // Cascade like the other local-delete paths: the Notion export ledger
      // entry must go too, or a matchId that ever comes back is skipped on a
      // stale signature (see notionRuntime.clearExports). This only clears the
      // LOCAL ledger — the page in the user's Notion workspace is left alone,
      // since the only outbound path is an explicit export (guardrail 5).
      deps.notion.clearExports([matchId]);
      // Defensive: an id can end up in both tables (a replay or re-import can
      // re-hold a match that's already recorded), and a stray pending row would
      // resurrect the match in Review. Goes through the pipeline's dismiss so
      // the `pending-changed` push still fires.
      deps.dismissPending(matchId);
      // Rank anchors are deliberately NOT touched: an anchor is keyed
      // (account, role) and carries no matchId — "I was rank X at time T" stays
      // true. Rank self-corrects because reconstruct sums srDelta over the
      // remaining games.
      return { deleted: true };
    },
    undoDeleteMatch: (matchId) => {
      const record = deletedUndo.get(matchId);
      if (!record) return { restored: false };
      deletedUndo.delete(matchId);
      // `add` is INSERT … ON CONFLICT DO NOTHING, so an id that came back by
      // another route (a re-import, a replay) wins over the buffered copy
      // instead of being clobbered by it. Either way the match is present
      // again, which is what the user asked for — so this still reports true.
      deps.history.add(record);
      // The Notion ledger entry cleared on delete is deliberately NOT rebuilt.
      // It only recorded which page this match had already been exported to,
      // and the exporter never blind-creates for an unledgered match — it
      // re-adopts the existing row through its index — so a re-export finds the
      // same page rather than duplicating it.
      return { restored: true };
    },
    listAccounts: () => accountList(),
    saveAccount: (input) => {
      const accounts = { ...deps.getConfig().accounts };
      const newLabel = input.label || input.battleTag;
      // Renaming the label: cascade onto stored games + rank anchors (both key by
      // label) so existing history and rank tracks stay attached, not orphaned.
      const oldLabel = input.previousBattleTag ? accounts[input.previousBattleTag] : undefined;
      if (input.previousBattleTag && input.previousBattleTag !== input.battleTag) {
        delete accounts[input.previousBattleTag];
      }
      if (oldLabel && oldLabel !== newLabel) {
        deps.history.relabelAccount(oldLabel, newLabel);
        deps.rankAnchors.relabel(oldLabel, newLabel);
        // Placement runs are keyed by the same (account, role) as anchors, so a
        // relabel that moves one must move the other or the run is orphaned
        // under a name nothing reads any more. Newly load-bearing now that a run
        // can be started automatically on a raw, not-yet-labelled BattleTag.
        deps.placements.relabel(oldLabel, newLabel);
      } else if (!oldLabel && input.battleTag !== newLabel) {
        // Labelling a detected raw-tag account: its history rows + anchors are
        // keyed by the raw BattleTag, so adopt the new label — the raw-tag entry
        // then de-dupes into this configured one instead of lingering. (A no-op
        // for a brand-new account with no matching history.)
        deps.history.relabelAccount(input.battleTag, newLabel);
        deps.rankAnchors.relabel(input.battleTag, newLabel);
        deps.placements.relabel(input.battleTag, newLabel);
      }
      accounts[input.battleTag] = newLabel;
      deps.persistAccounts(accounts);
      return accountList();
    },
    deleteAccount: (battleTag) => {
      // Non-destructive: drops the configured label only. History rows keep their
      // account value (they'll resurface as a detected-unlabelled entry if any
      // exist) — deleting match data is the separate deleteDetectedAccount path.
      const accounts = { ...deps.getConfig().accounts };
      delete accounts[battleTag];
      deps.persistAccounts(accounts);
      return accountList();
    },
    deleteDetectedAccount: (account) => {
      // IRREVERSIBLE (gated behind a renderer confirm): wipe every history row
      // stored under this exact account value plus its per-role rank anchors.
      // Touches no config — a detected account was never a configured label.
      deps.history.deleteByAccount(account);
      deps.rankAnchors.removeAccount(account);
      deps.placements.removeAccount(account);
      return accountList();
    },
    getRanks: () => rankSummaries(deps),
    mostPlayedHeroes: () => mostPlayedHeroesByAccount(deps),
    setRankAnchor: (input) => {
      deps.rankAnchors.set({
        account: input.account,
        role: input.role,
        tier: input.tier,
        division: input.division,
        progressPct: input.progressPct,
        setAt: Date.now(),
      });
      return rankSummaries(deps);
    },
    rankAnchorMap: (): RankAnchorMap => deps.rankAnchors.map(),
    rankEntryPreview: (input) => {
      // Read-only by construction: this is the translation from "I ended at this
      // rank" to the ±% the player would otherwise have typed. Without an anchor
      // there is no rank-before to measure against — srDeltaForSetRank would
      // return a meaningless 0 — so say that instead, and let the caller offer
      // anchoring rather than show a fabricated number.
      if (!deps.rankAnchors.get(input.account, input.role)) return { anchored: false };
      return {
        anchored: true,
        srDelta: srDeltaForSetRank(
          deps.history.all(), deps.rankAnchors.map(),
          input.account, input.role, input.timestamp, input.rank,
        ),
      };
    },
    getPlacements: () => placementSummaries(deps),
    placementRuns: (): PlacementRun[] => deps.placements.allRuns(),
    startPlacementRun: (input) => {
      const existing = deps.placements.getRun(input.account, input.role);
      // Restarting a completed run must first hand back the rank its completion
      // wrote, or the "pre-run" state would silently become the placement result.
      if (existing?.completedAt !== undefined) restorePreRunAnchor(deps, existing);
      deps.placements.setRun({
        account: input.account,
        role: input.role,
        startedAt: resolveRunStart(deps, input.fromMatchId),
        // Never re-snapshot over an existing run's snapshot: that original
        // anchor is the only thing that can undo the run, and overwriting it
        // with the current one would make "reset to begin" a no-op. Keyed on
        // whether a run EXISTS, not on `?? `: a run that legitimately snapshotted
        // `null` (started on an unanchored track) is nullish, so `??` would fall
        // through and quietly adopt whatever anchor is live now.
        preRunAnchor: existing
          ? existing.preRunAnchor
          : deps.rankAnchors.get(input.account, input.role) ?? null,
        // Carried, not cleared. Re-pointing an existing run at an earlier match
        // ("Change start match…", for a run started late) is a correction to
        // WHERE the run begins, not a decision to throw away the predicted
        // ranks already entered. They are keyed by matchId and only ever read
        // for the counted matches, so one that falls outside the new window is
        // simply not read — and is there again if the window moves back.
        // `resetPlacementRun` is the action that means "replay from scratch",
        // and it still clears them.
        predictions: existing?.predictions ?? {},
        ...(existing?.seasonStart !== undefined ? { seasonStart: existing.seasonStart } : {}),
      });
      return placementSummaries(deps);
    },
    setPlacementPrediction: (input) => {
      const run = deps.placements.getRun(input.account, input.role);
      if (run) {
        const predictions = { ...run.predictions };
        if (input.prediction) predictions[input.matchId] = input.prediction;
        else delete predictions[input.matchId];
        deps.placements.setRun({ ...run, predictions });
      }
      return placementSummaries(deps);
    },
    completePlacementRun: (input) => {
      const run = deps.placements.getRun(input.account, input.role);
      if (!run) return placementSummaries(deps);
      const games = deps.history.all();
      const counted = countedMatches(games, run);
      // Stamped at the LAST match in the run's WINDOW, not Date.now():
      // `competitiveComps` filters strictly after the anchor instant, so this is
      // what keeps the suppressed matches out of the rank arithmetic while
      // everything logged afterwards moves the rank normally. `setRankAnchor`
      // can't be used here — it stamps the wall clock (same reason the import
      // path writes directly).
      //
      // The window, not the counted ten: the rank being entered is the one the
      // game is showing the player NOW, which already reflects every match they
      // played after their tenth. Anchoring at the tenth would re-apply those
      // matches' ±% on top of a rank that already includes them — measured at a
      // full division of overshoot. With no surplus (the ordinary case) the two
      // are the same match, so this changes nothing for a run confirmed promptly.
      const window = trackMatchesFrom(games, run);
      const setAt = window.length ? window[window.length - 1].timestamp : run.startedAt;
      deps.rankAnchors.set({
        account: input.account,
        role: input.role,
        tier: input.tier,
        division: input.division,
        progressPct: input.progressPct ?? 0,
        setAt,
      });
      deps.placements.setRun({ ...run, completedAt: setAt, completedMatchIds: counted.map((g) => g.matchId) });
      return placementSummaries(deps);
    },
    resetPlacementRun: (input) => {
      const run = deps.placements.getRun(input.account, input.role);
      if (!run) return placementSummaries(deps);
      deps.placements.setRun({ ...reopened(deps, run), predictions: {} });
      return placementSummaries(deps);
    },
    cancelPlacementRun: (input) => {
      const run = deps.placements.getRun(input.account, input.role);
      if (!run) return placementSummaries(deps);
      if (run.completedAt !== undefined) restorePreRunAnchor(deps, run);
      deps.placements.removeRun(input.account, input.role);
      return placementSummaries(deps);
    },
    placementOffer: (input) => {
      const current = currentSeason(effectiveMasterData());
      if (!current) return null;
      const anchor = deps.rankAnchors.get(input.account, input.role) ?? null;
      const existingRun = deps.placements.getRun(input.account, input.role);
      const declinedSeasonStarts = deps.placements.declinedFor(input.account, input.role);
      const games = deps.history.all();
      // Rule 1: the ladder reset moved a rank this track already had.
      if (shouldOfferRun({
        seasonStart: current.start,
        isResetSeason: current.isReset === true,
        anchor, existingRun, declinedSeasonStarts,
      })) {
        return offerFrom(games, input, current, 'season-reset');
      }
      // Rule 2: Vantage has no rank for this track at all (issue #200). Skipped
      // for the Unknown bucket — a match with no captured or mapped BattleTag
      // lands there, and "Placements for Damage on Unknown?" asks about a label
      // the player is about to replace, keying the run to a name that won't last.
      if (input.account === UNKNOWN_ACCOUNT) return null;
      const played = trackMatches(games, input.account, input.role, current.start);
      if (shouldOfferNewTrackRun({
        seasonStart: current.start,
        anchor, existingRun, declinedSeasonStarts,
        trackMatchCount: played.length,
      })) {
        return offerFrom(games, input, current, 'new-track');
      }
      return null;
    },
    declinePlacementRun: (input) => {
      deps.placements.addDeclined(input.account, input.role, input.seasonStart);
    },
    recountPlacementRun: (input) => {
      const run = deps.placements.getRun(input.account, input.role);
      if (!run || run.completedAt === undefined) return placementSummaries(deps);
      const counted = countedMatches(deps.history.all(), run);
      if (counted.length >= PLACEMENT_RUN_LENGTH) {
        // Still a full run — the matches merely changed identity. Re-baseline the
        // snapshot so the drift notice clears; the anchor stays as completed.
        deps.placements.setRun({ ...run, completedMatchIds: counted.map((g) => g.matchId) });
      } else {
        // No longer ten matches: withdraw the anchor the completion wrote and
        // reopen. Predictions survive — they belong to matches, not to the run's
        // completion, and re-entering them by hand would be pure busywork.
        deps.placements.setRun(reopened(deps, run));
      }
      return placementSummaries(deps);
    },
    importNotion: async () => {
      const res = await deps.notion.import();
      if (res.unavailable) return { imported: 0, skipped: 0, failed: 0, unavailable: true };
      if (res.error) return { imported: 0, skipped: 0, failed: res.failed, error: res.error };
      // Split the imported rows: brand-new matchIds go through `addMany` (they
      // arrive already reviewed when Notion carried a grade — that's fine, a
      // fresh row has no local state to protect); matchIds already tracked
      // locally go through `mergeImported`, which never overwrites an existing
      // review or mental record (local always wins) but fills in a bookkeeping
      // grade / adopts mental flags when the local match has none at all. No
      // `AuthoredTarget` is ever seeded for the imported grade — B2 keeps it a
      // hidden bookkeeping value on the match review only.
      const known = new Set(deps.history.all().map((g) => g.matchId));
      const fresh = res.games.filter((g) => !known.has(g.matchId));
      const existing = res.games.filter((g) => known.has(g.matchId));
      // Stamp every brand-new imported game so it can be wiped for a clean
      // re-import (removeImported) without touching live-tracked or
      // hand-logged matches. `importSource:'notion'` keeps this clear scoped to
      // Notion imports (file imports are a separate bucket). A merged row keeps
      // its existing provenance.
      const importedAt = Date.now();
      const { imported } = deps.history.addMany(
        fresh.map((g) => ({ ...g, importedAt, importSource: 'notion' as const })),
      );
      const { merged, skipped } = deps.history.mergeImported(existing);
      // Surface the imported accounts so they appear in the account manager, the
      // filters and the rank UI — Notion only stores the account *label*, not the
      // battleTag, so each becomes a name-only entry that live play reconnects to.
      const accountsAdded = seedImportedAccounts(deps, res.games);
      return {
        imported, skipped, failed: res.failed,
        ...(merged ? { merged } : {}),
        ...(accountsAdded ? { accountsAdded } : {}),
        ...(res.duplicates ? { duplicates: res.duplicates } : {}),
      };
    },
    deleteImportedMatches: () => {
      const removed = deps.history.removeImported('notion');
      deps.notion.clearExports(removed.map((g) => g.matchId));
      return { deleted: removed.length };
    },
    importFromFile: async (): Promise<ImportFileResult> => {
      const empty = { imported: 0, skipped: 0, invalid: 0, accountsAdded: 0, anchorSet: false };
      let raw: unknown;
      try {
        const picked = await deps.importFile.pick();
        if (picked === undefined) return { ...empty, cancelled: true };
        raw = picked;
      } catch (err) {
        return { ...empty, error: err instanceof Error ? err.message : String(err) };
      }
      const parsed = parseVantageImport(raw);
      // `invalid` counts only rejected match ROWS (index !== null); envelope- and
      // anchor-level problems (index === null) are surfaced via `error`/`anchorSet`.
      const invalid = parsed.errors.filter((e) => e.index !== null).length;
      // Nothing importable AND an envelope-level problem → reject cleanly, write nothing.
      if (!parsed.games.length) {
        const envelopeErr = parsed.errors.find((e) => e.index === null);
        if (envelopeErr) return { ...empty, invalid, error: envelopeErr.reason };
      }
      // Mark every added game as file-imported so it can be wiped for a clean
      // re-sync without touching live, hand-logged, or Notion-imported matches.
      const importedAt = Date.now();
      const { imported, skipped } = deps.history.addMany(
        parsed.games.map((g) => ({ ...g, importedAt, importSource: 'file' as const })),
      );
      const accountsAdded = seedImportedAccounts(deps, parsed.games);
      let anchorSet = false;
      if (parsed.anchor && parsed.account) {
        // Anchor at the latest imported competitive match for this (account, role):
        // the rank engine reconstructs older matches backward from the supplied
        // current rank. `rankAnchors.set` directly (NOT setRankAnchor, which would
        // stamp setAt=now and exclude every match from the ladder).
        const { anchor, account } = parsed;
        const latest = parsed.games
          .filter((g) => g.account === account && g.role === anchor.role && classifyGameType(g.gameType) === 'competitive')
          .reduce((max, g) => Math.max(max, g.timestamp), 0);
        // Don't backdate over a newer anchor the player set by hand (or via a later
        // import): only (re)set when there's no anchor yet, or this file's latest
        // match is at least as recent as the existing anchor. A plain re-import of
        // the same file re-sets the identical value (harmless).
        const existing = deps.rankAnchors.get(account, anchor.role);
        if (latest > 0 && (!existing || latest >= existing.setAt)) {
          deps.rankAnchors.set({
            account,
            role: anchor.role,
            tier: anchor.tier,
            division: anchor.division,
            progressPct: anchor.progressPct,
            setAt: Math.min(latest, importedAt),
          });
          anchorSet = true;
        }
      }
      return { imported, skipped, invalid, accountsAdded, anchorSet };
    },
    deleteFileImports: () => {
      const removed = deps.history.removeImported('file');
      deps.notion.clearExports(removed.map((g) => g.matchId));
      return { deleted: removed.length };
    },
    fileImportedCount: () => deps.history.importedCount('file'),
    cleanupNotionDuplicates: () => deps.notion.cleanupDuplicates(),
    getBreakReminder: () => deps.getConfig().breakReminder,
    setBreakReminder: (input) => {
      const config = deps.getConfig();
      config.breakReminder = normalizeBreakReminder(input);
      deps.persistBreakReminder(config.breakReminder);
      return config.breakReminder;
    },
    getReadiness: () => deps.getConfig().readiness,
    setReadiness: (input) => {
      const config = deps.getConfig();
      config.readiness = normalizeReadiness(input);
      deps.persistReadiness(config.readiness);
      return config.readiness;
    },
    getSessionSettings: () => deps.getConfig().sessionSettings,
    setSessionSettings: (input) => {
      const config = deps.getConfig();
      config.sessionSettings = normalizeSessionSettings(input);
      deps.persistSessionSettings(config.sessionSettings);
      return config.sessionSettings;
    },
    getGrading: () => deps.getConfig().grading,
    setGrading: (input) => {
      const config = deps.getConfig();
      config.grading = normalizeGradingSettings(input);
      deps.persistGrading(config.grading);
      return config.grading;
    },
    getStaleness: () => deps.getConfig().staleness,
    setStaleness: (input) => {
      const config = deps.getConfig();
      config.staleness = normalizeStaleness(input);
      deps.persistStaleness(config.staleness);
      return config.staleness;
    },
    listNotionDatabases: () => deps.notion.listDatabases(),
    listNotionPages: () => deps.notion.listPages(),
    selectNotionDatabase: (databaseId) => deps.notion.selectDatabase(databaseId),
    createNotionDatabase: (parentPageId) => deps.notion.createDatabase(parentPageId),
    getLogEntries: () => deps.logger.entries(),
    getLogLevel: () => deps.logger.getLevel(),
    setLogLevel: (level) => {
      // Untrusted over IPC — an unknown level would silence the log entirely.
      if (LOG_LEVELS.includes(level as LogLevel)) deps.logger.setLevel(level);
      return deps.logger.getLevel();
    },
    logRendererError: (input) => {
      deps.logger.error('renderer', input.message, {
        ...(input.source ? { source: input.source } : {}),
        ...(input.stack ? { stack: input.stack } : {}),
      });
    },
    exportLogBundle: async (): Promise<LogExportResult> => {
      const info = deps.appInfo();
      const redacted = redactForExport(deps.logger.entries(), deps.getSecrets());
      const header = [
        formatDiagnostics(info),
        '',
        'BattleTags, player names, and Windows usernames were removed before export',
        '(best-effort, not a guarantee) — please still review before attaching this to a public report.',
      ].join('\n');
      const contents = [header, '', ...redacted.map(formatLogLine)].join('\n') + '\n';
      try {
        const savedPath = await deps.saveTextFile(`vantage-log-${info.version}.txt`, contents);
        return savedPath ? { path: savedPath } : { cancelled: true };
      } catch (err) {
        // A rejected write (read-only target, disk full, file open elsewhere) must not
        // surface as silence: the user is mid bug-report and about to go looking for
        // a file that was never written.
        const detail = (err as { message?: string })?.message;
        return { error: detail ? `Couldn't save the debug log — ${detail}` : "Couldn't save the debug log." };
      }
    },
    getGepStatus: () => deps.gepStatus(),
    getDevModeAuthStatus: () => deps.devModeAuthStatus(),
    getAppSettings: () => deps.appSettings.get(),
    setAppSettings: (patch) => deps.appSettings.apply(patch),
    setDevKey: (key) => deps.setDevKey(key),
    getAppInfo: () => deps.appInfo(),
    // Scheme-guarded before it ever reaches the shell: a disallowed URL is a no-op.
    openExternal: async (url) => { await openIfAllowed(url, deps.openExternal); },
    applyGepUpdate: () => deps.applyGepUpdate(),
    getDataLocation: () => deps.dataLocation.get(),
    chooseDataFolder: () => deps.dataLocation.choose(),
    setDataFolder: (input) => deps.dataLocation.set(input),
    chooseFirstRunDataFolder: () => deps.dataLocation.chooseFirstRun(),
    clearReview: (matchId) => {
      deps.history.clearReview(matchId);
    },
    pendingMatches: () => {
      const accounts = deps.getConfig().accounts;
      return deps.history.allPending().map((rec) => toPendingMatch(rec, accounts));
    },
    resolvePendingMatch: (matchId, result) => {
      deps.resolvePending(matchId, result);
    },
    dismissPendingMatch: (matchId) => {
      deps.dismissPending(matchId);
    },
    effectiveMasterData,
    masterDataUpsertHero: (entry) => {
      deps.masterDataStore.replace(upsertHeroOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, entry));
      return effectiveMasterData();
    },
    masterDataRemoveHero: (name) => {
      deps.masterDataStore.replace(removeHeroOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, name));
      return effectiveMasterData();
    },
    masterDataUpsertMap: (entry) => {
      deps.masterDataStore.replace(upsertMapOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, entry));
      return effectiveMasterData();
    },
    masterDataRemoveMap: (name) => {
      deps.masterDataStore.replace(removeMapOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, name));
      return effectiveMasterData();
    },
    masterDataUpsertSeason: (entry) => {
      deps.masterDataStore.replace(upsertSeasonOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, entry));
      return effectiveMasterData();
    },
    masterDataRemoveSeason: (id) => {
      deps.masterDataStore.replace(removeSeasonOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, id));
      return effectiveMasterData();
    },
    masterDataFetchUpdate: async () => {
      const fetched = await deps.fetchMasterDataUpdate();
      return diffMasterData(effectiveMasterData(), fetched);
    },
    masterDataApplyUpdate: (accepted) => {
      deps.masterDataStore.replace(applyAccepted(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, accepted));
      return effectiveMasterData();
    },
  };
  return deps.announceChange ? announcing(provider, deps.announceChange) : provider;
}

/**
 * The provider writes that change what {@link computeDashboard} would return —
 * history rows, reviews and ±SR, rank anchors, placement runs, account
 * attribution, and the bulk import/delete paths. Each one announces, so every
 * open surface refetches no matter who called it: a renderer view, or the MCP
 * server writing on the user's behalf.
 *
 * Writes that ALREADY push are deliberately absent, so a single user action
 * never costs two refetches: `logMatch` pushes `onGameLogged` from the match
 * pipeline (`matchPipeline.recordGame`), and `resolvePendingMatch` /
 * `dismissPendingMatch` push `onPendingChanged` from the same place.
 *
 * Kept as one explicit list rather than "everything that isn't a read": the set
 * of methods that move the RANK is much smaller than the set that mutates
 * something, and pushing a refetch after `setLogLevel` or `logRendererError`
 * would be noise. {@link ../../test/dataChangedPush.test.ts} pins the list
 * against the real provider so a renamed method can't silently fall out of it.
 */
export const DASHBOARD_WRITES = [
  'saveReview', 'clearReview', 'importReviews',
  'editMatch', 'deleteMatch', 'undoDeleteMatch',
  'setRankAnchor',
  'startPlacementRun', 'setPlacementPrediction', 'completePlacementRun',
  'resetPlacementRun', 'cancelPlacementRun', 'recountPlacementRun', 'declinePlacementRun',
  'saveAccount', 'deleteAccount', 'deleteDetectedAccount',
  'importNotion', 'deleteImportedMatches', 'importFromFile', 'deleteFileImports',
  'cleanupNotionDuplicates',
] as const satisfies readonly (keyof DataProvider)[];

/**
 * Wrap each {@link DASHBOARD_WRITES} method so it announces after it has
 * actually written — after the promise settles for the async ones, so a
 * refetch triggered by the announcement can never read pre-write state.
 * A throwing write announces nothing: nothing changed.
 */
function announcing(provider: DataProvider, announce: () => void): DataProvider {
  const out: DataProvider = { ...provider };
  for (const name of DASHBOARD_WRITES) {
    const fn = provider[name] as (...args: unknown[]) => unknown;
    (out as unknown as Record<string, unknown>)[name] = (...args: unknown[]): unknown => {
      const result = fn.call(provider, ...args);
      if (result instanceof Promise) return result.then((value) => { announce(); return value; });
      announce();
      return result;
    };
  }
  return out;
}

/**
 * Register a name-only account (`label → label`) for every distinct account
 * label in the imported games that isn't already represented in the config
 * (compared case-insensitively, since {@link resolveAccount} matches that way).
 * Notion's `Account` column carries only the label, never the battleTag, so a
 * name-only entry is the faithful seed: it lists/rank-anchors the account and,
 * via `resolveAccount`'s name-only fallback, reconnects to live GEP play from
 * the real battleTag later. Returns how many were added.
 */
function seedImportedAccounts(deps: DataProviderDeps, games: GameRecord[]): number {
  const accounts = { ...deps.getConfig().accounts };
  const known = new Set(Object.values(accounts).map((label) => label.toLowerCase()));
  let added = 0;
  for (const label of new Set(games.map((g) => g.account))) {
    if (!label || known.has(label.toLowerCase())) continue;
    accounts[label] = label; // name-only entry: battleTag key == label
    known.add(label.toLowerCase());
    added++;
  }
  if (added) deps.persistAccounts(accounts);
  return added;
}

/**
 * Summarize a held raw {@link MatchRecord} into the lean {@link PendingMatch} the
 * Review screen renders — resolving map/role/account with the SAME resolvers the
 * live capture path ({@link matchToGame}) uses, so a resolved result looks
 * identical to an auto-tracked one. Never produces a GameRecord: a pending match
 * stays out of history/analytics until the user sets its result.
 */
function toPendingMatch(rec: MatchRecord, accounts: Record<string, string>): PendingMatch {
  return {
    matchId: rec.matchId,
    map: resolveMapId(rec.mapName) ?? 'Unknown',
    heroes: rec.heroes,
    role: resolveRole(rec.queueType, rec.heroRole) ?? 'openQ',
    account: resolveAccount(rec.battleTag, accounts) ?? rec.battleTag ?? 'Unknown',
    timestamp: rec.endedAt ?? 0,
    rosterCount: rec.roster?.length ?? 0,
    // A held match can still carry a GEP-reported outcome (it was held for an
    // unknown game_type, not necessarily a missing result) — surface it so
    // Review can hint it and make confirming it one click.
    ...(resolveResult(rec.outcome) ? { reportedResult: resolveResult(rec.outcome) } : {}),
  };
}

/**
 * Per-account, per-role most-played hero names, over the FULL unfiltered
 * history (a durable "what do I usually play" signal, not scoped to whatever
 * the global dashboard filter currently shows) — the Log Match hero-picker
 * shortlist's source. Only accounts/roles with at least one game get an entry.
 */
function mostPlayedHeroesByAccount(deps: DataProviderDeps): Record<string, Partial<Record<Role, string[]>>> {
  const games = deps.history.all();
  const roles: Role[] = ['tank', 'damage', 'support', 'openQ'];
  const out: Record<string, Partial<Record<Role, string[]>>> = {};
  for (const account of new Set(games.map((g) => g.account))) {
    const perRole: Partial<Record<Role, string[]>> = {};
    for (const role of roles) {
      const names = rankHeroesByPlays(games, account, role);
      if (names.length) perRole[role] = names;
    }
    if (Object.keys(perRole).length) out[account] = perRole;
  }
  return out;
}

/**
 * Put the track's anchor back exactly as it stood before `run` started.
 *
 * A run that began on an un-anchored track snapshots `null`, and restoring that
 * has to mean "no anchor" again rather than "keep whatever completion wrote" —
 * otherwise resetting such a run would strand a rank the player never set. This
 * is why {@link ../store/rankAnchors RankAnchorStore} grew a per-track `remove`.
 */
function restorePreRunAnchor(deps: DataProviderDeps, run: PlacementRun): void {
  if (run.preRunAnchor) {
    deps.rankAnchors.set({ ...run.preRunAnchor, account: run.account, role: run.role });
  } else {
    deps.rankAnchors.remove(run.account, run.role);
  }
}

/**
 * `run` rewound to an open, uncompleted state, restoring the pre-run anchor on
 * the way when the run had actually written one.
 *
 * The restore is deliberately conditional on `completedAt`: an OPEN run never
 * touched the anchor, so "restoring" it there would clobber a rank the player
 * may have set by hand mid-run — undo only what we actually did.
 */
function reopened(deps: DataProviderDeps, run: PlacementRun): PlacementRun {
  if (run.completedAt !== undefined) restorePreRunAnchor(deps, run);
  const { completedAt: _completedAt, completedMatchIds: _completedMatchIds, ...open } = run;
  return open;
}

/**
 * When a run begins. `fromMatchId` backdates it to an already-logged match — the
 * "I only realised four games in that I was placing" case — so those matches are
 * reclassified as placements. Their recorded ±% stays in the record and is only
 * ignored while the run is open, which is what keeps backdating reversible.
 */
function resolveRunStart(deps: DataProviderDeps, fromMatchId?: string): number {
  if (!fromMatchId) return Date.now();
  const match = deps.history.all().find((g) => g.matchId === fromMatchId);
  return match ? match.timestamp : Date.now();
}

/** Progress, prediction and drift for every tracked placement run. */
function placementSummaries(deps: DataProviderDeps): PlacementRunSummary[] {
  const games = deps.history.all();
  return deps.placements.allRuns().map((run) => {
    const { counted, target, latestPrediction, countedMatchIds } = runProgress(games, run);
    return {
      account: run.account,
      role: run.role,
      counted,
      target,
      ...(latestPrediction ? { latestPrediction } : {}),
      completed: run.completedAt !== undefined,
      drifted: hasDrifted(games, run),
      awaitingRank: isAwaitingRank(games, run),
      countedMatchIds,
    };
  });
}

/**
 * Compute the live rank for every anchored (account, role).
 *
 * Suppressed exactly as the dashboard suppresses (see `core/dashboardData`): a
 * match inside an open placement run has no settled rank to move yet. Without
 * this the two disagree — `getRanks()` would report a rank built from matches
 * the Overview KPI is deliberately holding back, and since this also backs the
 * Log-match rank seeding, Settings → Accounts and the MCP `vantage_ranks` tool,
 * the app would contradict itself in three places at once.
 */
function rankSummaries(deps: DataProviderDeps): RankSummary[] {
  const games = deps.history.all();
  const map = deps.rankAnchors.map();
  const suppressed = suppressedMatchIds(games, deps.placements.allRuns());
  return deps.rankAnchors.all().map((a) => {
    const s = currentRank(games, map, a.account, a.role, undefined, suppressed);
    return {
      account: a.account,
      role: a.role,
      tier: s?.tier ?? a.tier,
      division: s?.division ?? a.division,
      progressPct: s?.progressPct ?? a.progressPct,
      protected: s?.protected ?? false,
    };
  });
}

/**
 * The season the player is currently in, from the EFFECTIVE table, so a reset
 * the user flagged themselves counts exactly like a shipped one. `undefined`
 * when the table has no season that has started yet.
 */
function currentSeason(masterData: MasterData): { start: number; label: string; isReset?: boolean } | undefined {
  const now = Date.now();
  const seasons = [...masterData.seasons].sort((a, b) => a.start - b.start);
  let current: { start: number; label: string; isReset?: boolean } | undefined;
  for (const s of seasons) {
    if (s.start <= now) current = s;
    else break;
  }
  return current;
}

/**
 * Build the offer, working out what accepting it would CLAIM.
 *
 * Both rules backdate from the current season start, never from the track's
 * whole history. An unbounded backdate would let a returning player's offer
 * reach months-old matches: the run's `startedAt` would land in a previous
 * season, `suppressedMatchIds` would mask that old ±% out of every rank
 * surface, and `completePlacementRun` would re-anchor at the newest match in
 * the window — silently rewriting historical rank. The season boundary keeps a
 * run inside the season that raised it, by construction.
 *
 * Past a full run's worth of claimable matches there is no honest backdate —
 * a run is ten matches, and starting eleven-plus matches back would count only
 * the first ten and quietly exclude the very match that raised the offer. Those
 * offers start NOW instead, with `backdatedCount: 0` so the prompt can say so
 * rather than leaving the difference invisible.
 */
function offerFrom(
  games: GameRecord[],
  input: PlacementTrackInput,
  season: { start: number; label: string },
  reason: PlacementOffer['reason'],
): PlacementOffer {
  const claimed = trackMatches(games, input.account, input.role, season.start);
  const backdates = claimed.length > 0 && claimed.length <= PLACEMENT_RUN_LENGTH;
  return {
    account: input.account,
    role: input.role,
    seasonStart: season.start,
    seasonLabel: season.label,
    reason,
    backdatedCount: backdates ? claimed.length : 0,
    ...(backdates ? { fromMatchId: claimed[0].matchId } : {}),
  };
}
