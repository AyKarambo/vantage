---
slug: readiness-help-docs
status: done
created: 2026-07-08
updated: 2026-07-08
---

# Spec: Readiness help wiki — a progressive-disclosure guide for the Readiness view (`readiness-help-docs`)

**Source:** Feature request 2026-07-08 — "move the 'how to read this' in readiness into another view / help… show the data in the view itself, and if the user doesn't know how to read it he clicks a help and a pop-up appears with detailed information… start with a rough summary but let the user navigate to more detailed stuff… a wiki for the readiness view… simple language in summaries, increase difficulty when the user wants to know more." Clarified via a 7-question spec interview (all forks recorded under *Resolved questions*).
**Related specs:** `readiness-score-rework.spec.md` and `readiness-data-regimes.spec.md` (the model this guide explains — three families, the 75 anchor, the stats↔manual regime dial, the rank-gated nudge, the passivity guard), `supercompensation-detection.spec.md` (the supercompensation schematic + rust), `screen-review.spec.md` / `screen-targets.spec.md` (grades feeding the dampener). **Content sources (dev-facing, not shipped):** `specs/readiness-data-regimes.scenarios.md` (the 29-scenario catalog), `specs/readiness-score-rework.research.md`.

## Intent (WHAT & WHY)

The Readiness view currently carries its own teaching load inline: a "How to read this" card, long card footnotes, regime-badge tooltips, and a dense 13-section "How is this calculated?" modal. Meanwhile the repo holds a genuinely rich body of readiness knowledge — a 29-scenario "when do I get which score" catalog, the stats-vs-manual regime model, the supercompensation model, the rank-gated nudge — that **users never see**, written in engine jargon (`loadΔ`, `b=0.6`, CUSUM).

Two problems: (1) the view is cluttered with prose when the returning user mostly wants to *read their numbers at a glance*, and (2) the deep material that would actually build trust and understanding is either buried in `specs/` or crammed into one flat modal with no on-ramp — simple readers and curious readers are served the same wall of text.

**Goal:** strip the Readiness view down to the data, and move all explanation into an on-demand, progressively-disclosed **wiki** — plain-language on top, drilling down to the real formulas and a *curated* scenario set, and personalized to *this* user's current readiness ("here's why **you** are where you are").

**Benefit:** a clean, scannable view for the returning user; a trustworthy, self-serve explanation for the curious one; and finally surfacing the coaching knowledge the app already computes but never explains — without overwhelming anyone.

## In-Scope

1. **A "Readiness guide" overlay wiki**, opened from a help affordance in the Readiness view (**no** new sidebar nav entry). Structure: an **Overview landing → article pages** with back/breadcrumb navigation. Each article is **simple-first**: a plain-language intro, then "how it works," then a **Deep-dive tier that exposes the real mechanics** (the 75 anchor, family caps ~40/45/15, acute:chronic ratio, sustained-decline / CUSUM detection, tilt cap, rank-gated nudge).
2. **Entry points from the Readiness view:** one **global Help** affordance (opens the wiki at its Overview) **plus a small "?" on each data card** (Verdict, What moves the score, Training load, Readiness trend) that deep-links straight to the relevant article at its plain tier.
3. **A personalized "Your readiness right now" article** — the landing hook — with a **full walkthrough**: (a) a plain narrative of the user's current regime / band / confidence and which of the three families are pulling; (b) the **curated scenario(s) their real numbers are closest to**; (c) a **step-through reconstructing their score from the neutral 75** using each family's actual delta (`75 + load.delta + performance.delta + subjective.delta`).
4. **A curated scenario-library article** — a **representative, trimmed subset** of the catalog (the archetypes that teach the model: e.g. habit-is-not-risk, one-rest-day recovery, the supercompensation peak, a layoff→rust, an amber grind, the road(s) to red, the regime dial, and one or two guardrails), rewritten in plain language and grouped. **Deliberately not all 29** — the goal is understanding, not a data dump. The user's closest scenario(s) are highlighted ("you're near these").
5. **Strip the Readiness view of prose:** remove `honestyCard` ("How to read this") and the long footnotes/tooltips; each card keeps its data + a terse label. **Keep one short "wellness heuristic, not a diagnosis" line visible** in the view for safety. The existing standalone `readinessMethodology` modal is **retired and folded into the wiki** — the "How is this calculated?" link now opens the guide.
6. **A pure `core/` module** for the nearest-scenario match and any score-walkthrough derivation, unit-tested (Guardrails 3 / DoD 3).
7. **Docs update** (README / the relevant screen spec) for the changed Readiness surface.

## Out-of-Scope

- **No new sidebar nav entry** — the guide is overlay-only.
- **No runtime fetching of `specs/*.md`** — content is authored and bundled into the renderer (Guardrail 4). The scenario catalog in `specs/` stays the *dev-facing source of truth*; the user-facing library is a **newly authored**, plain-language, trimmed rendition — informed by the catalog, not copied verbatim.
- **No changes to the readiness engine, tuning constants, or scores** — presentation only. The numbers the view shows are unchanged.
- **No new persisted settings**, no tray/toast changes, no Notion export of guide content.
- **No app-wide help system** — scoped to Readiness. (May become a reusable pattern later; not a goal here.)
- **No i18n / localization.**

