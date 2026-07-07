# Screen spec: Notion sync (`notion`)

**Source:** `renderer/src/views/notion.ts`, `renderer/src/views/notion/syncCard.ts`, `src/notion/notionAdmin.ts`, `src/notion/gametrackerSchema.ts`, `src/main/notionRuntime.ts` · reverse-engineered 2026-07-04 · updated 2026-07-04 after gap implementation · updated 2026-07-04 after the ui-qol batch (PR #8)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review) · [implemented 2026-07-04] shipped in the gap-closing pass · [qol 2026-07-04] shipped in the ui-qol batch (intent: `ui-qol.spec.md`)

**Shared context:** Status is fetched async from the bridge; the three cards (state · setup · sync) re-render whenever it changes. Not affected by the global filter bar.

## Intent (WHAT & WHY)

[explicit] The app's only outbound data path: connect the user's own Notion internal-integration token and push tracked games to their Notion database — deduped, so re-syncing never doubles up. Embodies guardrail #5: local-first, export is explicit and opt-in, with the user's own token.

## In-Scope

- **Status** card: "Connected to Notion" with the database title (when known) and ready-to-sync count, or "Not connected" with the precise reason (no token yet · token saved but no database selected · using the `appsettings.json` fallback · not ready). [implemented 2026-07-04] A distinct **"Database shape mismatch"** state when connected but the configured database's properties don't match the Gametracker schema, listing the missing/mismatched property names.
- **Setup** card: 3-step instructions (create internal integration → connect it to the Notion page → paste token) · password-type token input · client-side format validation (`^(ntn_|secret_)`, length ≥ 20) · save (token encrypted on this machine) · Disconnect (clears token; shown only when a token is set).
- [implemented 2026-07-04] **Database** card ("Choose database" / "Create one for me" toggle), rendered between Setup and Sync and hidden until a token is saved:
  - **Choose database** lists the databases the integration can access (a paginated Notion search), each row with its title, a Notion URL when known, and a Select button; the currently-selected database (by title match against the live status) shows a highlighted "Selected" state instead of a clickable button.
  - **Create one for me** lists the parent pages the integration can access, each with a "Create here" button. Creating auto-builds a **Maps** database (one page per known map) under the chosen parent, then a correctly-shaped **Gametracker** database with a `Map` relation pointing at it — shown with a "Creating database — this takes ~15s…" progress note while in flight.
  - An empty result in either list (nothing shared with the integration yet) renders as guidance — "Share a page with your integration in Notion, then retry — ••• → Connections → add your integration." — never as an error.
  - A search/list failure renders the raw error inline instead of guidance.
- **Sync now** card: button enabled only when connected **and** tracked games > 0, labeled with the count; result chips (N synced / N skipped / N failed); contextual note for every state (checking · not connected · nothing to sync · ready). [implemented 2026-07-04] A shape-mismatch short-circuits the sync with an inline error instead of attempting (and failing) every row.
  - [qol 2026-07-04] **Live progress:** while an export runs, the card shows "Syncing `n` / `total`…" fed by per-game `onSyncProgress` pushes from the main process (channel `push:sync-progress`); the subscription is released when the run ends.
  - [qol 2026-07-04] **Last synced:** a persistent "Last synced `<relative time>`" line renders whenever `NotionStatus.lastSyncedAt` is set — stamped after each successful sync run and persisted in `config.local.json` (under the `notion` key), so it survives restarts.

## Out-of-Scope

- Scheduled/automatic sync (sync is a manual, explicit action).
- Syncing anything other than tracked games.

## Constraints

- [explicit] Malformed tokens are rejected client-side before any bridge call; the input is cleared after a save attempt; the saved token is stored encrypted locally (never in source — guardrail #2).
- [explicit] Dedupe: matches already synced are skipped on re-sync.
- [explicit] Sync failures render an inline error; an "unavailable" result renders "Connect Notion first."
- [implemented 2026-07-04] **Database selection persists to `config.local.json`** (a deep merge under the `notion` key, so selecting a database or auto-creating one never clobbers a sibling field like an already-stored Maps database id). A hand-edited `appsettings.json` database id remains supported as the fallback when nothing has been explicitly selected. `NotionStatus.databaseSource` reports which applies: `'selected'` (chosen via this screen) · `'appsettings'` (fallback) · `'none'`.
- [implemented 2026-07-04] Selecting or creating a database triggers an async shape validation (`NotionAdmin.validate`) against the Gametracker schema; the result is cached and surfaces as `NotionStatus.shapeValid` / `shapeIssues`, and re-wires the exporter so a subsequent sync short-circuits on a mismatch rather than failing per-row.
- [implemented 2026-07-07 · `notion-column-provisioning`] **Schema auto-provisioning:** that same validation self-heals the schema — any Vantage-owned column the database is missing (the `planColumnProvision` diff over `PROVISIONABLE_PROPERTIES`: the create-from-scratch scalars plus the 5 subjective columns, never the `Name` title or the `Map` relation) is created in place via one additive `dataSources.update` (`NotionAdmin.ensureColumns`), then the database is **re-validated once** so the new columns flip into the writer's capabilities and are written in the same session. Additive only (existing user columns/data are never retyped or removed); wrong-type / near-miss columns are left untouched and surfaced (via `shapeIssues` / the subjective-columns section), never created over. Failure is non-fatal: a token without schema-edit permission surfaces `NotionStatus.schemaProvision.error` and the sync still runs for the columns that exist. The Schema section of the status card notes the created columns / the error.
- [confirmed] A configured **Maps** database is optional at the schema level: when absent, exports degrade to Gametracker rows without a `Map` relation rather than failing every game — the map link is a nice-to-have, not a hard requirement of a valid Gametracker shape.

## Acceptance Criteria (current behavior)

- Given a token that doesn't match `^(ntn_|secret_)` or is shorter than 20 chars, when Save is clicked, then a warning shows and nothing is sent to the bridge.
- Given a valid save, then the input clears, "✓ Token saved and encrypted on this machine." shows, and the status re-fetches.
- Given a token is saved, then the Database card appears with "Choose database" selected by default.
- Given "Choose database" and the integration can see one or more databases, then each renders with its title, optional URL, and a Select button; selecting one persists it, revalidates its shape, and refreshes the status card.
- Given "Choose database" and the integration can see none, then the guidance message renders (not an error).
- Given "Create one for me" and one or more parent pages are visible to the integration, then each renders with a "Create here" button; clicking it shows the ~15s progress note, then creates the Maps database (populated with all maps) and the Gametracker database (with a Map relation to it), selects the new Gametracker database, and refreshes the status card.
- Given the configured database's shape doesn't match the Gametracker schema, then the status card shows "Database shape mismatch" with the specific missing/mismatched property names, and a sync attempt short-circuits with an inline "Database is missing: …" error instead of running.
- [2026-07-07] Given a configured database missing one or more Vantage-owned columns, when validation runs (on connect / database select), then those columns are created in place, the database is re-validated, and the status card's Schema section lists what was added; a column that was a *required* miss no longer short-circuits the sync. Given a column present but wrong-typed or under a near-miss name, then it is not created over and stays surfaced. Given the token can't edit the schema, then the Schema section shows the error and the sync still runs for the columns that already exist.
- Given connected status with N > 0 tracked games, then the sync button reads "Sync N games to Notion" and is enabled; otherwise it is disabled with a contextual note.
- Given a sync run with a valid database shape, then already-synced matches are skipped and the result chips report synced/skipped/failed counts; given no Maps database configured, games still sync but without a Map relation.
- Given a sync run over multiple games, then the card's status line counts up "Syncing 1 / N…", "Syncing 2 / N…" while the export runs, replaced by the result chips when it finishes.
- Given at least one successful sync has ever completed, then the Sync card shows "Last synced `<X>` ago", including after an app restart.
- Given Disconnect, then the token is cleared and the status returns to "Not connected".

## Known gaps (intent ≠ code)

None identified — behavior matches intent. Both confirmed 2026-07-04 database-selection gaps (a picker UI, and an auto-create path) are implemented; hand-editing `appsettings.json` remains a supported fallback rather than the only option.

## Open Questions

None — resolved 2026-07-04 (picker + auto-create; config file is interim) and implemented 2026-07-04.
