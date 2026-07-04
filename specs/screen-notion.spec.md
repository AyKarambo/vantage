# Screen spec: Notion sync (`notion`)

**Source:** `renderer/src/views/notion.ts` · reverse-engineered 2026-07-04
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review)

**Shared context:** Status is fetched async from the bridge; the three cards (state · setup · sync) re-render whenever it changes. Not affected by the global filter bar.

## Intent (WHAT & WHY)

[explicit] The app's only outbound data path: connect the user's own Notion internal-integration token and push tracked games to their Notion database — deduped, so re-syncing never doubles up. Embodies guardrail #5: local-first, export is explicit and opt-in, with the user's own token.

## In-Scope

- **Status** card: "Connected to Notion" with ready-to-sync count, or "Not connected" with the precise reason (no token yet · token saved but no database configured · not ready).
- **Setup** card: 3-step instructions (create internal integration → connect it to the Notion page → paste token) · password-type token input · client-side format validation (`^(ntn_|secret_)`, length ≥ 20) · save (token encrypted on this machine) · Disconnect (clears token; shown only when a token is set).
- **Sync now** card: button enabled only when connected **and** tracked games > 0, labeled with the count; result chips (N synced / N skipped / N failed); contextual note for every state (checking · not connected · nothing to sync · ready).

## Out-of-Scope

- Scheduled/automatic sync (sync is a manual, explicit action).
- Syncing anything other than tracked games.

## Constraints

- [explicit] Malformed tokens are rejected client-side before any bridge call; the input is cleared after a save attempt; the saved token is stored encrypted locally (never in source — guardrail #2).
- [explicit] Dedupe: matches already synced are skipped on re-sync.
- [explicit] Sync failures render an inline error; an "unavailable" result renders "Connect Notion first."
- Today the target database id is read from `appsettings.json` (see Known gaps for intended end state).

## Acceptance Criteria (current behavior)

- Given a token that doesn't match `^(ntn_|secret_)` or is shorter than 20 chars, when Save is clicked, then a warning shows and nothing is sent to the bridge.
- Given a valid save, then the input clears, "✓ Token saved and encrypted on this machine." shows, and the status re-fetches.
- Given connected status with N > 0 tracked games, then the sync button reads "Sync N games to Notion" and is enabled; otherwise it is disabled with a contextual note.
- Given a sync run, then already-synced matches are skipped and the result chips report synced/skipped/failed counts.
- Given Disconnect, then the token is cleared and the status returns to "Not connected".

## Known gaps (intent ≠ code)

- [confirmed] **Database selection needs a UI.** Editing `appsettings.json` by hand is a stopgap. Intended end state (both):
  1. a **picker** that lists the databases the integration can access and lets the user choose, and
  2. an **auto-create** option where the app creates a correctly-shaped database in Notion itself — no manual id at all.

## Open Questions

None — resolved 2026-07-04 (picker + auto-create; config file is interim).
