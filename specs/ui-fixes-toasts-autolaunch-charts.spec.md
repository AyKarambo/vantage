# Spec — ui-fixes-toasts-autolaunch-charts

## Intent (WHAT & WHY)
Three unrelated but small UX papercuts: settings toasts are distracting, the "Run at
login" toggle looks dead when clicked, and some charts balloon to absurd sizes on large
monitors. Each erodes polish; all are cheap to fix.

## In-Scope
1. **Remove settings toasts** — drop the toast (and its Undo) fired on settings changes
   (`settings.ts`, `breakReminderEditor.ts`); the setting still applies instantly. Other
   toasts (match logged, review saved, target archived) are untouched.
2. **Fix "Run at login" UI reflection** — clicking the toggle must immediately reflect its
   new state in the UI. Diagnose the state binding in `settings.ts`; verify auto-launch
   registration (`setAutoLaunch`, `main/index.ts`) still works end-to-end.
3. **Cap chart growth** — `lineChart` (720×190) and `scatterChart` (640×300) currently
   scale to `100%` width unbounded. Cap them at a comfortable **max width (~960px)**; they
   scale with the window up to the cap, then stop. Small/medium windows unaffected;
   already-fixed charts (donut, sparkline) unchanged.

## Out-of-Scope
- Any change to *what* settings do, or to non-settings toasts.
- Redesign of chart internals/aspect ratios beyond the max-width cap.
- The auto-launch behavior itself unless the diagnosis shows it's also broken.

## Constraints
- Renderer stays CSP-friendly; cap is CSS `max-width`, not JS-measured layout thrash.
- No regression to accessibility of the toast host (`aria-live`) for remaining toasts.

## Acceptance Criteria
- Given the Settings screen, When I change any setting, Then no toast appears and the
  change still takes effect.
- Given the "Run at login" toggle, When I click it, Then its visual state flips
  immediately to match the new value.
- Given "Run at login" is enabled/disabled, When I restart, Then Windows auto-launch
  reflects the setting (behavior verified, not regressed).
- Given a very wide window, When I view the trend line chart and priority scatter, Then
  they stop growing past ~960px and don't become "ridiculously big".
- Given a small/medium window, When I view those charts, Then their size is unchanged.

## Resolved questions
- **Toasts** → remove settings toasts *and* their Undo; keep other toasts.
- **Run at login** → observed as "toggle looks dead in UI"; fix UI reflection and verify
  auto-launch wiring.
- **Chart cap** → cap at a comfortable max width (~960px), then stop growing.

## Open Questions
- Exact cap value / alignment once eyeballed in-app.
