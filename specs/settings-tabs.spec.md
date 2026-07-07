# Settings View Tabs

## Intent (WHAT & WHY)

The Settings view (`renderer/src/views/settings.ts`, 584 lines) has grown too long: it stacks Accounts, Master Data editors (Heroes/Maps/Seasons), Coaching, App Behavior, Appearance, Data Location, and Diagnostics as one long scroll in a single file. This makes the view hard to navigate for users and hard to maintain for developers. Splitting it into tabs shortens the on-screen view and gives each concern (general settings vs. master-data editing) its own focused space, without adding new top-level sidebar navigation.

## In-Scope / Out-of-Scope

**In-scope:**
- Add tabbed navigation within the Settings view, using the existing `segmented()` control pattern (as used in `matchDetail.ts`).
- Two tabs: **General** (Accounts, Coaching, App Behavior, Appearance, Data Location, Diagnostics — same content/order as today, just under one tab) and **Master Data** (Heroes, Maps, Seasons editors).
- Extract each tab's content into its own file/module under a new `renderer/src/views/settings/` folder, with a slimmed-down `settings.ts` (or `settings/index.ts`) that renders the tab control and delegates to the active tab's module.
- Tab state is local/ephemeral — always opens on the General tab; not persisted in the store or across navigation.
- No changes to the Settings entry in the sidebar/shell routing (`ViewId`, `VIEWS` map) — Settings remains one top-level view.

**Out-of-scope:**
- No behavior changes to any individual settings control (accounts editing, hero/map/season CRUD, coaching, appearance, diagnostics, etc.) — this is a structural/navigation refactor only.
- No further sub-tabbing within Master Data (Heroes/Maps/Seasons stay as stacked sections within the Master Data tab, as they are today).
- No new top-level sidebar views.
- No persistence of the selected tab across app restarts or navigation.

## Constraints

- Must reuse the existing `segmented()` primitive (`renderer/src/components/primitives/controls.ts`) for the tab control, consistent with `matchDetail.ts`.
- `core/` purity and CSP-friendly renderer bundling guardrails apply as always (no new Electron/Notion imports in view code, no inline scripts).
- Follow existing file/module conventions: camelCase `.ts` filenames, composition via `h()`, small focused files.
- No new `ViewId` or shell routing changes.

## Acceptance Criteria

1. **Given** the user opens the Settings view, **when** it renders, **then** they see a segmented tab control with "General" and "Master Data" options, defaulting to "General" selected.
2. **Given** the user is on the General tab, **when** they view it, **then** they see Accounts, Coaching, App Behavior, Appearance, Data Location, and Diagnostics sections — identical content and behavior to the current Settings view, minus the Master Data section.
3. **Given** the user clicks "Master Data", **when** the tab switches, **then** they see the Heroes, Maps, and Seasons editor sections — identical content and behavior (CRUD, active-map toggle, season update/diff-accept flow) to the current implementation.
4. **Given** the user switches tabs, **when** they interact with a control on one tab (e.g. edits a hero), **then** switching tabs and back does not lose in-progress edits improperly, matching current behavior (no new state bugs introduced by the refactor).
5. **Given** the user navigates away from Settings (to another sidebar view) and back, **when** Settings re-renders, **then** it always opens on the General tab (no tab-state persistence).
6. **Given** the refactor, **when** `npm run typecheck` and `npm test` are run, **then** both pass with no regressions, and any existing tests referencing `settings.ts` internals are updated to match the new file layout.
7. **Given** the new file layout, **when** inspecting `renderer/src/views/settings/`, **then** no single file in the Settings view exceeds roughly 200 lines (each tab's content and the shell/index file are separately small and focused).

## Resolved questions

- **Tab grouping:** 2 tabs — General (everything except master data) and Master Data (Heroes/Maps/Seasons).
- **Implementation shape:** Extract each tab into its own file under a new `settings/` folder; `settings.ts` becomes a thin composer of the tab control + active module.
- **Tab persistence:** Always resets to the General tab; no store persistence.

## Open Questions

- None currently — flag here via `/revise` if new ambiguities surface during `/techplan`.
