# Tech Plan: Readiness screen & help-wiki UI polish

**Slug:** `readiness-ui-polish`
**Spec:** [`readiness-ui-polish.spec.md`](readiness-ui-polish.spec.md)
**Scope:** Renderer-only. No `core/`, no IPC contract, no data-shape changes.

This plan is grounded in a code survey of the readiness view, the chart plots + their shared helpers (`tooltipLayer`, `svg`, `shared`), the readiness wiki drawer/navigation, and every doc that references the per-card "?".

---

## Architecture & Approach

Three independent changes, each contained to the renderer. Order is arbitrary; they don't interact.

### A. Restyle the readiness trend chart (AC1–AC5)

`readinessChart()` is rewritten to mirror the house line chart (`lineChart.ts`) while keeping readiness semantics. It can't *reuse* `lineChart` because `ReadinessTrendPoint` (`{ date, score: number|null, games }`) is not a `WrPoint` (`{ label, winrate, games }`) — so we restyle `readinessChart` in place. New render order (back → front):

1. **Faint band zones** (kept, subtler) — the existing green/amber/red rects (70–100 / 40–70 / 0–40), opacity dropped from `0.07` toward `~0.05` so they read as a quiet reference tint, not a dominant background. Drawn first (behind everything).
2. **Soft area fill** — a path from the baseline up through the scored points and back to baseline, `fill: 'rgba(124,108,245,0.10)'` (= `PALETTE.accent` at 0.10, byte-identical to `lineChart.ts:33`). Built over the **scored subset** (skipping `score === null` leading days); baseline is `yAt(0)`.
3. **Grid + y labels** — unchanged `[0, 50, 100]` horizontal lines (`PALETTE.grid`) with right-anchored labels.
4. **Line** — `fill:'none', stroke: PALETTE.accent, 'stroke-width': 2.5` with round join/cap (matches `lineChart.ts:37`; today it's `accentBright`/`2`).
5. **Dots + hover tooltips** — per scored point: a visible `circle r:3 fill: PALETTE.accentBright`, plus a **generous invisible `r:11` transparent hit circle** wired through `tooltipLayer` (`const tips = tooltipLayer(wrap)` → `tips.attach(hit, text)` → `wrap.append(s, tips.tip)`), replacing today's raw `<title>`-per-dot. Tooltip text keeps the current content: `` `${p.date} · readiness ${p.score} · ${p.games} game(s)` ``.
6. **X-axis date labels** (new) — stepped labels using `lineChart`'s exact strategy: `step = Math.ceil(n/8)`, `last = n-1`, draw when `stepped || i === last` where `stepped = i % step === 0 && last - i >= step/2`. Label text `p.date.slice(5)` → `MM-DD` (dates are `YYYY-MM-DD` from `ordinalToKey`, `src/core/readiness/day.ts:36`).

**Removed:** the vertical **rest-gap stripes** block (`readinessChart.ts:43–50`) — the main "doesn't fit" offender.

**Padding:** bump `padB` `18 → 24` to seat the new x-axis labels; `padL` `26 → 30` (labels are `0/50/100`, no `%`); `padT ~12`. `W=720, H=190` unchanged so it sits at the same size as the winrate chart.

**Empty state:** keep the existing readiness-specific message (`< 2` scored points → `'Not enough history yet for a readiness trend.'`). We deliberately do **not** switch to the shared `emptyChart()` — it hard-codes generic copy ("Not enough data yet.") and a fixed 240×60 box, which would lose the tailored message for no design win.

`supercompensationSchematic()` (same file) is **untouched** — it's a separate illustration used inside wiki articles, out of scope.

### B. Remove the four per-card "?" links (AC6–AC8)

The per-card `cardHelp` helper duplicates the global **Help** button. Delete it and its four call sites; keep the two real guide entries (global **Help**, inline **"How is this calculated?"**).

- Delete `cardHelp()` (`readiness.ts:67–76`).
- Drop `actions:` from the three simple cards: **What moves the score** (`:103`), **Training load** (`:184`), **Readiness trend** (`:200`).
- **Verdict card** (`:122`, `:126`): remove the `const help` binding; collapse the actions ternary to `actions: showRegime(r.band) ? badge(regime.label, regime.kind) : undefined`. `card()` accepts `actions?: Child | Child[]` (`primitives/card.ts:14`), so a single node or `undefined` is valid. Remove the now-stale comment at `:124–125`.
- Remove the orphaned import `WikiArticleId` (`readiness.ts:16`) — its only use was `cardHelp`'s signature. `openReadinessWiki`, `button`, `badge` all stay used (globalHelp, "How is this calculated?", regime badge).
- Fix the module doc comment (`readiness.ts:6`): drop "+ a per-card '?'" so it no longer claims a per-card affordance.
- **README.md:84** — update the present-tense, user-facing sentence that says help "lives behind a **Help** button and a per-card **"?"**" to reference just the Help button.

The completed historical specs `specs/readiness-help-docs.{spec,plan,tasks}.md` are **left as-is** — they record what was built at that time (all tasks marked `[x]`); rewriting history there adds noise without improving live consistency. Only the live surfaces (code comment + README) are corrected.

### C. Fix + redesign the wiki breadcrumb / Back (AC9–AC12)

**Root cause (confirmed):** Back is *absent*, not dead. The stack seeds at length 1 (`index.ts:34 const stack = [initial]`) and Back is gated on `stack.length > 1` (`index.ts:87`). Every card "?" and the "How is this calculated?" link open **deep-linked to an article** (stack length 1) → no Back ever renders; users only get a `Guide › Title` crumb. A rendered Back (reached by drilling deeper) already works correctly — no event/re-render hazard exists (drawer is body-mounted, re-renders are click-driven only, `panel`'s `stopPropagation` doesn't touch descendant handlers).

**Fix (one line):** seed an implicit Overview base under any deep link, so Back is always present and pops to Overview (exactly the resolved decision):

```ts
const stack: WikiRoute[] =
  initial.view === 'overview' ? [initial] : [{ view: 'overview' }, initial];
```

This satisfies AC9 (history exists → Back pops to previous page — unchanged) and AC10 (deep-linked article → Back shown → lands on Overview). Opening via global Help stays `[overview]` (atRoot, no Back — correct, it's the guide root). No change needed to `back()`, `home()`, `goto()`, or the `stack.length > 1` gate.

**Prominence redesign (AC11/AC12):** rework the breadcrumb markup + CSS so Back is an obvious affordance and the trail is legible:

- Markup (`breadcrumb()` in `index.ts:83–92`): render Back as a distinct **`.wiki-back` button** (`‹ Back`) instead of a bare `inline-link`, followed by a `Guide › <Current>` trail where "Guide" is the home link (`.wiki-crumb`) and the current title is emphasized (`.wiki-crumb-current`).
- CSS (`components.css:1323–1331`): raise `.wiki-breadcrumb` `font-size 11.5px → 13px`; add `.wiki-back` (small ghost pill: `padding`, `border: 1px solid var(--border-2)`, `background: var(--surface-2)`, `border-radius: var(--r-md)`, `color: var(--text)`, `font-weight: 600`, hover → `--surface-3`/`--border`) reusing the same tokens as `.wiki-index-item`; `.wiki-crumb-current { color: var(--text); font-weight: 600 }`. Keep a right margin (~`44px`) so the row clears the absolutely-positioned ✕ (AC12). Exact px/weights are tunable during preview verification — AC11 sets the bar, not the pixels.

---

## Affected Files/Modules

| File | Change | ACs |
|---|---|---|
| `renderer/src/charts/plots/readinessChart.ts` | Restyle `readinessChart`: faint bands → soft accent area fill → line (`accent`/2.5) → dots + `tooltipLayer` hit circles → x-axis date labels; **remove** rest-gap stripes; bump `padB`/`padL`. `supercompensationSchematic` untouched. | AC1–AC5 |
| `renderer/src/views/readiness.ts` | Delete `cardHelp` + 4 call sites; simplify Verdict actions; remove `WikiArticleId` import; fix doc comment (`:6`) + stale comment (`:124–125`). | AC6–AC8 |
| `renderer/src/app/readinessWiki/index.ts` | Seed stack with Overview base for deep links (`:34`); redesign `breadcrumb()` markup (`:83–92`). | AC9–AC12 |
| `renderer/styles/components.css` | Restyle `.wiki-breadcrumb`; add `.wiki-back` / `.wiki-crumb` / `.wiki-crumb-current` (`:1323–1331`). | AC11–AC12 |
| `README.md` | Drop present-tense per-card "?" claim (`:84`). | AC8 |

**Not touched:** `src/core/**`, `src/shared/contract/**`, `tooltip.ts`/`svg.ts`/`shared.ts` (consumed as-is), other charts, wiki article content, historical `readiness-help-docs.*` specs.

## Data Model / Interfaces

No changes. `ReadinessTrendPoint { date: string; score: number | null; games: number }` (`src/core/readiness/types.ts:49–54`) and `WikiRoute` / `WikiNav` (`readinessWiki/types.ts`) are consumed exactly as today. The chart already receives `ctx.data.readiness.trend`; the wiki fix only changes how the existing `stack: WikiRoute[]` is *initialized*.

## Test Strategy

The repo runs vitest in **node env with no jsdom** (`vitest.config.ts`) and has **zero DOM/chart-render tests** by design — chart output is not unit-tested here. So:

- **Regression guard:** `npm test` must stay green. The readiness *core* tests (`test/readiness*.test.ts`) assert on the `ReadinessTrendPoint` data shape / numbers, which we don't change — so they're unaffected. No new `core/` logic ⇒ per DoD, no new `core/` tests required.
- **Typecheck as the removal proof (AC8):** `npm run typecheck` (main + renderer) must be clean — this is what catches the orphaned `WikiArticleId` import and any missed `cardHelp` reference.
- **Behavioral verification in the preview harness** (`npm run preview`, per the house preview-harness flow) — this is where the visual/interaction ACs are checked:
  - AC1–AC4: trend chart shows accent line + soft area fill + hover tooltips (`chart-tooltip`) + x-axis `MM-DD` labels + faint bands, **no** vertical stripes.
  - AC5: force `< 2` scored points → empty-state message still shows.
  - AC6/AC7: no "?" on any card; **Help** opens Overview; "How is this calculated?" opens the verdict article.
  - AC9: Help → open article via index → **Back** returns to Overview/prev page.
  - AC10: open a card-less deep link (via "How is this calculated?") → **Back** is present → lands on Overview.
  - AC11/AC12: breadcrumb is visibly larger/clearer and doesn't overlap the ✕.

## Risks & Alternatives

- **Muddy chart (accent fill over band zones).** Stacking a 0.10 accent area fill over green/amber/red bands could look busy — the exact thing we're fixing. *Mitigation:* bands drawn first at low opacity (~0.05) behind the fill; tune both in preview against AC4's "subtle enough not to dominate." *Alternative considered:* drop bands entirely for a pure house-style chart — **rejected by the user** (they chose "keep band tint").
- **Null-score area fill.** `score` is `null` on leading no-history days. The area/line are built over the scored subset and connect across any interior gap (identical to today's polyline behavior). Interior nulls are effectively only the first days, so this is safe; noted for the implementer.
- **Back seed redundancy.** After the seed fix, from a depth-2 deep link both **Back** and the **Guide** crumb lead to Overview. This is intentional and consistent (Back = primary affordance, Guide = root link). *Alternative:* keep `[initial]` and make `back()` fall back to `home()` when `stack.length === 1` — more special-casing for the same result; the one-line seed is cleaner and leaves `back()`/breadcrumb gating untouched.
- **Shared CSS blast radius.** `.wiki-breadcrumb` and the new classes are used only by the readiness wiki drawer, so restyling has no wider impact.
- **Doc drift.** README.md:84 is corrected; historical `readiness-help-docs.*` specs are intentionally preserved as a record of prior work.

---

*Next: `/breakdown` to turn this into tasks, then `/implement`.*
