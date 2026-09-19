# Screen spec: Players (`players`) and the player drill-down (`playerHistory`)

**Source:** `renderer/src/views/players.ts`, `renderer/src/views/playerHistory.ts`,
`src/core/playerIndex.ts` (`playerDirectory`, `playerMatchHistory`'s `theirHeroes`/`form`/`tags`,
M6; also behind `DashboardData.recentPlayers` — the command palette's small Player-item slice, M5,
see `screen-shell.spec.md`), `src/core/heroes.ts` (`roleOfHero`, M6), `src/core/rank/entering.ts`,
`renderer/src/components/table.ts` (`dataTable`, M6), `renderer/src/components/roleIcon.ts`,
`renderer/src/components/inlineLink.ts` (the "Set a rank anchor →" link, M6),
`src/main/dashboard/reads.ts` (`playerListRead`, `playerHistoryRead`),
`src/shared/contract/players.ts`, `src/shared/contract/matchDetail.ts`.

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

- **Sortable table:** Player, Games together, With you, Against you, Last seen (the with/against
  wording is shared across Players, the match detail's player-history card, a player's own page
  and Live via `RELATION_LABEL` in `renderer/src/format.ts` — K7). Default sort is
  shared games descending. The **With you**/**Against you** header carries a tooltip (M6) —
  "Sorted by winrate; players with no decided games sink to the bottom" — since the column visibly
  shows a W/L count but actually ranks by rate; each cell's W/L text (already tinted by that rate)
  now also appends a dim mono `· NN%` showing the exact number sorted on, so two visually similar
  rows that sort apart (e.g. 9W 7L vs 8W 6L) are no longer indistinguishable. Search, a **relation**
  chip row (M6: `Any / Played with / Played against`, its own `playerRelation` pref) and a **min.
  games** chip row (`1+ / 2+ / 5+ / 10+`, its own `minPlayerGames` pref) narrow the list; the sort
  choice persists as `playerSort`. Relation filters SERVER-side (`selectPlayers`, over the whole
  matched set before the cap, same as the floor) — `with`/`vs` keep only rows with at least one
  DECIDED game on that side (a relation known but all-draw side has nothing to show, same
  treatment as no relation data at all). The **Last seen** cell carries a dim `with`/`vs` suffix
  (M6, `PlayerListRow.lastSameTeam`)
  — the team relation of that player's most recent shared game whose feed reported a team for
  BOTH rows, which is not necessarily the same game `lastSeen` itself is from if a later game's
  teams went unreported; absent (no suffix) when no shared game ever reported one.
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
- **Seeded from elsewhere (`ViewParams.search`, M5):** the command palette's "Find player
  `<q>` on Players" fallback (and anything else that wants to land here with a query already
  typed) navigates with `{ search }`; the box seeds from it and triggers the normal load on
  arrival. Applied at most once per distinct navigation — a background re-render never
  re-overwrites a search the player has since edited or cleared themselves.
- **Six empty states**, distinct because they have different causes and different fixes:
  nothing tracked at all · no games in scope · games but no rosters · rosters but no names ·
  the floor hid everyone · search found nothing. None may read as "you have met nobody", and
  the search miss offers **Search all time** rather than implying they don't exist. The floor-hid
  and search-miss states name the relation filter too when one is applied (M6, `p.appliedRelation`
  — the payload's own echo, same discipline as `appliedMinGames`) and offer **Show any relation**
  alongside **Show 1+**/**Clear search**.
- **Identity merging is surfaced, not hidden.** Players are keyed on the lowercased name before
  `#`, so `Nova#1111` and `Nova#2222` fold into one row; such a row carries a `⚠` marker (a hover
  tooltip explains the merge rule). Whenever at least one VISIBLE row carries it, the screen's own
  hint line also states once (M6) "⚠ = more than one BattleTag shares this name" — the marker
  used to explain itself only on hover, with nothing naming it in prose anywhere on the screen.

## The player drill-down — layout & behaviour

- **Head:** the player's name, then `N shared games, all time · last seen · W/L · WR`, with the
  teammate/opponent split beneath. "All time" is load-bearing wording — the games-count clause
  stays the lifetime total even while the W/L/WR clause reflects the active filter chip below
  (M6): the two can legitimately disagree (e.g. "51 shared games, all time · 6W 6L · 50% WR"
  once narrowed to "With you") — the record is what the chip claims to be narrowing, the count
  above it is not. Carries `· on <account>` (M6) when every shared match was on the same one
  account (`sections`' `singleAccount`, computed over the lifetime match list, same source that
  gates the Account column below).
- **Name-collision note** (M6, `collisionNote`): when `PlayerMatchHistory.tags` (every distinct
  `#`-tagged BattleTag seen under this identity) has more than one entry, a line under the head
  names them — "⚠ Matched by name — these games include Pixel#1234 and Pixel#5678." — instead of
  the Players list's bare hover-only ⚠, which never said WHICH tags collided or that this specific
  page might be more than one person.
- **"Who they are" band** (M6, `whoTheyAreBand`): their top 3 heroes by game count (ties broken
  by recency), each a chip with a role icon — "Tracer ×7 · Juno ×4 · Zenyatta ×3" — then a
  last-10 shared-result dot strip (`resultPill`, the same W/L/D colouring every other result pill
  in the app uses). Either half is omitted when its source data is empty; the whole band is
  omitted only when both are.
- **Filter chips** (M6): All · With you · Against you · Side unknown, filtering `d.matches`
  purely client-side (the whole all-time list already rode the payload) and repainting the head's
  W/L line and the table together. Nothing persists — the chips reset to "All" on every fresh
  visit to a player's page.
- **Shared-match table** (M6, `dataTable`, no `onSort` — the list is uncapped and already fully
  in the renderer, unlike Players' own capped page): Map · Mode · Side · They played · You played
  · Account · Your rank · When. Map/Mode/Side/Account/When sort locally on click (Side sorts on
  its own "with"/"vs"/"" categorical value); They played/You played/Your rank stay
  `sortable: false` — compound, rendered cells with no single scalar a header click could
  honestly order by. The sort is view-local and unpersisted, same as the filter chips above.
  Every row opens that match.
- **Account and Your rank are each OMITTED entirely** (M6) when they'd carry no information
  across the whole lifetime record — computed once over `d.matches`, never re-toggled by the
  filter chips: **Account** when every shared match happened on the same one account (the head's
  subtitle states it instead, `· on <account>`); **Your rank** when no row anywhere has an actual
  tier/division (every cell would otherwise just repeat the same blank). Dropping "Your rank"
  replaces the usual per-cell-estimate footnote with `noRankColumnNote` — one sentence naming
  the DOMINANT reason across every match (open placements, before a reset, no rank anchor, no
  reading since a reset, or "none of these matches were competitive"), plus a **Set a rank
  anchor →** link to Settings → Accounts specifically when that dominant reason is "no anchor" —
  the one case actually recoverable from here.
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
