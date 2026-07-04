# Feature spec: Live connection & data-flow status (`live-status`)

**Source:** UI/UX brainstorm + spec interview, 2026-07-04. Approved 2026-07-04.
**Related specs:** `ui-qol.spec.md` (Settings screen), `debug-log.spec.md` (transition logging).

## Intent (WHAT & WHY)

Overwolf apps can claim "connected" while silently receiving nothing — the user has been burned by
exactly this. Vantage must never conflate *attached* with *alive*: the UI shall show, truthfully
and at a glance, whether the game is running, whether the GEP feed is attached, and whether **data
is actually flowing right now** — including an explicit warning state when a match is in progress
but the feed has gone silent. Trust in the indicator is the product requirement; a wrong
"receiving" is worse than no indicator.

## In-Scope

- A four-state connection model, surfaced in the status bar (dot + label) and mirrored by the
  **tray icon**:
  1. **No game** — Overwatch 2 not running (or GEP package unavailable).
  2. **Connected** — game running, GEP attached, no live events recently (e.g. in menus / between
     matches). Explicitly labeled so it can't be read as "data flowing".
  3. **Live** — events received recently; the feed is demonstrably working.
  4. **Stale** (warning) — a match is in progress **and** no GEP event has arrived for ≥60s.
     Visually alarming (distinct color), because this is the silent-failure case.
- Click/hover details on the status indicator: current state, last event received (relative time),
  events this session, match-in-progress flag, GEP attach time.
- Tray icon reflects the same state (visual variant per state) with a matching tooltip.
- Demo mode: while no live feed exists (pre-approval / demo dataset), the indicator shows
  **No game / no live feed** semantics — it never shows "Connected" or "Live" for demo data.
- State transitions are pushed to the renderer (no polling lag) and recorded in the debug log (see
  `debug-log` spec).

## Out-of-Scope

- Auto-repair/reattach logic beyond what already exists — this spec is about *truthful signaling*,
  not recovery.
- Historical uptime/health analytics.
- The retroactive "match ended with no match-end event" audit (two-tier option was considered and
  not selected; may be revisited).

## Constraints

- Staleness derives **only** from sanctioned GEP signals (event arrival times, match start/end) —
  guardrail 1 (GEP-only) untouched.
- The staleness clock runs only while a match is known in-progress; menus/queue never produce
  "Stale".
- Any GEP event (info update or game event) resets the silence timer; **Stale → Live** recovery is
  immediate on the next event.
- State model is pure logic in `src/core/` (unit-testable, drives the preview harness);
  Electron/tray/GEP wiring stays at the edges; contract stays fully typed.
- Threshold (60s) is a named constant, not user-configurable in this iteration.
- Preview harness must be able to simulate all four states.

## Acceptance Criteria

- Given OW2 is not running, when the app is open, then the indicator shows **No game** and the tray
  matches.
- Given the game launches and GEP attaches but no events have arrived, then the state is
  **Connected** — and its label/tooltip explicitly does *not* claim data is flowing.
- Given a match is running and events arrive, then the state is **Live** within one event of flow
  starting.
- Given a match is in progress and 60s pass with zero GEP events, then the state flips to **Stale**
  with a warning treatment in status bar *and* tray, without user interaction.
- Given the state is Stale and one event arrives, then the state returns to **Live** immediately.
- Given the player returns to menus (match ended), then Stale/Live decays to **Connected** (no
  false warning between matches).
- Given demo data is active with no live feed, then the indicator never shows Connected or Live.
- Given I click the status indicator, then I see: state, last-event relative time, session event
  count, match-in-progress, attach time.
- Given any state transition, then a corresponding entry appears in the debug log.

## Resolved questions

1. **State granularity** — four states including Stale (not three).
2. **Tray mirroring** — yes, tray icon reflects state.
3. **Staleness threshold** — 60 seconds of mid-match silence (30s and two-tier match-end audit
   considered; not selected).
4. **Details surface** — click on the status indicator reveals last-event time and session
   counters.

## Open Questions

- Tray visual treatment: recolored icon vs. overlay badge — needs a quick asset check during
  implementation (Windows tray icons are 16×16; color dot overlay is the likely answer).
- Exact wording of the four labels (e.g. "Connected — waiting for events" vs "Attached, idle").
