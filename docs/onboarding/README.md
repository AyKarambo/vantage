# Onboarding — start here

Welcome to **Vantage**, an account-safe Overwatch 2 stats coach built on ow-electron.
These docs get you from "never seen this repo" to shipping a change. Read them in order;
each one takes about ten minutes.

| Doc | What it answers |
|-----|-----------------|
| [01 — Getting started](01-getting-started.md) | How do I install, build, run, and test? What are the dev modes? |
| [02 — Architecture](02-architecture.md) | How is the app structured? How does a match travel from the game to the screen? |
| [03 — Codebase tour](03-codebase-tour.md) | What lives in each folder and file? |
| [04 — Common tasks](04-common-tasks.md) | How do I add a stat, a screen, an IPC method, a chart, a test? |

## The five-minute version

- **What it is:** a frameless Windows desktop app that turns your Overwatch 2 match
  history into priority maps, per-hero stats, mental tracking, and improvement targets.
  Notion export is optional, everything else is local-first.
- **The stack:** TypeScript (strict) everywhere. The Electron **main process** does
  plumbing (game events, persistence, IPC, Notion); all domain logic is **pure
  TypeScript** in [`src/core/`](../../src/core); the **renderer** is framework-free DOM
  composition bundled by esbuild.
- **The one rule that shapes everything:** live game data comes *only* from Overwolf's
  Game Events Provider (GEP). No memory reading, no injection — that's the product's
  zero-ban-risk promise.
- **Fastest feedback loop:** `npm run preview` serves the full UI in a plain browser at
  <http://localhost:5178> with sample data and a mocked bridge — no Overwolf runtime, no
  Electron, no game.

## Other reading

- [`CLAUDE.md`](../../CLAUDE.md) — the project constitution: guardrails and the
  Definition of Done. Read it before your first PR.
- [`README.md`](../../README.md) — the product-level readme (screens, status, roadmap).
- [`specs/`](../../specs) — one behavioral spec per screen; the source of truth for
  what each view is supposed to show.
- [`docs/signing.md`](../signing.md) and
  [`docs/overwolf-submission.md`](../overwolf-submission.md) — release/signing and
  store-submission notes (you won't need these for day-to-day work).

## Who to ask

Timo Seikel (<timo.seikel@gmail.com>) — solo maintainer; all questions go to him.
