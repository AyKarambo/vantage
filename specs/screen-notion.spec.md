# Screen spec: Notion sync (`notion`)

**Source:** `renderer/src/views/notion.ts`, `renderer/src/views/notion/syncCard.ts`, `src/notion/notionAdmin.ts`, `src/notion/notionWriter.ts`, `src/notion/gametrackerSchema.ts`, `src/main/notionRuntime.ts`.

**Shared context:** Status is fetched async from the bridge; the cards (state · setup · database · sync) re-render whenever it changes. Not affected by the global filter bar.

## Intent

The app's only outbound data path: connect the user's own Notion internal-integration token and push tracked games to their Notion database — deduped, so re-syncing never doubles up. Embodies guardrail #5: local-first, export is explicit and opt-in, with the user's own token.

## Layout & behaviour

- **Status card:** "Connected to Notion" with the database title (when known) and ready-to-sync count, or "Not connected" with the precise reason (no token · token saved but no database selected · using the `appsettings.json` fallback · not ready). A distinct **"Database shape mismatch"** state when connected but the configured database's properties don't match the Gametracker schema, listing the missing/mismatched property names. A **Schema** section notes any columns Vantage auto-added this cycle, or a provisioning error.
- **Setup card:** 3-step instructions (create internal integration → connect it to the Notion page → paste token) · password-type token input · client-side format validation (`^(ntn_|secret_)`, length ≥ 20) · save (token encrypted on this machine) · Disconnect (clears the token; shown only when set).
- **Database card** ("Choose database" / "Create one for me"), between Setup and Sync, hidden until a token is saved:
  - **Choose database** lists the databases the integration can access, each with title, a Notion URL when known, and a Select button; the currently-selected database shows a highlighted "Selected" state.
  - **Create one for me** lists the parent pages the integration can access, each with a "Create here" button. Creating auto-builds a **Maps** database (one page per known map) under the chosen parent, then a correctly-shaped **Gametracker** database with a `Map` relation to it (a "~15s" progress note while in flight).
  - An empty result in either list renders as guidance ("Share a page with your integration in Notion, then retry…"), never as an error; a search/list failure renders the raw error inline.
- **Sync now card:** the button is enabled only when connected **and** there are unsynced games, labelled with the **unsynced (needs-sync) competitive game count** (`NotionStatus.unsyncedGames`) — not the total history. Result chips report N synced / N skipped / N failed; every state has a contextual note. A shape mismatch short-circuits the sync with an inline error instead of failing every row.
  - **Live progress:** while an export runs, the card counts up "Syncing `n` / `total`…" from per-game `onSyncProgress` pushes.
  - **Last synced:** a persistent "Last synced `<relative time>`" line whenever `NotionStatus.lastSyncedAt` is set (stamped after each successful run, persisted in `config.local.json`, survives restarts).
- **Clean up duplicates** action (visible when connected, behind a confirm) removes duplicate Gametracker rows that already exist in Notion — see `notion-sync-dedup.spec.md`.

## Out-of-Scope

- Scheduled/automatic sync (sync is a manual, explicit action).
- Syncing anything other than tracked games (rosters, per-hero splits, and review timestamps stay local-only).

## Constraints

- Malformed tokens are rejected client-side before any bridge call; the saved token is stored encrypted locally (never in source — guardrail #2).
- **Dedupe:** the exporter never blind-creates — it resolves existing rows in the configured database first (by `Match ID` text or the id embedded in `manual-notion-*` ids) and adopts them; already-synced matches are skipped. Mechanism in `notion-sync-dedup.spec.md`.
- **Update-on-sync:** a re-sync updates the *existing* page in place when a match's review grade or mental flags changed since the last export (content-signature ledger); a deleted/archived page is recreated and noted. See `sqlite-storage-notion-sync.spec.md`.
- **Unset subjective selects write "none".** For a match with no Comms tone or no Improvement Target grade, the writer echoes the database's own discovered `none`/`None`/`N/A` select option back into that cell (on create **and** update) instead of leaving it blank; a row already synced blank is picked up on its next real update, not retroactively rewritten.
- **Database selection persists** to `config.local.json` (deep-merged under the `notion` key); a hand-edited `appsettings.json` database id remains the fallback. `NotionStatus.databaseSource` reports `'selected'` / `'appsettings'` / `'none'`.
- **Schema self-heals additively.** On validation (token set, database selected, app launch), Vantage creates any Vantage-owned column the database is missing via one additive `dataSources.update`, re-validates once so it's written in the same session, and surfaces the result — wrong-type / near-miss columns are surfaced, never clobbered; a token without schema-edit permission surfaces the error and the sync still runs for the columns that exist. Mechanism in `notion-column-provisioning.spec.md`.
- A configured **Maps** database is optional: when absent, exports degrade to Gametracker rows without a `Map` relation rather than failing every game.
