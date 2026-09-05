# Screen spec: Players (`players`) and the player drill-down (`playerHistory`)

**Source:** `renderer/src/views/players.ts`, `renderer/src/views/playerHistory.ts`,
`src/core/playerIndex.ts`, `src/core/rank/entering.ts`, `src/main/dashboard/reads.ts`
(`playerListRead`, `playerHistoryRead`), `src/shared/contract/players.ts`.

**Shared context:** Players is a normal top-level screen scoped by the global filter bar;
`playerHistory` is a parameterized drill-down (`playerName`) registered in `VIEWS` but not
`NAV`, with `DETAIL_PARENT.playerHistory = 'players'` driving both the sidebar highlight and
relaunch restore (see `screen-shell.spec.md`). Everything on both screens is derived at query
time from the rosters stored on match history — no separate store, no migration.

## Intent

Answer two different questions, and never let them be mistaken for one another:

- **Players** — *who did I meet in this range?* Filter-scoped, capped, browsable.
- **A player's page** — *what is my complete record with this person?* All-time, unfiltered.

The counts therefore differ for the same person, and both screens state their own scope in the
same vocabulary ("in this filter scope" vs "all time") before the user crosses between them.

## Players — layout & behaviour

- **Sortable table:** Player, Games together, With me, Against me, Last seen. Default sort is
  shared games descending. Search and a **min. games** chip row (`1+ / 2+ / 5+ / 10+`, its own
  `minPlayerGames` pref) narrow the list; the sort choice persists as `playerSort`.
- **Sorting, searching and capping happen on MAIN**, over the whole matched set, before the
  page is cut (`selectPlayers`). The renderer supplies `dataTable`'s `onSort` and never sorts
  locally: re-ordering a capped page would answer "the most recent among your 200
  most-played-with" while the header claims "most recent", with no visible tell.
- **The header paints from the payload's echo** (`sort`/`dir`/`appliedSearch`/`appliedMinGames`),
  not local state, so the arrow can never point at a column the rows are not ordered by.
- **Row cap** is `PLAYER_ROW_CAP` (200), echoed on the payload as `cap`. When `matched` exceeds
  it the footer says so and states that the search, floor and sort all ran over the full set.
- **Search filters; the column sorts.** No fuzzy ranking (it would fight the chosen column, and
  subsequence matching over thousands of BattleTags produces nonsense). The query is matched
  against the identity (the part before `#`) *or* the displayed tag, so `nova#2222` degrades to
  the merged `Nova` row while `#11` still discriminates.
- **Typing costs no history walk.** A 200 ms debounce, plus a revision-keyed directory memo in
  `reads.ts` — `provider.games()` re-reads and JSON-parses the whole history, so only a filter
  change, a write, or a new minute pays for a walk. The demo dataset bypasses the memo.
- **The search box owns its own state** and repaints only the table host (the `palette.ts`
  pattern): `render()` is `replaceChildren`, so routing a keystroke through `store.rerender()`
  would destroy the focused input and its caret.
- **Six empty states**, distinct because they have different causes and different fixes:
  nothing tracked at all · no games in scope · games but no rosters · rosters but no names ·
  the floor hid everyone · search found nothing. None may read as "you have met nobody", and
  the search miss offers **Search all time** rather than implying they don't exist.
- **Identity merging is surfaced, not hidden.** Players are keyed on the lowercased name before
  `#`, so `Nova#1111` and `Nova#2222` fold into one row; such a row carries a `⚠` marker.

## The player drill-down — layout & behaviour

- **Head:** the player's name, then `N shared games, all time · last seen · W/L · WR`, with the
  teammate/opponent split beneath. "All time" is load-bearing wording.
- **Shared-match table:** Map · Mode · Side · They played · You played · Account · Your rank ·
  When. Every row opens that match.
- **Their hero is singular; yours is a list.** The aggregator banks per-hero segments only for
  the tracked player and overwrites the roster slot for everyone else on each tick, so their
  swaps were never captured and cannot be backfilled.
- **Their role** reuses the match-detail scoreboard's derivation (`resolveRole(undefined,
  heroRole) ?? roleOfHero(heroName)`), so the two surfaces cannot disagree. A masked slot is
  blank, never "Unknown".
- **Side** is blank unless the feed reported a team for **both** rows.

### The rank column

Filled from `enteringRanks` — one grouped pass per `(account, role)` track for the whole
history, not one walk per row.

| State | Cell |
| --- | --- |
| Stored `rankAtStart` snapshot | the rank, plain |
| Reconstructed from the track's anchor | the rank, dimmed and marked `est.` |
| Inside an open placement run | blank — "no rank during placements" |
| Older than the track's completed run | blank — "before your last placement reset" |
| No anchor on the track | blank — "no rank set for this account and role" |
| Not a competitive match | blank |

- **There is no winrate-estimate fallback below the blanks** (unlike the match-detail
  Competitive card): a guess in a rank column is worse than a blank.
- **No shield, ever.** `SharedMatchRank` carries no protection flag at all, which is what makes
  it unreachable rather than merely discouraged — the backward walk cannot recover protection.
- **No inter-row derivative** (no delta, arrow or "you dropped a division here"): protection
  flattening could invent a division change that never happened.
- Derived cells are honestly unstable — a missing ±% counts as 0 and drifts everything older,
  and re-anchoring rewrites every one of them while stored snapshots stay frozen. A footnote
  under the table says so whenever any cell is derived.

## Out-of-scope

- **Any export of cross-player data** (guardrail 5 — stays local, never Notion). A unit test
  asserts no roster-derived field appears in the Notion schema.
- **An MCP tool for the all-players list.** Per-player history is already served over the local
  pipe; a full third-party-name dump is a deliberate decision, not a default.
- **Unmerging identities.** Changing the key would change `playerHistory`, `playerRecords` and
  the Live board at once; the `⚠` marker names the limit instead.
- **Virtualization.** Solved by capping main-side so the wire never carries the tail.
- **Player notes, nicknames or tags.**
