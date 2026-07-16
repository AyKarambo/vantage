# Spec: Editable result (and game facts) on auto-tracked matches

**Slug:** `editable-match-result`
**Status:** Approved
**Surface:** `renderer/src/views/matchDetail.ts` (Edit match modal), `src/main/dataProvider.ts` (`editMatch`), `src/core/matchDetail.ts` + `src/shared/contract/matchDetail.ts` + `src/core/analytics/types.ts` (provenance marker), `src/store/history.ts` (`editManual` patch type).

## Intent (WHAT & WHY)

Today the **Edit match** modal lets the user edit Win/Loss/Draw (and map, role, heroes) only on **hand-logged** matches. On **auto-tracked (GEP)** matches those game facts are locked, showing *"Auto-tracked from the game feed — result, map and heroes are locked."*

The game feed occasionally gets a fact wrong — most visibly the **result** (a leaver/disconnect scored as a loss, a draw misread, etc.). When it does, the user has no way to correct it, which silently poisons every downstream stat (win rate, streaks, priority maps, SR math). The benefit: let the user **correct the record** on auto-tracked matches, while staying honest that a game fact was hand-corrected.

The triggering ask was "make win/loss/draw editable"; per the decision below, the scope is broadened to **all game facts** (result, map, role, heroes) on auto-tracked matches — i.e. the editor treats a GEP match's facts the same as a manual match's, plus an "edited" marker that preserves provenance honesty.

## In-Scope

- Auto-tracked (GEP) matches show the **same editable facts block** as manual matches in the Edit match modal: Result (W/L/D chooser + W/L/D keys), Map (strict combobox + save guard), Role, Heroes.
- The backend `editMatch` **persists** result/role/map/heroes for auto-tracked matches (currently gated to manual only).
- A **subtle "edited" marker** is recorded and shown when an auto-tracked match's game facts are hand-corrected — the match keeps its **⚡ auto** provenance (`source` stays `gep`); the original game-reported value is **not** preserved.
- Competitive SR suggestion **re-computes on a result change** for auto-tracked matches, mirroring the log card / manual editor.
- The Edit-match button tooltip and the editor's locked-hint copy are updated to reflect that facts are now editable on auto-tracked matches.

## Out-of-Scope

- **Reverting** to the original game-reported result/facts (original value is not stored — decision below).
- Altering or hiding the GEP **round score / scoreboard** when it contradicts an overridden result (they stay as raw feed telemetry — decision below).
- Showing the "edited" marker on the **Matches list rows** (detail + editor only for v1; a list-row marker can follow).
- The **pending / "needs result"** flow (`resolvePendingMatch`) — separate surface, unchanged.
- Notion export changes (export maps `result` directly, so a corrected result re-syncs on its existing signature; the internal marker is not exported), bulk edit, editing across accounts.

## Constraints

- **Guardrail 1 (account safety) intact.** Live data still comes solely from GEP. A hand-correction is a manual overlay edit, not a memory read; nothing new is read from the game.
- **Provenance preserved.** Editing facts must **not** flip a match's `source` from `gep` to `manual`; the ⚡ auto indicator stays. Honesty is carried by the separate "edited" marker.
- **No original preserved.** The store keeps a single `result`/`map`/… value; the marker means "has been hand-edited at least once," not "currently differs." Once set it stays (an edit back to the original value cannot be detected, so the marker does not clear).
- **Marker only on real change.** Merely opening and saving (or a manual-layer-only edit) must not set the "edited" marker — it is set only when a game fact actually differs from its stored value.
- **No schema migration.** The full `GameRecord` persists as a JSON blob in the store's `data` column, so the new marker field rides along automatically; no new SQLite column is required.
- **Typed IPC end-to-end.** The marker threads through `shared/contract` (no `any` across the boundary).
- **`core/` stays pure.** The `matchDetail` builder and `GameRecord` type stay Electron-free; the change-detection in `editMatch` (main) is unit-tested through the provider.
- **Renderer stays CSP-friendly** and composes existing components (`resultChooser`, `mapPicker`, `field`, `pill`, …).

## Acceptance Criteria

**Editable facts on auto-tracked matches**
1. **Given** an auto-tracked (GEP) match open in the Edit match modal, **When** it renders, **Then** the Result / Map / Role / Heroes controls appear and are editable (identical to a manual match), and the "Auto-tracked … are locked" hint is no longer shown.
2. **Given** an auto-tracked match, **When** the user changes the result and saves, **Then** the new result is persisted and reflected in the detail header and all dependent views on refresh.
3. **Given** an auto-tracked match, **When** the user changes map, role, or heroes and saves, **Then** those changes are persisted (previously ignored by the backend).
4. **Given** the editor is focused on an auto-tracked match, **When** the user presses W/L/D, **Then** the result chooser updates (same keybinding as manual matches).
5. **Given** an auto-tracked match, **When** the map text does not resolve to a known map, **Then** Save is disabled / shows the same "isn't a known map" error as manual matches (strict-map guard applies).

**Provenance marker (edited, no revert)**
6. **Given** an auto-tracked match whose facts have never been hand-edited, **When** viewed, **Then** no "edited" marker is shown and it reads ⚡ auto as before.
7. **Given** an auto-tracked match, **When** a save changes at least one game fact (result/map/role/heroes) from its stored value, **Then** the app records a facts-edited marker (a timestamp; original **not** kept) **and** the match keeps `source = gep` (⚡ auto).
8. **Given** a fact-edited auto-tracked match, **When** viewed in the detail header and in the editor's provenance line, **Then** a subtle "edited" marker appears alongside ⚡ auto.
9. **Given** an auto-tracked match, **When** the user saves without changing any game fact (only manual-layer fields, or no change at all), **Then** the facts-edited marker is **not** added.
10. **Given** a manual (◎) match, **When** its facts are edited, **Then** no facts-edited marker is added (it is manual by nature).
11. **Given** any match, **Then** there is **no** "revert to game-reported value" control anywhere.

**SR & feed data**
12. **Given** a competitive auto-tracked match where the user has not manually set the SR change, **When** the result changes, **Then** the suggested SR change re-computes for the new result (Win/Loss ±suggested, Draw clears) — same as the log card.
13. **Given** an auto-tracked match with a GEP round score / scoreboard, **When** the user overrides the result to one the score contradicts, **Then** the round-score box and scoreboard remain shown, unchanged.

**Definition of Done**
14. `npm test` and `npm run typecheck` (main + renderer) pass; the new `editMatch` behavior (facts applied on GEP matches; marker set only on real fact change; never on manual matches) ships with unit tests; README/docs updated if user-visible commands change (none expected).

## Resolved questions

- **Which facts become editable on GEP matches?** → **All game facts** (result + map + role + heroes), i.e. the editor treats a GEP match's facts like a manual match's.
- **How is an overridden result/fact recorded?** → **Mark as edited, no revert.** A subtle "edited" marker for honesty; the original GEP value is not preserved.
- **What about the GEP round score / scoreboard that may now contradict?** → **Leave as-is.** They stay as raw feed telemetry; only the result is the user's correction.

## Open Questions

- **Marker copy (finalized during implementation):** a small `edited` pill next to ⚡ auto with the tooltip *"Game facts hand-corrected — this match was auto-tracked from the game feed."*
- **Matches-list marker:** deferred to a follow-up (detail + editor only for v1).
