# Screen spec: Settings (`settings`)

**Source:** `renderer/src/views/settings/**` (`index.ts`, `general.ts`, `accounts.ts`, `appBehavior.ts`, `diagnostics.ts`, `dataLocation.ts`, `importCard.ts`, `masterData/**`), `renderer/src/components/breakReminderEditor.ts`, `readinessSettingsEditor.ts`, `stalenessEditor.ts`, `sessionSettingsEditor.ts`, `logLevelToggle.ts`, `src/core/rankDisplay.ts` (`rankParts`).

**Shared context:** Sidebar entry under the **App** group. The break-reminder / readiness / session state reads from a `DashboardData` snapshot via `ViewContext`; the accounts, app-behavior, data-location, and master-data cards fetch async from the bridge. Not affected by the global filter bar.

## Intent

The canonical home for everything that configures the app: account management, coaching nudges, window behavior, appearance, diagnostics, data storage, and the Overwatch master-data (heroes/maps/seasons) editor — one sidebar place instead of settings scattered across screens.

## Structure

Two tabs so neither is a single long scroll: **General** and **Master Data**. Re-entering Settings always starts on General.

## General tab

- **Accounts card** — create / edit / delete the accounts you log matches against (a `battleTag → label` mapping). It is a **list**, not a control panel: one aligned grid row per account (name + sub-line · games · a compact per-role rank summary · actions), with a header row; everything rank- and placement-related lives behind the row's **Manage ranks…** button. It lists **every account it knows about**, each with a game count:
  - **Configured** accounts (sub-line: the BattleTag): **Edit** (rename the BattleTag / display name, inline, spanning the row) and **Delete** (non-destructive — drops the label mapping, leaves the matches).
  - **Detected but unlabelled** raw-tag accounts (sub-line: *detected, unlabelled*): **Label** (assign a display name; the BattleTag is fixed, and the account's history rows adopt the label) and **Delete…**.
  - The **Unknown** bucket (sub-line: *no captured BattleTag*): **Delete…** only (there is no tag to label against).
  - The game count is its own right-aligned column, not part of any sub-line.
  - **Delete…** on a detected/Unknown account is **irreversible, behind a confirm** — it permanently removes that account's matches *and* its rank anchors, and afterward reconciles the dashboard's account filter back to "All accounts" if it pointed at the deleted one.
  - The per-role **summary chips** come from `accountRoleSummary` (`renderer/src/roleStatus.ts`), a deliberately terser sibling of `roleStatus` over the same `rankParts`: short role tags (`Tank`/`Dmg`/`Sup`/`OQ`) and short tier codes (`shortRankLabelOf` in `src/core/rankDisplay.ts` — `B S G P E D M GM C` glued to the division) so a row never wraps — `Dmg · GM4 · 16%` (🛡 when protected), `Sup · Placements 3/10`, or `Tank · Placements 10/10 · confirm rank`. A run's predicted rank is dropped here; the full text is one click away in the modal. Only roles the account actually tracks appear.
  - **Manage ranks…** opens the **Ranks & placements** modal for that account: all four roles as aligned rows (role · status pill · that state's actions — start placements now or from an earlier match, change the start match, reset to begin / cancel the run behind the two-click confirm, finish early / confirm the revealed rank, recount a drifted run), plus **Set rank…** to set/replace a role's one-time anchor (set once; logged competitive matches move it from there; editing re-anchors from the entered value; a negative % is a rank-protection buffer). The modal re-reads ranks + placements and repaints after every write, and reloads the card + dashboard snapshot so the sidebar chip and Overview KPI follow. Overlays never stack: a sub-dialog (Set rank, the match picker, the reveal-rank confirmation) closes the modal first and reopens it when done — on Save, Cancel, Escape or a backdrop click alike.
  - **App-wide:** when a competitive match logs on a *different configured account* than the one currently selected, the app auto-switches the account filter to it.
- **Quick Log card** — how many "most-played" heroes the Log Match hero picker shortlists before falling back to search (3–15).
- **Coaching card** — the shared editors: the break-reminder editor (on/off + threshold, mechanism owned by `screen-mental.spec.md`), the readiness settings editor (enable + launch-toast, owned by the readiness specs), the target-rotation staleness editor (the thresholds `screen-targets.spec.md`'s rotate nudge uses), and the current-session settings editor.
- **App behavior card** (loaded async via `getAppSettings`, persisted in main-process config as `AppUiSettings`): **Close-to-tray** (✕ keeps Vantage in the tray vs quits), **Run at login** (starts hidden in the tray at Windows login), and **Demo data** (preload a sample season; no visible effect once real history exists). Toggles apply instantly and flip in place (no toast).
- **Appearance card** — a **Winrate colours** segmented control (default teal–rose vs a colorblind-safe blue–orange palette). The choice swaps the win/loss/draw encoding across every chart and screen without a restart, persisted as a renderer pref and applied at bundle load.
- **Diagnostics card** — the log-level toggle (`info`/`debug`, session-scoped), **Open log viewer** → the Logs screen (`screen-logs.spec.md`), and **About Vantage →** the About screen (version/build/support live there).
- **Data storage card** — where *all* Vantage data files live (`history.db`, `manual.json`, `outbox.json`, `rankAnchors.json`, plus a legacy `history.json` backup when present). **Change…** migrates everything with a copy-verify-then-delete guarantee (originals removed only after the switch commits); a target folder that already holds Vantage data is offered as **adopt-or-cancel**, never overwritten. Details in `sqlite-storage-notion-sync.spec.md`.
- **Import card** — bring match history in from a Vantage import JSON (e.g. the Obsidian→Vantage script); imported matches are marked so "Remove imported matches" clears exactly that set.

## Master Data tab

The Overwatch master-data editor — add / edit / remove heroes (name + role), maps (name + game mode + competitive-pool `isActive`), and seasons (start + label), plus the single **Update** action that fetches the latest heroes & maps and previews additions/changes for per-item accept. Full behavior in `editable-master-data.spec.md`.

## Out-of-Scope

- Notion token / database management (own screen — `screen-notion.spec.md`).
- App version / build facts / support contact (the About screen — `about-page.spec.md`).
- Editing window bounds — size/position/maximized state persist automatically in the main process and never cross the bridge.

## Constraints

- App-behavior and data-location settings live in main-process config (`config.local.json`), not renderer localStorage — they must apply before the renderer exists (window restore, tray-first launch). The winrate-colour choice is a renderer pref.
- Reversible settings apply immediately; only irreversible actions (account data deletion) sit behind a confirm modal.
- The debug log-level toggle is session-scoped: it resets to `info` on app restart.
- Rank display everywhere composes the shared `rankParts` renderer so protection and progress read identically across surfaces.
