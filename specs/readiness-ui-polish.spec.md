# Spec: Readiness screen & help-wiki UI polish

**Slug:** `readiness-ui-polish`
**Status:** Approved
**Surface:** Renderer only — `renderer/src/views/readiness.ts`, `renderer/src/charts/plots/readinessChart.ts`, `renderer/src/app/readinessWiki/*`

## Intent (WHAT & WHY)

Three small rough edges on the Readiness screen and its help wiki undercut an otherwise polished, data-first screen:

1. **The readiness trend chart looks foreign.** It uses colored band zones plus faint vertical "rest-day" stripes and native browser tooltips, so it reads as a different visual language than the app's other line charts (e.g. the winrate trend). It should feel like it belongs to the same design system.
2. **Redundant per-card "?" help links.** Each card carries a small "?" that opens the same guide the top-right **Help** button already opens. They add visual noise next to the Verdict badge and elsewhere for no unique value.
3. **The wiki breadcrumb is weak and its Back is unreliable.** The breadcrumb is tiny (11.5px muted) and hard to spot, and the **Back** control is reported not to work / not always present — making the drawer awkward to navigate.

Fixing these makes the screen read as one coherent system and makes the help wiki easy to move around in.

## In-Scope

- **Chart restyle** (`readinessChart`): converge on the house line-chart style — accent-colored line with a soft area fill beneath it, app-styled hover tooltips (the shared `tooltipLayer`), and x-axis date labels — while keeping a *faint* green/amber/red band tint behind the line as a fresh→in-the-hole reference. Remove the vertical rest-day stripes.
- **Remove all four per-card "?" links** (Verdict, "What moves the score", "Training load", "Readiness trend"). Keep the top-right **Help** button and the Verdict card's inline "How is this calculated?" link. Clean up any resulting dead code / unused imports, and update the `readiness.ts` module doc comment that currently claims a "per-card '?'" exists.
- **Wiki breadcrumb + Back redesign** (`readinessWiki/index.ts` + CSS): make the breadcrumb visually more prominent and easier to scan; make **Back** always present and reliably functional. With navigation history, Back returns to the previous page; with no history (a directly deep-linked article), Back goes to the guide **Overview**.

## Out-of-Scope

- Readiness scoring, band thresholds, confidence logic, or the `trend` data itself — rendering only, no `core/` or contract changes.
- Restyling any other chart, or the `supercompensationSchematic` illustration.
- Wiki article *content* / tiers (only the breadcrumb + Back navigation chrome changes).
- Behavior of the global **Help** button and "How is this calculated?" link (kept as-is).

## Constraints

- **Guardrails hold:** renderer stays CSP-friendly (no inline scripts / eval / CDN), framework-free, single esbuild bundle; charts stay **dependency-free SVG**. No new npm dependencies.
- `core/` stays pure and untouched; the IPC contract is unchanged. No `any` across the boundary.
- Colors come from `PALETTE` / CSS tokens (no hard-coded one-offs outside the existing convention).
- Match surrounding style: 2-space indent, single quotes, semicolons; compose existing components rather than hand-rolling markup.
- Redesigned breadcrumb must not collide with the drawer's built-in ✕ (currently avoided via right margin).

## Acceptance Criteria

**Trend chart**
- **AC1** — *Given* the Readiness screen with ≥2 scored trend points, *When* the trend chart renders, *Then* it shows an accent-colored line with a soft area fill beneath it and **no** vertical rest-day stripes.
- **AC2** — *Given* the trend chart, *When* I hover a data point, *Then* the shared app tooltip (`tooltipLayer`, as on the winrate chart) shows that day's date, readiness score, and game count — not a native browser title tooltip.
- **AC3** — *Given* the trend chart, *Then* the x-axis shows date labels at a regular step plus the latest point, and the 0/50/100 y-gridlines remain.
- **AC4** — *Given* the trend chart, *Then* a *faint* green/amber/red band tint remains behind the line, subtle enough not to dominate the plot.
- **AC5** — *Given* fewer than 2 scored points, *Then* the existing "Not enough history yet…" empty state still shows.

**Per-card "?" removal**
- **AC6** — *Given* the Readiness screen, *Then* none of the four cards display a per-card "?" link.
- **AC7** — *Given* the Readiness screen, *Then* the top-right **Help** still opens the guide Overview, and the Verdict card's inline "How is this calculated?" still deep-links to the verdict article.
- **AC8** — *Then* no dead code / unused imports remain from the removal, `npm run typecheck` is clean, and the `readiness.ts` doc comment no longer references a per-card "?".

**Wiki breadcrumb + Back**
- **AC9** — *Given* the wiki drawer open on a sub-page reached by navigating (history exists), *When* I click **Back**, *Then* it returns to the immediately previous page.
- **AC10** — *Given* the wiki drawer opened directly on an article (no history), *Then* **Back** is still shown, and clicking it navigates to the guide **Overview**.
- **AC11** — *Given* the wiki drawer, *Then* the breadcrumb is visually more prominent than the current 11.5px muted text, so the current location and Back affordance are easy to spot.
- **AC12** — *Then* the redesigned breadcrumb does not overlap the drawer's built-in ✕ close button.

**Definition of Done**
- `npm test` passes; `npm run typecheck` clean (main + renderer). No `core/` logic changes, so no new `core/` tests are required; any existing renderer/chart tests stay green. Verify the three flows in the preview harness. Update the `readiness.ts` doc comment (and any README/readiness-help doc that references a per-card "?").

## Resolved questions

- **Chart direction?** → **Match house style, keep band tint.** Adopt the winrate chart's look (accent line + soft area fill + app hover tooltips + x-axis labels), keep a subtle band-zone tint, drop the vertical rest-day stripes.
- **How many "?" to remove?** → **All four.** Help button + inline "How is this calculated?" remain the entries to the guide.
- **Back with no history?** → **Back → guide Overview.** Back is always visible; from a deep-linked article it lands on Overview.

## Open Questions

- The current "Back doesn't work" is captured behaviorally (AC9/AC10). Root cause (a genuine dead-click vs. Back simply being absent at stack depth 1) will be confirmed during `/techplan`; either way the outcome must satisfy AC9/AC10.
- Exact "prominent breadcrumb" styling (size/weight, whether Back becomes a distinct button vs. a stronger inline link) is a design detail to settle in `/techplan` — AC11 sets the bar, not the pixels.
