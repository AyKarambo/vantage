# Spec: `overnight-ux-analytics`

> Documented retroactively in the same overnight autonomous run that shipped it
> (commits `43cafb7..ec67760`); recorded so the SDD trail in `specs/` stays complete.

## Intent (WHAT & WHY)
The readiness coach only modeled **overtraining**; for a player who wants to improve,
**undertraining** (long layoffs, too few sessions per week) is the mirror-image risk and was
invisible — a 3-week layoff literally read as "fresh". Manual match logging was the app's most
repeated interaction but mouse-bound (a 40-option map `<select>`, an Enter hint that wasn't
wired, no backfill). And the stored timestamps carried unexploited analytics: when you win, and
how you fade within a session.

## In-Scope
- **Undertraining in the readiness model:** a `rusty` band (7+ full rest days), a supercompensation-
  shaped rest curve (recovery peaks days 1–3, decays into rust after), a low-frequency consistency
  signal (<3 active days/week), an honest stale verdict (14+ days = rusty, not "fresh"), gap-shaded
  trend chart, detraining tail + copy on the schematic, `active days/week` in the Load card.
- **Temporal analytics on Trends:** winrate by local day-part with a best-window callout, and
  winrate by game-number-within-session with a sample-gated "you fade from game N" read.
- **Keyboard-fast logging:** Enter saves / Ctrl+Enter saves-and-reopens (hero carried), `W/L/D`
  result keys with visible hints + cheatsheet entries, map & hero typeaheads with recent picks
  first (browse-on-focus), strict map canonicalization, and `Played` backfill chips
  (30 m / 1 h / 2 h) via a new `ManualMatchInput.playedAt`.
- **Cross-link & honesty quick wins:** Overview scatter dots navigate to Maps; the Mental tilt-tax
  claim is withheld under 5 tilted games.

## Out-of-Scope (non-goals)
- New GameRecord fields (groupSize/startedAt stay dropped — the SQLite session owned the schema).
- SQL-driven analytics; a rusty launch toast; per-map/per-hero target scoping.

## Acceptance Criteria (Given / When / Then)
1. Given a healthy history ending 7+ days ago, when readiness computes, then band = `rusty` with a
   `ramp-back-up` recommendation; 6 days remains `fresh`; 14+ days is `rusty` (score null) instead
   of the old "fresh — rested"; a heavy history also lands on rusty after a long layoff.
2. Given a rusty verdict, then no stale pre-layoff load/tilt/outcome signals are surfaced.
3. Given <3 active days/week over the chronic window (while playing), then a consistency signal
   shows; daily players never see it; it never fires together with the rust-gap signal.
4. Given 10+ decided games in ≥2 day-parts, then Trends names the best window; given ≥8 decided
   games at an early and a late session position with a ≥8-point drop, then Trends names the fade
   position; below sample, both cards stay honest hints.
5. Given the log dialog: `W/L/D` set the result outside text fields; Enter saves; Ctrl+Enter saves
   and reopens with the hero carried; an unknown/empty map blocks the save with an inline error;
   a `Played 1h ago` chip stamps the record in the past (clamped to now on the receiving side).
6. DoD: `npm test` + `npm run typecheck` green; new core logic unit-tested
   (`test/readiness.test.ts` additions, `test/temporal.test.ts`, `test/logMatchProvider.test.ts`);
   README updated.