## Constraints

- **Guardrail 3 (core stays pure):** matching / derivation logic is pure and lives under `src/core/` (Electron-free, unit-tested); the renderer only presents.
- **Guardrail 4 (CSP-friendly renderer):** one esbuild bundle, no `eval`, no CDN / runtime-fetched remote content. Wiki content is bundled data/modules; charts stay dependency-free SVG (reuse `supercompensationSchematic`).
- **Single source of truth for numbers:** any constant quoted in the Deep-dive tier (family caps, thresholds, the 75 anchor) must be **derived from or test-guarded against `READINESS_TUNING`**, so the docs cannot silently drift from the engine.
- **Graceful degradation:** when readiness is disabled, `insufficient-data`, or low-confidence, the personalized article falls back to generic educational content with a note on what's needed — it never fabricates a walkthrough. The wiki is fully usable with zero personalized data.
- **Reuse existing composition:** `h()` (`renderer/src/dom.ts`), `components/primitives`, and `openDrawer` / `openModal`; match the `overlay-close` / Escape / backdrop-dismiss / focus behavior already in `renderer/src/components/overlay.ts`.
- **Definition of Done:** `npm test` green, `npm run typecheck` clean (main + renderer), new `core/` logic covered by `test/`, docs updated, no guardrail weakened.

## Acceptance Criteria

**Stripped view**
- **Given** the Readiness view with data, **when** it renders, **then** the "How to read this" card and the long per-card footnotes/tooltips are gone, each card shows its data + a terse label, and exactly one short "wellness heuristic, not a diagnosis" line remains visible.
- **Given** the former "How is this calculated?" link, **when** clicked, **then** the **wiki overlay** opens (the standalone `readinessMethodology` modal no longer exists as a separate surface).

**Wiki structure & disclosure**
- **Given** the wiki is open at the Overview, **when** the user selects an article, **then** it opens simple-first (a plain intro is visible before any formula), with back/breadcrumb navigation returning to the Overview.
- **Given** any article, **when** the user drills to its Deep-dive tier, **then** real constants/mechanics appear (e.g. neutral 75, family caps, acute:chronic ratio, sustained-decline detection, tilt cap, rank-gated nudge), and those constants **match `READINESS_TUNING`** (guarded by a test).
- **Given** a data card's "?" (e.g. Training load), **when** clicked, **then** the wiki opens on that card's article at its plain tier; **and given** the global Help affordance, **when** clicked, **then** the wiki opens at the Overview.

**Personalization**
- **Given** a user with a current readiness read, **when** they open "Your readiness right now," **then** they see (a) a plain narrative of their regime / band / confidence and which families are pulling, (b) the curated scenario(s) closest to their numbers (primary + 1–2 alternates), and (c) a step-through where `75 + load.delta + performance.delta + subjective.delta` reconstructs their displayed score.
- **Given** readiness is `insufficient-data` or the feature is disabled, **when** they open that article, **then** it shows generic educational content and a note on what unlocks personalization — no fabricated walkthrough.
- **Given** the nearest-scenario matcher (pure `core/`), **when** unit-tested against known snapshots, **then** it returns the expected closest scenario(s) deterministically.

**Scenario library**
- **Given** the scenario-library article, **when** viewed, **then** a curated, plain-language set of archetype stories appears grouped, with the user's closest scenario(s) highlighted (or, with no personalized data, simply browsable) — and the set is deliberately trimmed, not the full 29.

**Non-regression / quality**
- **Given** the change, **when** `npm test` and `npm run typecheck` run, **then** both pass; readiness scores/bands are unchanged (presentation-only); the overlay closes on Escape and backdrop click and manages focus like the app's other overlays.

## Resolved questions (decisions from the spec interview)

1. **Surface** → an overlay opened by a help button (drawer/modal); **no** new sidebar entry.
2. **Entry points** → a global Help button **plus** per-card "?" deep-links.
3. **Scenarios** → surface them **and** personalize.
4. **Inline copy** → strip prose to the wiki, but **keep** a one-line "not a diagnosis" disclaimer visible in the view.
5. **Personalization depth** → **full walkthrough** (narrative + nearest-scenario match + score step-through from 75).
6. **Deep tier** → **expose the real formulas & constants** for power users.
7. **Progression model** → **Overview → article pages**, each article simple-first, wiki-like navigation.
8. **Overlay type** → a **right-hand drawer** (`openDrawer`) — more room for article navigation/breadcrumbs, consistent with the hero drawer. *(Approved.)*
9. **Scenario coverage** → **trim to a representative set**, not all 29 — "the goal is understanding how it works, not to be overloaded with scenarios." *(Owner override of the initial 'all 29' default.)*
10. **Nearest-match presentation** → show the single closest scenario prominently **+ 1–2 alternates**, to avoid false precision. *(Approved.)*
11. **Content authoring source** → text is **newly authored** across plain→technical tiers, *informed by* the `specs/` catalog and methodology but not copied verbatim. *(Approved.)*

## Open Questions

_None outstanding — all interview forks resolved above. Presentation details (exact article set, drawer layout, which archetypes make the curated cut) are for the technical plan._
