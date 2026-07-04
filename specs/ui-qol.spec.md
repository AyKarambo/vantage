# Feature spec: UI quality-of-life batch (`ui-qol`)

**Source:** UI/UX brainstorm + spec interview, 2026-07-04. Approved 2026-07-04.
**Related specs:** `live-status.spec.md`, `debug-log.spec.md` (separate features, same review round).

## Intent (WHAT & WHY)

Vantage's data model and screens are solid, but day-to-day interaction has friction: the titlebar
promises search that doesn't exist, the quick-log modal forgets the player's role every time, saves
give no feedback, refreshes flicker, and everything is mouse-only. This spec batches ~27
quality-of-life improvements so the app *feels* like a polished daily companion between matches —
faster to drive, honest in its feedback, and comfortable as a long-running desktop app.

## In-Scope

Items are tiered: **P1** must land, **P2** should land, **P3** nice-to-have — a P3 (or P2 under
pressure) can be cut without spec revision; cutting a P1 requires `/revise`.

### P1 — must land

| # | Item | Summary |
|---|------|---------|
| 1 | Command palette | Ctrl+K (and the titlebar button) opens a real palette: fuzzy-match **screens** (jump), **actions** (log match, sync Notion, toggle break reminder, open log viewer), and **data** (map → Maps view scrolled/highlighted, hero → hero drawer, recent match → match detail). |
| 2 | Quick-log memory | Log-match modal prefills **role, mode, account** from the last logged match; result/map/hero start fresh; mental flags default **empty** (removes the pre-checked "Positive comms" bias). |
| 3 | Hero typeahead | Hero field autocompletes against the known hero list; free text still allowed. |
| 4 | Restore last view | Active view persists like filters do; app reopens on the last top-level view (never on `matchDetail`). |
| 5 | Focus & motion | Visible `:focus-visible` rings on all interactive elements; `prefers-reduced-motion` disables transitions/animations. |
| 6 | Live status text | Status-bar "updated Xm ago" re-renders at least every 60s. |
| 7 | Toasts + undo | Toast component confirms saves. Reversible actions (archive target, save review, settings change) execute immediately with an **Undo** action (≥5s). Permanent target delete keeps its confirmation modal. |
| 8 | Flicker-free refresh | Refetches (incl. window-focus) keep the current snapshot rendered with a subtle busy indicator; skeleton cards only on cold start. |
| 9 | Error recovery | Failed dashboard load shows an inline error card with **Retry**; failed *background* refresh keeps stale data visible with a "stale" marker. |
| 10 | Settings screen | New sidebar entry consolidating: break reminder (canonical home; Mental keeps its inline editor, same config), close-to-tray (#22), colorblind toggle (#26), plus the log-level toggle and viewer access from the `debug-log` spec. |

### P2 — should land

| # | Item | Summary |
|---|------|---------|
| 11 | Actionable empty states | Empty states offer next steps, e.g. Matches empty-in-range with games outside range → "Show all time" button. |
| 12 | View hotkeys | Ctrl+1…9 = sidebar order; `?` = shortcut cheatsheet overlay; Esc in match detail = back to Matches. |
| 13 | Prev/next match | Match detail gets chevrons + arrow keys stepping through the filtered match list. |
| 14 | Cross-links | Hero name in a match row → hero drawer; map name → Maps view entry. |
| 15 | Filter reset chip | When filters ≠ defaults, the filter bar shows an active-count "Reset" chip. |
| 16 | Matches day grouping | Rows grouped under day headers ("Today", "Yesterday", date) with per-day W–L tally. |
| 17 | Heroes table QoL | Sort choice persists across renders/sessions; sticky header; "min. games" toggle hiding <N-game rows. |
| 18 | Review keyboard grading | H/P/M keys grade the focused target; auto-advance to next ungraded game. |
| 19 | Chart tooltips | Line chart, bars, donut, and heatmap get the hover tooltip the scatter already has. |
| 20 | Notion sync feedback | Sync shows progress (n of total) and a persistent "last synced" timestamp. |
| 21 | Window memory | Size/position/maximized state persist across launches. |
| 22 | Close-to-tray | Setting choosing whether ✕ quits or minimizes to tray. |

### P3 — nice-to-have

| # | Item | Summary |
|---|------|---------|
| 23 | Filter presets | 1–2 saved filter combinations, one click to apply. |
| 24 | Scroll memory | Per-view scroll position restored when navigating back (esp. Matches ↔ matchDetail). |
| 25 | Session recap | Compact recap card (W–L, net, best/worst map, flags, target hit-rate) on first open of a new day with games the previous day. |
| 26 | Colorblind support | Palette toggle in Settings; charts gain a secondary encoding (shape/pattern) where color is the only W/L channel. |
| 27 | Chart as table | Per chart card, a "view as table" toggle rendering the same data as text. |

## Out-of-Scope

- The live connection indicator and debug log (own specs: `live-status`, `debug-log`).
- Search across *all* historical matches in the palette (recent matches only — the current
  snapshot's rows).
- Light theme, responsive/mobile layout, localization.
- Practice queueing, share/publish features (reaffirmed from screen specs).
- Changes to analytics/stat semantics — this spec is interaction-only.

## Constraints

- All five CLAUDE.md guardrails hold; specifically: renderer stays CSP-friendly and single-bundle
  (palette fuzzy-matching is hand-rolled, **zero new runtime dependencies**), `core/` stays pure.
- New UI is built from `components/` primitives (composition-first); palette, toast host, and
  skeletons become reusable components.
- All persistence of UI preferences (view, sort, min-games, presets) uses the same localStorage
  mechanism as filters; window bounds and close-to-tray live in main-process config.
- Keyboard shortcuts must not fire while a text input/modal has focus (except Esc and palette keys).
- Everything must work in the browser preview harness (`npm run preview`) except
  window-memory/close-to-tray (main-process; preview no-ops).

## Acceptance Criteria

- **1** Given the app is open, when I press Ctrl+K and type "hero: ana" (or "ana"), then the palette
  lists Ana → Enter opens the hero drawer; typing "trends" navigates to Trends; typing "log"
  surfaces the Log match action.
- **2** Given my last logged match was Support/Competitive on account X, when I open Log match, then
  role=Support, mode=Competitive, account=X are prefilled and **no** mental flags are pre-checked.
- **3** Given I type "zar" in the hero field, then Zarya is suggested and selectable by keyboard.
- **4** Given I quit on Heroes, when I relaunch, then Heroes is active; given I quit on a match
  detail page, then Matches is active.
- **5** Given I Tab through the sidebar, then a visible focus ring marks the focused item; given OS
  reduced-motion is on, then no UI animation plays.
- **7** Given I archive a target, then it archives immediately and a toast with Undo shows ≥5s;
  clicking Undo restores it. Given I delete a target permanently, then a confirmation modal still
  gates it.
- **8** Given data is loaded and the window regains focus, when the refetch runs, then the previous
  content stays visible (no blank/loading swap) with a busy indicator until the new snapshot lands.
- **9** Given `getDashboard` rejects on cold start, then an error card with Retry renders; clicking
  Retry re-attempts. Given a background refresh fails with data on screen, then the data stays with
  a "stale" marker.
- **12** Given focus is not in a text field, when I press Ctrl+3, then the third sidebar view opens;
  `?` opens the cheatsheet; Esc on match detail returns to Matches.
- **13** Given I'm on a match detail with a newer match in the filtered list, when I press → (or
  click next), then that match's detail renders.
- **16** Given matches from today and yesterday, when Matches renders, then rows sit under
  "Today"/"Yesterday" headers, each with its W–L tally.
- **18** Given the Review inbox has an expanded game with focused target, when I press H, then it
  grades Hit and focus moves to the next target/game.
- **P2/P3 general** Each remaining item: given its precondition, the described behavior is
  observable in preview or app, and no existing acceptance criterion of the ten screen specs
  regresses.

## Resolved questions

1. **Spec shape** — three separate specs (ui-qol / live-status / debug-log); screen-spec files
   updated during implementation, not now.
2. **Scope** — all four brainstorm clusters included.
3. **Priorities** — P1/P2/P3 tiers as the cut-line contract (chosen over "all must land").
4. **Undo vs confirm** — undo-toast for reversible actions; confirmation modal stays for permanent
   delete only.
5. **Palette scope** — navigation + actions + data search (not navigation-only).
6. **Quick-log prefill** — remember role/mode/account only; map/hero/result always fresh; flags
   default empty.
7. **Settings vs Mental** — Settings is the canonical settings home; Mental's inline break-reminder
   editor stays (same underlying config).

## Open Questions

- Palette match-ranking details (e.g. prefix vs fuzzy weighting) — implementer's choice, not gated.
- Whether #25's "session" recap should also trigger after N hours of inactivity same-day —
  defaulting to "new day" trigger unless revised.
