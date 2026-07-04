# Screen spec: Matches (`matches`)

**Source:** `renderer/src/views/matches.ts` · reverse-engineered 2026-07-04 · detail-page design from user screenshot (2026-07-04 spec review)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the list.

## Intent (WHAT & WHY)

[confirmed] The match history log **with click-through to a full match detail page**. The current file's own comment admits it is "my interpretation of the Matches screen"; the confirmed intent is that each row opens a dedicated detail view — the read-only list that exists today is a known gap, not the target state.

## In-Scope

**Current list (built):**
- Newest-first list of matches in the filtered range: result letter (W/L/D, colour-coded), map, role · heroes (or "—") · account, map-type pill, game type, relative time.
- Match count in the header; empty state for an empty range.

**Match detail page (planned — layout from design screenshot):**
- **Header:** result badge (e.g. VICTORY), series score, map name, mode (e.g. ESCORT), round score, portraits of the heroes the player used, match duration.
- **Scoreboard:** both teams separated by a VS divider; per row: role icon, hero portrait, player name, perks, E / A / D, DMG / HEAL / MIT; per-column best values highlighted; the tracked player's row(s) tinted.
- **Per-hero tabs:** one tab per hero the player used; each shows the core line (kills, assists, deaths, damage, healing, mitigation) plus hero-specific stats (e.g. weapon/critical accuracy, final blows, ability-specific stats).
- **Progress bar:** competitive progress section for the match. [confirmed in scope]
- **Player History:** players from this match the user has encountered before, with prior match counts. [confirmed in scope — implies a cross-match player index]
- **Screenshots gallery:** end-of-match screenshots attached to the match. [confirmed in scope — implies an auto-capture feature at game end]

## Out-of-Scope

- [confirmed] **Share URL** — publishing matches to a shareable web link is out of scope. It would add a second outbound data path beyond Notion export, violating guardrail #5 (local-first; Notion is the only outbound path).
- Pagination, search, and column sorting on the list (not present, not requested).

## Constraints

- **Guardrail #1 (account safety):** all detail-page data must come solely from Overwolf GEP (or manual logging). Fields the GEP does not expose are optional/best-effort — never sourced by memory reading or injection. The scoreboard may only show information visible on the in-game end-of-match screen (no hidden info).
- Player History and the Screenshots gallery depend on features that do not exist yet (player encounter index; end-of-match capture); the detail page spec does not require them for a first version, but the layout reserves their sections.
- All stored data stays local-first per guardrail #5.

## Acceptance Criteria

**Current behavior (built):**
- Given matches in the filtered range, when Matches renders, then each row shows result, map, role, heroes (or "—"), account, map type, game type, and relative time, newest first.
- Given no matches in range, then "No matches in this range yet." is shown.

**Planned (not yet built — the click-through gap):**
- Given a click on a match row, then the full match detail page for that game opens.
- Given the detail page for a game with scoreboard data, then both teams render with per-player role, hero, perks, E/A/D, DMG/HEAL/MIT, best-per-column highlighting, and the tracked player's row tinted.
- Given the player used multiple heroes, then one tab per hero renders with that hero's core line and hero-specific stats.
- Given prior encounters with players from this match, then Player History lists them with prior match counts.
- Given screenshots captured for this match, then the gallery shows them; given none, the section is empty/collapsed.
- Given any detail page, then no Share/publish affordance is present.

## Known gaps (intent ≠ code)

- [confirmed] Rows are not clickable and no detail page exists — the entire "planned" section above is the gap. This is the largest new-feature item in the screen specs.

## Open Questions

None — resolved 2026-07-04: destination = full detail page per the design screenshot; Player History, Screenshots gallery, and progress bar in scope; Share URL out of scope.
