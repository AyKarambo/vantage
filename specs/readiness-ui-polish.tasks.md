# Tasks: Readiness screen & help-wiki UI polish

**Spec:** [`readiness-ui-polish.spec.md`](readiness-ui-polish.spec.md) · **Plan:** [`readiness-ui-polish.plan.md`](readiness-ui-polish.plan.md)

Derived from the plan's three independent sections. Each is small, self-contained, and reviewable on its own. Implement one at a time, stopping for review after each.

- [x] **T1 — Restyle the readiness trend chart** (plan §A, AC1–AC5) — *done; verified live in preview harness (accent line + area fill + hover tooltip + MM-DD x-axis + faint 0.05 bands, no stripes).*
  `renderer/src/charts/plots/readinessChart.ts`. Mirror the house `lineChart`: faint band tint → soft accent area fill (`rgba(124,108,245,0.10)`) → accent line at 2.5 → dots + `tooltipLayer` with `r:11` invisible hit circles → stepped `MM-DD` x-axis labels. **Remove** the vertical rest-gap stripes. Bump `padB`/`padL`. Keep the tailored empty-state message. `supercompensationSchematic` untouched.

- [x] **T2 — Remove the four per-card "?" links** (plan §B, AC6–AC8) — *done; verified live (0 "?" links, Verdict shows only the regime badge, Help + "How is this calculated?" intact, typecheck clean).*
  `renderer/src/views/readiness.ts` + `README.md`. Delete `cardHelp` + its 4 call sites, collapse Verdict actions to the regime badge, remove the orphaned `WikiArticleId` import, fix the module doc comment + stale comment, and correct README.md:84. Keep global **Help** and "How is this calculated?". Typecheck proves no dead code.

- [x] **T3 — Fix + redesign the wiki breadcrumb / Back** (plan §C, AC9–AC12) — *done; verified live (Back now present on deep-linked articles → Overview; history-Back returns to prev page; breadcrumb 13px + ghost-pill Back; clears the ✕).*
  `renderer/src/app/readinessWiki/index.ts` + `renderer/styles/components.css`. Seed the stack with an Overview base under deep links so Back is always present and pops to Overview; redesign the breadcrumb to be more prominent (13px + `.wiki-back` ghost-pill button) without overlapping the ✕.

**Done-check per task:** `npm test` green, `npm run typecheck` clean, behavior verified in the preview harness for the task's ACs.
