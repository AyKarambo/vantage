# Changelog

What changed in Vantage, written for the people who use it — what you'll notice, not which
pull request landed. The app shows these in **Help → What's new** after an update, so keep
entries short, plain, and about impact.

**Maintaining this file**

- Add to **Unreleased** as you go; `npm run publish:release` computes the version from the
  commits, so the heading is renamed at release time (see [docs/overwolf-submission.md](docs/overwolf-submission.md)).
- User-visible changes only. Refactors, CI and docs don't belong here — the GitHub release's
  auto-generated notes already list every PR.
- Be straight about known gaps; Overwolf's guidance asks for transparency about what's still broken.

Releases before 0.32.0 predate this file. Their notes are auto-generated per PR on the
[Releases page](https://github.com/AyKarambo/vantage/releases).

## Unreleased

### Changed

- **Ranks are written short where the screen is tight** — `G3`, `GM4`, `C2`, first letter plus the
  division (`GM` for Grandmaster). You'll see it in the sidebar, the Rank tile on Overview, the
  account switcher, the per-role chips in Settings, and the *Rank at start* column on Matches.
  Everywhere with room to spare still says `Grandmaster 4` in full — the match detail, a player's
  page, the manage-ranks dialog, and every rank picker — and the sidebar keeps the full name in its
  tooltip. Replaces the older half-measure that only shortened Platinum, Grandmaster and Champion.

### Added

- **A Players screen.** Everyone you've met, in one searchable list — sort by how often you've
  played together, your record with them, your record against them, or when you last saw them,
  and hide the one-offs with the **min. games** chips. The counts follow the filter bar; opening
  a player still shows their complete all-time record. It answers to **Ctrl+0**, and every other
  screen keeps the number it already had.

- **Back actually goes back.** Every screen you've drilled into now has a `←`, and **Esc**,
  **Alt+←** or your mouse's back button do the same thing. Following a chain — a match, then a
  player, then one of their matches — walks back the way you came instead of dumping you on the
  Matches list every time.

- **The rank you went into each game with, on a player's page.** Their shared-match list is now
  a table: what they played, what you played, on which account and role, and your rank at the
  time. Ranks we recorded at the time are shown plainly; ones we had to reconstruct are marked
  `est.`, and a game we can't honestly place — during placements, before a rank reset, or on a
  track with no rank set — is left blank with the reason rather than filled with a guess.

- **The sidebar collapses to an icon rail** — the small `«` button beside the account chip at
  the top of the sidebar, or **Ctrl B**. It sticks between launches. Each icon keeps its name as
  a tooltip, and the Review count becomes a dot. Handy on a small screen, or whenever you'd
  rather have the room.

- **Every match remembers the rank you went into it with.** Your history now shows where you
  stood when each game started, so you can read a session back and see the climb (or the slide)
  match by match rather than only today's number. It appears on the match detail page, and as a
  **Rank at start** field you can turn on in **Matches → Customize view**.
  It's a snapshot, taken when you record that match's ±% — so correcting an older game later
  never rewrites what a newer one says you had at the time. Matches with no ±% recorded show
  nothing: without one your rank didn't move there, and repeating the previous match's number
  would look like evidence Vantage doesn't actually have.
- **A Live screen** for the match you're in right now. It shows the scoreboard the game is
  showing — heroes, eliminations, assists, deaths, damage, healing and mitigation, split into
  your team and theirs — updated as the match plays. A dot on the nav item tells you a match
  is running; the screen empties again the moment it ends, or if Overwatch closes.
- **"Players you've met", live.** Everyone on the current roster you've shared a game with
  before, with your record **with** them when they're on your team this match and **vs** them
  when they're against you. Click a name for the full history, same as anywhere else.
- **Damage and healing totals per team on the Live screen**, next to the elimination count, so
  you can see at a glance which side is out-damaging or out-healing the other. The side that's
  ahead on each line is the brighter one. These come from the game's own scoreboard rather than
  the kill feed, so they stay even with the kill feed switched off. The live scoreboard is also
  ordered like the game's: your team first, then tank, both DPS, both supports.
- **A live elimination count**, from the kill feed. Be aware of what this is and isn't:
  Overwatch's event feed reports **no objective score**, so Vantage counts eliminations and
  labels them as such rather than inventing a scoreline. If a running kill count while you're
  still in the game isn't for you, switch it off in **Settings → General** — that stops it
  being sent to the window at all, and leaves the scoreboard and with/vs records untouched.

### Fixed

- **"11W 5L together" wasn't your record together.** The player-history card on a match added up
  every game with that person regardless of side, then labelled it *together*. It now shows your
  real teammate record and your record against them as two separate figures — and a dash, not
  `0W 0L`, where the game feed never told us which side they were on.

- **Readiness no longer calls a hero you main "still learning" because an alt has few games on
  it.** The first-12-games exemption counted games per account, so 244 Genji games on your main
  and 6 on an alt read as *still learning Genji* whenever the alt came up. Hero experience is
  yours, not the account's: the count now pools every account you play. Your stat baselines stay
  per account, as before.
- **Destroying a turret or pylon no longer counts as an elimination.** Overwatch reports it as an
  ordinary kill — victim "Takigano", hero "Illari Healing Pylon" — so the live elimination count
  was inflated in every match. Those now read as *"Kirito destroyed Takigano's Healing Pylon"* in
  the feed, with their own marker, and don't count. Nobody died.
- **Revives name both players.** The feed said "someone revived a teammate" because a revive
  carries the supporter and the revived rather than an attacker and a victim; it now reads
  *"Kiriko revived Karambo (Reinhardt)"*.

- **The whole navigation fits again.** **Data** and **App** are now one **App** group (Notion
  sync, Logs, Settings, About and FAQ together — the split was never something you navigated
  by), and the rows are a little tighter, so every screen is reachable without scrolling at the
  default window size.
- **The "Current session" card no longer sits on top of the status bar.** With every screen the
  sidebar now lists, the navigation was taller than the space it had — so the card at the bottom
  was pushed straight out of the sidebar and over the status bar underneath it. The navigation
  scrolls when it doesn't fit; the account switcher above it and the session card below it stay
  where they are.
- **Readiness no longer nudges you to play more while you're in placements.** Every other screen
  ignores the SR change recorded against a placement match — the game shows no rank at all until
  the run finishes — but Readiness was still reading those numbers, and a flat-looking run could
  therefore be counted as "proven rank stagnation" and fire the play-more nudge, with a small
  score dip behind it. Placement matches now count as no evidence either way, which is what the
  rest of the app has always said about them.

- **New accounts are offered a placement run.** Vantage only ever offered one at a season reset,
  and only for a role it already knew your rank for — so a fresh account, or a role you'd never
  queued, was never asked. You had to know to press **Start placements** before your first ranked
  game, and every game you played before that was quietly left out of the run. It now asks after
  the first ranked match on any track it has no rank for, live-tracked games included (previously
  only hand-logged ones could raise the question at all).
- **Accepting a placement offer counts the games you already played.** The run used to start at
  the moment you answered, so the very match that prompted it fell outside its own run — you'd
  answer after your fourth placement and the dashboard would say 3/10. The prompt now says how
  many matches it will count before you accept.
- **Placements are reachable for a role with no rank.** Settings → Accounts only showed a row for
  roles it already tracked, and the Start buttons live on that row — so a role you'd never
  queued had no way in. There's now a **Start placements…** entry for those, and an open run's
  start can be **moved to a different match** if it was begun too late.
- **A ±% is no longer shown for matches inside an open run.** Overwatch shows no rank change
  during placements, and Vantage already ignored the stored value everywhere rank appears — but
  the Matches list still displayed it. The value is only hidden, not erased: cancel the run and
  it's back.
- **Renaming an account keeps its placement runs.** They used to be left behind under the old
  name, along with any declines.
- **Your rank updates the moment you record it.** Entering a skill-rating change — or setting
  your current rank — while grading a match on **Review** left the rank in the top-left corner
  showing the old number until something unrelated happened to reload it (changing a filter,
  alt-tabbing back in, or playing another game). It now updates immediately, along with
  everything else derived from it. Confirming your rank at the end of a placement run does the
  same, instead of leaving the corner stuck on "Placements 10/10".

### Changed

- **Per-10-minute stats now divide by the time you could actually play.** A match's clock
  includes the hero select, each round's setup lock and the scoreboard at the end — nobody can
  fight in any of it — so dividing by the full length quietly understated every rate against
  what the game's own career profile shows. The Heroes table, the per-hero card on a match, the
  readiness decline read and measured ⚡ target grades now use **played** time instead: measured
  from the game feed's round events on new matches, estimated from the wall clock on older ones
  (the card says *(est.)* when so), and taken as typed on hand-logged games. Match detail shows
  the played time next to the usual duration. Expect every per-10 number to rise a little. Two
  knock-on effects worth knowing: a measured ⚡ target grade on an older match can flip now that
  the divisor changed, so the next Notion sync rewrites those rows; and Notion itself has no
  played-time column, so a match re-imported from Notion falls back to the estimate even if it
  was measured here.
- **Hero win rates credit each hero by its share of the match**, like the in-game career
  profile. A hero you played for a quarter of a game earns a quarter of that game and of its win
  or loss, instead of every hero played getting the whole game. Game counts show the rounded
  credit; the Win % comes from the exact share. This applies to the Heroes table and the hero
  drill-down — the Matches list, map and role splits and target
  scoping still count whole games.
- **Readiness treats the account you play most as your main — and weighs an alt by how close its
  rank is to yours.** A second account near your usual rank counts in full; that's not smurfing,
  it's the same skill level on another account. Only once the gap gets real does it start to
  matter, tapering down to about a sixth (×0.15) of the read for a clearly lower-ranked alt. Your
  "usual" rank is the typical one you've held over the last few months, not just today's number,
  so one hot or cold streak can't move the goalposts. An account you haven't touched in weeks no
  longer counts as your main. The *"recent games span multiple accounts"* note now names your
  main account, and a quieter note appears whenever an alt shows up in your recent games.
  **Help → What moves the score** explains it under *Several accounts, one player*.
- **Settings → Accounts is a tidy list.** One row per account — name, game count and a compact
  per-role rank summary — with everything role-specific (set rank, placement runs, confirming a
  revealed rank) moved into a **Manage ranks…** dialog behind each row, instead of a block of
  buttons under every account. A finished placement run now offers **"Redo placements"** and
  **"Remove placement record"** in place of the open-run actions — "Change start match…" only
  makes sense while a run is still counting, and re-picking a finished one's start behind a
  confirm was more confusing than useful.
- **The sidebar's collapse control is now its own bar directly under the account chip** — bigger
  and harder to miss than the small corner glyph it replaces — and **Current session** is still
  the bottom card. With nothing pinned the chip says **All accounts** (it used to borrow the name
  of whichever account you'd played most recently) and its rank line names the account it
  belongs to — *Karambo · Dmg · GM 4 · 16%*. The account switcher is wider and lines up as
  check · name · rank, with the active account's per-role lines beneath it.
- **Winrate over time gets a rolling average**, the same treatment as the self-rating trend, so
  the general direction shows through day-to-day (or week-to-week) noise.
- **Targets list and detail page.** The Targets list now shows each target in plain language —
  name, grading mode, hit-rate, and a one-sentence status (e.g., "Paying off — you win more when
  you hit it") — alongside an **Active** toggle, removing stats jargon from the overview. Click
  any row to open a dedicated **detail page** with the full breakdown: the rule, win-when-hit and
  win-when-missed rates, the **Focus Trend** panel (before/after winrate with a rolling chart
  and table toggle), and actions to **Edit** (pre-filling the builder), **Archive**, or
  **Delete**. Edit returns to the Targets list with the builder pre-filled.
- **Target library.** The builder's flat "Start from a template" chips are now a curated
  **Target library** card featuring ~18 entries grouped under **Mechanics · Macro · Strategy ·
  Training** — a decision-timing split — each with a visible coaching blurb and role tag. Pick
  one to prefill the builder.

### Added

- **A ⓘ next to a column header or label explains what it means**, e.g. Heroes' **RTG** column.
  Hover, focus with the keyboard, or tap it — it stays open until you click away or press Esc, so
  it works without a mouse and won't get clipped scrolling off the window's edge the way a native
  tooltip could.

### Fixed

- **The colour-blind and teal & coral palettes didn't reach the whole app.** Overview's map
  scatter chart still drew its "below 50%" focus band and dots in the default red/purple no
  matter which palette Settings → Appearance had picked, and a chart point's tooltip needed a
  mouse — it's now reachable by keyboard too.
- **A stale-data link, hybrid/dev badges, banter-tone comms and a log warning now share one
  consistent amber**, instead of five slightly different ambers that happened to be picked
  separately — and it stays that amber regardless of which winrate palette you're on, since none
  of those are a win/loss signal.
- **A table's sort arrow could point the wrong way.** Clicking a numeric column header sometimes
  ordered rows opposite what the ↓/↑ next to it showed.
- **Heroes with nothing to show now says why.** Choosing a higher **min. games** filter than any
  hero clears, or a date range with no games at all, used to leave just the header over an empty
  table. It now explains which one happened and offers a way back — **Show 1+**, or **Show all
  time** when you've got history outside the current range — matching how Overview, Matches and
  Players already handle it.

### Changed

- **The sidebar is grouped by moment, not by kind.** **Now** (Overview, Live) · **After the
  session** (Review, Matches, Players) · **Improve** (Focus, Targets, Mental, Readiness) ·
  **Reference** (Heroes, Maps, Trends) · **App**. Replaces Workspace/Insights/App, which split
  Focus and Targets — one workflow — three items apart and put Readiness, which ignores the
  filter bar, under the same "Insights" label as screens that don't. Every **Ctrl+1…0** shortcut
  stays exactly where it was.
- **The filter bar says why on a screen it doesn't apply to**, instead of just disappearing —
  Readiness, Live, About, FAQ and a player's page. It used to vanish outright, which both yanked
  the page up by its height and left "where did the filters go?" unanswered.
- **A screen keeps its own width now**, instead of five different ones bolted on ad hoc (or none
  at all, stretching edge to edge on a wide monitor). Review, Targets and Notion sync stay a
  comfortable single-column read; Heroes and Matches, whose tables want the room, get more; every
  other screen gets a shared middle width, centred.

### Fixed

- **Dragging across a name, map or player couldn't select the text** (issue #197) — the twelve
  spots that used a `<button>` for what was really a link (a match's map, a hero cross-link, a
  scoreboard name, "How is this calculated?", …) now use one that can be drag-selected, still
  reachable by keyboard.
- **Rows and sortable column headers were mouse-only.** Heroes, Players, Matches, Maps/Trends'
  table toggle, and a player's shared-match list can now be reached and opened with Tab and
  Enter/Space, headers included — a header also states `aria-sort` for a screen reader instead of
  only drawing an arrow.
- **A dialog or drawer never trapped focus or gave it back.** Tab could walk straight out into the
  dimmed sidebar underneath, and closing one left keyboard focus on nothing in particular. Every
  modal and drawer now moves focus in on open, keeps it there while open, and returns it to
  whatever was focused before, on close.
- **Heroes, Players, a player's page and Logs had two scrollbars fighting over the same wheel
  input** — an inner one for the table sized by a guess that drifted whenever the header wrapped
  or the GEP banner showed, and the page's own underneath it. Down to one, sized against the real
  space left, wheel input goes to the table you're looking at.
- **The Overview scatter chart's callouts sat far from the chart on a wide window**, with a
  growing dead gap between them — the chart stretched to fill the row even past its own 960px
  cap. It now stops growing with the chart instead of past it.
- **The `←` back button showed up on every screen after the first navigation**, since a plain
  sidebar click recorded the screen it left just like a real drill-down did. It's back to meaning
  what it looks like — "up out of a match, a player, or a target" — everywhere else, **Esc**,
  **Alt+←** and the mouse back button still reach the same history.
- **The collapsed sidebar rail's account chip and Review count had no tooltip.** Collapsed to
  icons, there was no way to check which account was pinned, or how many games were waiting, short
  of expanding the rail again.

### Added

- **Live, when nothing's running, is a pre-queue briefing.** This sitting's tally, the time-of-day
  read ("it's evening — you're 60% over 12 decided evening games"), your stop rule, your active
  targets, a readiness read, and your top-priority maps — instead of one sentence over empty
  space. On demo data, or without live tracking approved, it now says so and links to what's
  needed.
- **Live shows a "Just finished" card the moment a match ends**, with a direct link to it (and to
  Review, if it's still waiting to be graded) — instead of clearing the screen and leaving you to
  go find it yourself.
- **A combined stop rule.** "Your stop rule: end after game 3 or 2 losses in a row" — Mental, the
  Overview Mental card and the idle Live screen all now say the same thing, combining your tilt
  peak (or your winrate fade, when tilt has no clean read yet) with the break reminder's
  threshold. Offers to turn the reminder on when a stop point is readable but nothing's armed to
  back it up.
- **A heads-up when the game feed goes quiet mid-match.** Overwatch's events can stall for a
  stretch without anything actually being wrong — Live now says so next to the scoreboard it
  might affect, and every other screen gets the same word in the banner up top. The feed status
  popover leads with the last error (when there is one) instead of burying it at the bottom, adds
  the source and the loaded GEP package version, and a Logs / Alerts / Open Live footer.

### Fixed

- **The Mental "Calm"/"Tilted" bars had no unit and read like a pair that should sum to 100** —
  they're independent 0–100 reads, and now say `57%`/`31%` with the formula behind each on hover,
  and the card says so once. Every "What it costs you" verdict now says what "pts" means (winrate
  percentage points on the bad side of a flag) instead of repeating an undefined unit five times,
  and its bad-side percentage links straight into the matches behind it. The non-zero flag boxes
  below now look like the drill-downs they are — an accent border, a lift on hover, a trailing
  arrow — instead of being visually identical to the hero drawer's plain, non-clickable stat grid.

### Added

- **Mark older games as no-read.** A deep Review backlog no longer has to be graded one card at
  a time — pick an age cutoff (older than 1 day / 7 days / everything), see a live count of how
  many that will clear, and confirm. It's a real bulk clear, not a delete: the games stay in your
  history, just off the inbox and the badge, and a 12-second **Undo** puts every one of them
  straight back if you change your mind.
- **The sidebar's Review count is a recent queue, not a lifetime backlog.** It now shows how many
  tracked games need your read from the **last 7 days** — the number that used to sit there only
  ever grew for anyone playing regularly, which stopped meaning "anything to do tonight?" and
  trained people to stop looking at it. Hover it for the full lifetime total; the Review screen's
  own subtitle still states that in full.
- **See the climb.** Trends now plots rank over time — one line per tracked account/role, above
  everything else on the screen. It's drawn from what you already recorded (rank snapshots and
  every SR change), not a guess: a stretch with no known rank — an open placement run, a match
  before a rank reset — shows up as a real gap in the line rather than a smoothed-over guess, and
  a hollow point marks one reconstructed from your history rather than recorded or calculated
  directly. The Overview Rank tile now also states how much you've moved since your anchor
  (`▴ +38% since anchor · 16% in division`), not just which direction the arrow points.

### Added

- **Every "open this map" click now takes you to that map's actual games**, not a flash on the
  Maps ranking table. The Overview scatter and its Top-priority callouts, the Live screen's
  priority card, a hero drawer's By-map rows, Focus's map rows, and the command palette's Map
  entries all now open Matches scoped to that one map, with a dismissible `Only <map> ✕` chip
  above the list — the same drill-down chip Matches already had for a day or a mental flag.
  Focus keeps a smaller secondary **↗ Maps** link next to its own map rows, since "how does this
  map look overall" is still a distinct question there.
- **The hero drawer explains its own numbers.** A role icon sits next to the hero name, and a new
  line states the filter scope in plain words ("all roles · last 30 days · all accounts") so the
  stats are never mistaken for the hero's all-time record. **By map** now breaks ties by winrate
  after games (the common one-game-per-map case used to read as random order) and shows `W`-`L`
  instead of a bare game count. **Recent** games are clickable straight into that match's detail
  page instead of being inert text.
- **The Heroes table says more with the numbers it already has.** A **W-L** column, a played
  **Time** column (a low game count on a lot of minutes is a steadier sample than the same count
  on quick swaps), and a **Trend** column (▴/→/▾ — recent games vs earlier ones, same read Focus
  already gives its maps) so "is my Genji getting better this season?" no longer needs a drawer
  open per hero — and the drawer itself now opens on a **Last 10** form strip (one W/L pill per
  decided game plus the trend arrow and the delta vs the full range) for the full read when you
  do open it. Eliminations/Deaths/Assists per 10 now show their real decimal (`5.6` and `6.4`
  used to both round to `6`) — same fix applied to the hero drawer's stat grid and the match
  detail per-hero card. There's no hidden games-floor or row cap left upstream of the **min.
  games** chips either, so a 1-game hero now shows at the default 1+ and appears in the command
  palette's Hero entries, matching how Map entries already include every map. An **ⓘ** beside the
  chips spells out how the per-10/time-share/Time numbers are computed, in one place.
- **Focus ranks roles and heroes too, not just maps.** Three short sections — Roles, Heroes,
  Maps — each ranked by a sample-aware deficit score instead of raw net, so a real, well-evidenced
  weakness (a bad winrate over a big sample) outranks a same-sized deficit that's really just a
  small, noisy one. A map row now also shows its top heroes' own record ("with Genji 1-4 · Tracer
  0-2") and, if it's outside the current competitive rotation, an **"Out of pool"** tag — the same
  tag now appears on Overview's Top priority callout. A hero row opens that hero's drawer; a role
  row opens Trends scoped to it. **＋ target** now pre-fills the builder's role/hero scope for a
  hero or role entry, not just the name.
- **The Overview scatter is legible with a full map pool.** Dots are coloured by **game mode**
  (7 stable hues) instead of a per-map index that repeated every 11 maps — with the demo's ~30
  maps every colour used to be shared by three unrelated maps, and the legend couldn't identify
  any of them. The legend now shows one swatch per mode present, not one per map. Every "focus"
  dot (net ≥ 3 — the ones the card tells you to "fix first") carries an always-visible short-name
  label, and the X axis gets three numeric ticks with faint gridlines alongside its caption.
- **The post-session recap follows your actual sitting, not the UTC calendar day.** It used to
  key off "yesterday" — a sitting that ended two hours ago got no recap, one that spanned
  midnight split across two days and two tallies, and a player west of UTC found their evening
  games filed under the next day. It now debriefs the same gap-based sitting the sidebar's
  Current-session card tracks, the moment it closes. The card adds SR change and a "Review these
  N games →" link for whatever's still ungraded, and its target hit-rate now folds in active
  **measured** auto-grades alongside self-rated ones, not just the latter. Dismissing it collapses
  it to a one-line reopen instead of hiding it until the next sitting closes. The sidebar's own
  Current-session card now names its actual rule when empty ("No games in the last 3h — your next
  game starts a new sitting") instead of a bare "no session yet", shows your streak and top map
  when a sitting is running, and is a real click-through into that sitting's games.
- **Matches can group by sitting, not just by day.** A "By day / By sitting" toggle in the view
  head (hidden while a single day is already drilled into) — sitting grouping uses the same
  gap-based boundary as the sidebar's Current session card, so a sitting spanning midnight stays
  one block instead of splitting under two day headers, each with its own W-L tally; a sitting
  header also states its net SR swing when the sitting logged one. The current-session gap
  setting (Settings → Coaching) now spells out which surfaces it governs.
- **The Logs screen can actually help you find something.** A scope filter (gep/main/notion/
  pipeline/renderer), a text search across the full formatted line — including `key=value`
  fields, not just the message — a UTC/local-time toggle, and **Copy visible** / **Save debug
  log…** for whatever's currently filtered. The feed now starts tracking the moment the app
  launches, not just once you first open Logs, so Settings → Diagnostics can show an honest
  "N errors · M warnings this session" instead of nothing — an accent pill once there's an
  error, one click into Logs already filtered to it — and the sidebar's Logs item picks up a
  live dot the moment one is logged (warnings alone stay quiet; they're routine).
- **Net SR shows up beside net wins.** Maps' mode cards and its "Winrate by map" table, the
  Heroes table, and Focus rows all gain a **±SR** figure alongside the games/net-wins tally you
  already had — a 3-loss map that cost −60% is a more urgent fix than one that cost −45%, and
  the SR data was already being recorded, just never summed anywhere but the rank tile. It's
  purely informational: rankings and sort orders are unchanged, and it reads "—" rather than a
  misleading `0` wherever nothing in range logged a change. A placement run's SR swing is
  excluded from the sum everywhere (its games still count toward everything else) — a
  placement's SR isn't comparable to a normal match's.
- **Trends' winrate chart is actually clickable, not just cursor-pointer-flavored.** A point (in
  daily mode) or its Table row now opens that day's games on Matches — the hit target already
  said "click me" with its cursor, it just never did anything. A new **best day / worst day**
  pair under the chart surfaces the single calendar day with the highest/lowest net wins −
  losses anywhere in range, each clickable the same way. The self-rating chart got the same
  click-through. The Overview **Streak** KPI's second line stopped crying wolf on every single
  loss — "reset it" now only shows once the streak reaches your actual break-reminder threshold;
  below that it shows the current sitting's tally or how long ago you last played instead, and
  a hover on the tile states the range's best/worst streak for context.
- **A winrate-derived rank guess no longer looks like a measured one.** With no rank set, the
  match detail's Competitive progress card used to draw a full division bar and an "over the
  range" delta (not a number the game ever shows) in the exact same styling as a real
  calculated rank. It now shows the tier/division in muted text under an honest **"Estimated
  from winrate"** pill, drops both fabricated numbers, and adds a **"Set your rank…"** button
  straight into the same Manage-ranks dialog Settings uses. A match from before your last
  ladder reset — which used to show a raw, untranslated `pre-reset` pill — now reads **"Before
  reset"**. The Overview Rank tile gets the same honesty pass: an unanchored account shows
  **"E3 est."** with a plain "from winrate — no rank set" line and its own **Set rank** button,
  instead of a movement arrow glued to an unrelated number (the arrow stays reserved for a real
  anchored rank). The Winrate KPI's delta now says which window it means — "▾ 16 pts · last 5
  days" (or weeks) — instead of a bare "recent".
- **Overview's subtitle says something, not just your winrate.** It now leads with whichever
  read is strongest right now — a real rank swing, a role costing you net losses over a real
  sample, or a late-session fade — instead of the same "here's where the points are hiding"
  line every day regardless of what's actually going on. A **"Why →"** link jumps straight to
  the screen that explains it (Trends or Focus). With nothing strong enough to say, it falls
  back to "No strong signal yet — keep logging."
- **The winrate chart's bold line is now the 7-day average it claims to be.** It used to smooth
  the last 7 *buckets*, so a few-evenings-a-week schedule stretched "7-day" across two and a
  half calendar weeks, and it averaged each day equally, so a single-game day swung it as much
  as a 12-game one. It's now a real trailing calendar window, weighted by the games actually
  behind it — same fix applied to the self-rating chart's line and its Table's new **7d avg**
  column. Trends also states the momentum in numbers now, not just a line to eyeball: a strip
  above the chart reads last-window winrate, the window before it, and the signed point
  change — 7 days normally, 4 weeks once the chart itself switches to weekly buckets.
- **Compare this range against the one before it.** The Overview Winrate and Games KPIs each
  gain a second line — "vs 2026 Season 3: +3.2 pts", "vs the previous 30 days: +12 games" —
  instead of only a smoothed within-range wobble. The Heroes table gains a sortable **Net**
  column (losses − wins, so "sort by what costs me most" is one click) and a sortable **Δ WR**
  column against the same previous window, greyed rather than hidden under a 5-game floor on
  either side, plus a hint line naming the hero costing you the most right now alongside its
  role's overall winrate for context. A hero's drawer also gets a **＋ target** action that
  opens the builder already scoped to it. Absent on "All time" — there's nothing before
  everything — or when the active season has no earlier entry with data.
- **Readiness stopped contradicting itself.** A calm, on-habit streak — "31 days in a row" with
  no real volume spike — used to render as a red-severity signal next to a green "Steady"
  verdict, because the signal read straight off the day count while the score's own streak
  penalty is volume-gated and never actually charged for it. The signal now reads 'high' only
  when the streak genuinely cost the score something (otherwise: "a calm habit, but a rest day
  still helps"), a signal's colour is a function of the actual verdict too (a fired-but-offset
  load streak reads amber under a green band, not the same red a real "loaded" verdict gets),
  and a "Steady"/"Fresh" headline now says so explicitly when a load signal still fired — "Steady
  — results are holding, but 23 days without a rest day is worth a break" — instead of a flat
  "nothing flagged" beside a signal that read as its opposite. The **"What moves the score"**
  card now shows the live arithmetic ("75 − 4 + 0 − 3 = 68") with diverging bars centred at 0
  and each family's real (asymmetric) weight range, the trend chart draws faint per-day game
  columns and a hollow dot for a day you didn't play, its reference lines sit at the actual
  fresh/loaded cuts instead of a plain 0/50/100 grid, and every card now deep-links its own wiki
  article via a **"?"** (previously only Verdict did).
- **A long history reads clearly on Trends.** The winrate chart's weekly ticks used to read
  "W13 · W23 · …" with no year anywhere — they're now the week's real Monday date, and the
  Table's Week column matches. The year prints once at each boundary instead of never. Thin
  markers now label every season (and ladder reset) the chart crosses, so "All time" is more
  than an unlabelled wall of points. Hovering a dense chart no longer steals the tooltip from
  whichever point was drawn last — each point's hit target now shrinks to fit its neighbours
  instead of overlapping them. A new **By season** card answers "how did each season go" in one
  place — click a season to jump straight to it — instead of ten filter changes and ten
  memorised numbers.
- **Log a match from anywhere with Ctrl+L.** Logging is the app's primary write, but the only
  routes were the Overview greeting button, two empty states, or the palette (Ctrl+K, then
  typing or picking "Log match", then Enter). The titlebar's search pill now splits into
  `Ctrl K · Search` and a real `+ Log match · Ctrl L` button beside it, and Ctrl+L opens the
  log dialog directly from any screen — the intro tour and the palette's own hint now say so.
- **The log card actually fits.** Its header and Save row now stay on screen (sticky top/bottom)
  on a card taller than the window, instead of the whole card scrolling as one block with the
  Save button off the bottom — the same fix applied to the match editor's Save/Cancel row. The
  rarely-changed **Account** field moved into the header; **Played** (the backfill control) moved
  next to Targets on the right, out of the way of the fields you touch on every log — Result,
  Map, Role, Heroes and Skill rating now run straight down the left column. The skill-rating
  wheel nudge takes **Shift for a ±5 step**, not just ±1 (a full ±25 swing used to take 65 scroll
  ticks to dial in by hand), and the same nudge now also reaches the placement-completion
  dialog's % field, which previously had none at all. "Save & next" reads **Ctrl ⏎**, not the
  macOS **⌃⏎** glyph this Windows-only app never should have shown.
- **The post-save toast actually says what happened, and you can undo it.** It used to read
  "Match logged — Win · Oasis" — no account, no role, no ±%, no way back — so fixing a mis-logged
  game meant Matches → the row → ⋯ → Delete → confirm. It now reads "Match logged — Win · Oasis ·
  Climb Damage · +25%" with an **Undo** action (skipped only when the save also set a first rank
  anchor or a placement prediction, since undo can't unwind those). When logging also switches
  which account the dashboard is scoped to, a short "Now showing `<account>`" toast says so — that
  used to happen with zero notice. A hand-logged match no longer also fires a Windows notification
  for something you typed a second ago and are already looking at.
- **The map field understands a typo, and the hero grid is never empty.** Typing a near-miss map
  — "kings row", "esperanca" — used to empty the field on blur with no message; matching was
  prefix-only, so a missing apostrophe or accent found nothing even though the app already had a
  fuzzy matcher for the command palette. The map field now ranks its search by that same fuzzy
  matcher (now accent-folding both ways too), auto-resolves a typed value that uniquely matches
  one map, and — failing that — **keeps what you typed** instead of silently reverting to blank,
  with the "not a known map" hint shown immediately rather than only after a failed Save. A fresh
  account, or a role you've never queued, no longer opens the hero picker to an empty grid either
  — a short "most played" shortlist now pads out with the rest of the eligible heroes.
- **Grading a game you already know the read on is a couple of clicks, not a full card.**
  Review's collapsed rows now carry inline **H/P/M** chips for their self-rated targets plus a
  **Tilt** toggle — grade them right there and the game saves and clears itself; SR, performance
  and comms still live behind the full **Grade** card for when you want them. **Skip** on an open
  card now opens the next pending game and scrolls to it, instead of just collapsing and leaving
  you to find it yourself, and three new keys cover the rest of the loop: **N** skips, **T**/**X**
  toggle Tilt/Toxic mates.
- **Review groups your backlog by day.** Rows now sit under day headers — "Yesterday · 2 games
  · 1-1" — instead of one flat list of 150 identical rows with only a relative time to go on.
  Today's games stay open; older days start collapsed and each gets its own **Mark as no-read**
  for clearing just that day. Once you're a few games into a session, the subtitle switches from
  a plain count to "**7 of 12 graded this session**" — the same backlog, framed as progress.
  Every row and card now also names the **account** the game was played on, and the
  skill-rating section says which track its ±% moves — the corner rank chip used to be the only
  place that told you.
- **Review and Matches link both ways.** A Review card's head gets an **Open match ›** link
  straight into that game's full detail page (round score and duration ride along on the meta
  line when the game reported them); an ungraded row's **⋯ menu** on Matches, and the detail
  page's own header, both gain a **Grade on Review** action that opens straight to that match's
  card instead of making you re-find it in the inbox. The row menu also gains **Edit match…**,
  and the detail page's header gains its own **Delete match**, matching what the row menu
  already offered. A measured target with nothing to show on a given game now folds into one
  muted line instead of a dead row per target, and the active-targets strip labels a measured
  target **auto**, a self-rated one **manual**.
- **Targets opens on your targets, not a blank form.** With a live set already in place, the
  page now leads with **Active focus** and **Your targets** — the actual daily question — and
  the builder collapses behind a **"＋ New target"** button; opening it starts on a genuinely
  blank name field instead of a real-looking placeholder example one accidental Save away from
  becoming a real target. The role/hero **scope** picker is collapsed behind a one-line
  "Applies to: any role, any hero · Change" summary too, instead of always painting the full
  hero grid. The **Target library** gains a filter chip row (**All / Tank / DPS / Support /
  Measured only**), marks an entry you already have **"✓ in your targets"**, and adds a
  one-click **Add** beside the existing "Customize" — save an entry exactly as written, with a
  toast offering **Edit**. **"Start a fresh focus"** is undoable now too, same as Archive.
- **Targets stops guessing at "does it move your winrate?" and just answers it.** Each row now
  gets a signed **lift chip** next to its hit-rate — "+18 pts when hit" — coloured green when
  it's real, red when it's negative, muted in between, and shown only once both the hit and
  missed sides actually have games behind them. The detail page's win-when-hit/when-missed bars
  now state their own sample size ("62% · 12 games") and read an honest "— · no games yet"
  instead of quietly drawing a bar from your overall baseline when a side has none. The one-line
  status sentence is driven by that same real lift now too, once there's enough evidence on both
  sides — "Worth keeping — +18 pts when you hit it (21 games)" or an honest "No effect yet";
  hitting something on near-total autopilot instead reads "Habit is set — rotate it out", ahead
  of any lift read.
- **Measured targets suggest their own threshold from your own games.** The builder's Measured
  pane now shows **"Your usual: …"** under the rule — your median for that stat over your last
  30 games, honoring whatever role/hero scope you've set — with **Use median** / **Use +10%** /
  **Use my average** buttons that write it straight into the threshold field; it updates live as
  you change the stat or scope. The **Target library**'s measured entries get the same treatment
  before Customize or Add saves them — a fixed "~9k/10 is a solid DPS floor at most ranks" is
  equally wrong for a GM Genji and a Bronze Reaper, so both now personalize the number first when
  you have the data for it, and **Add**'s toast says "— adjusted to your last 30 games" when it did.
- **Target detail shows the games behind the numbers, and scope stops being invisible.** The
  detail page gains a **"Recent attempts"** card — your last 10 games with this target, newest
  first (date · map · result · grade · the measured value when it has one), each one opening
  that match. A scoped target now shows a compact **scope badge** (role icon + "Tank" / "Zarya,
  D.Va" / "Support · Ana") on its Targets row, its detail page, and its grade row on Review — and
  an out-of-scope self target on a Review card leaves a muted "1 target skipped — scoped to …"
  line instead of just silently not showing up. A demo target and an archived one used to share
  the same "not live and tracking yet" line under the Focus Trend panel — each now gets its own
  honest reason there's nothing there. The page's own head now says "Targets," matching the nav
  item and everything else on the screen.
- **Targets can be scoped to a map, and Focus says what its quick-create button actually makes.**
  Scope now takes one or more maps alongside role and hero — a target scoped to Ilios only grades
  your Ilios games, and the scope badge shows it ("Support · Ana · Ilios"). Focus's quick-create
  button is now **Track as target**, and clicking it opens a small popover naming what it's about
  to create and what tracking commits to, instead of silently creating a target and jumping away
  the moment you click. Focus also links a row to its target by that scope directly now, not by
  guessing from the target's name — so renaming a target, or writing one whose name doesn't spell
  out what it's for, no longer breaks the "since you flagged it" progress line.
- **Demo mode stops accepting writes that silently do nothing.** Grading a demo game on Review,
  editing one from a match's own page, or deleting one used to look like it worked — a toast said
  "Review saved" or "Match updated" — but nothing was ever actually stored, and the game was back
  on restart. Review now leads with a plain notice while demo games are showing ("grading here is
  practice only"), its subtitle and sidebar count say **demo games** instead of tracked ones with a
  muted badge instead of the usual accent pill, and every save now says so honestly — "Not saved —
  "Ilios" is a demo game" — instead of claiming success. Grading and editing demo cards still work
  as a sandbox to try the flow in; they just never pretend to keep it.
- **Settings gets a section rail, and the Coaching card explains itself.** A row of jump links —
  Accounts, Quick Log, Coaching, App behavior, Appearance, Diagnostics, Data storage, Import — sits
  right under the page head; click one and it scrolls to and flashes that card, and About's "Data
  storage location →" and the FAQ's "See the exact folder in Settings →" now land you straight on
  it instead of the top of a long page. Inside Coaching, each of the six editors — Quick Log (now
  folded in here instead of its own separate card), Break reminder, Readiness coach, Target
  rotation, Current session, Grading margin — gets its own heading, a one-line hint naming what it
  actually affects, and a "See it on X →" link to the screen it governs, instead of five unlabelled
  controls stacked in a row.
- **Master Data says when it last checked.** The "Update from online source" card now states "Last
  checked 3 weeks ago · OverFast API (community mirror of Blizzard data) · nothing about you is
  sent" — naming the source and what leaves your machine, which it never did before — and nudges
  you to check again once that's over 60 days old or has never happened.
- **Your first tracked game gets announced, not just silently swapped in.** The moment demo data
  yields to a real one, a toast says so — "Your first tracked game is in — the demo season retired.
  Everything from here is yours." — instead of 149 sample games, four sample accounts and a handful
  of sample targets quietly vanishing with nothing said about it. Overview also shows a one-time
  card naming the sample-size floors coming up (3 games on a map for Focus, 5 flagged games for
  Mental's cost breakdown, 15 games over 14 days for Readiness) until you dismiss it or clear them.
  An account filter pinned to a sample-only account resets to "All accounts" automatically instead
  of quietly pointing at one that no longer exists. The status bar stopped saying "demo data" twice —
  once in its own text, once in the sidebar badge — and that badge is a real, clickable button now,
  titled "Sample season — click to turn demo data off" and taking you straight there.
- **Every "not enough data yet" message now says exactly what's needed.** Readiness used to render its
  Training load card anyway once your history was too short — "0 games/day · 1.00× vs baseline" —
  reading as a real measurement instead of the placeholder it was; it's now replaced with an
  "Unlocking readiness" card showing your actual progress (e.g. "3 of 15 games · 2 of 14 days"), and
  the trend chart stays hidden until there's enough of a line to draw. Mental's cost breakdown used to
  print raw counts past their own floor once only one side had cleared it ("12/5 calm"); every row now
  clamps each side to a check mark the instant it's individually met. Focus and Overview's "Top
  priority" panel used to celebrate a "clean season" identically whether you were actually doing well
  or just hadn't logged enough games on any map yet — they now tell those apart. Maps' "3+ games"
  subtitle used to keep claiming a floor it had silently abandoned once no map reached it; it now says
  so, with a progress readout for your closest map. Trends' "log more games" lines on Time of day and
  Game # in session now state the real gate and your progress toward it, and stop blaming sample size
  once there's actually enough data and the honest answer is just "no pattern found."
- **Matches says when the list is capped, and lets you reach older games.** A busy range past 150
  games used to show "150 games in range" while the status bar right beside it said the true, larger
  number — now the header reads "Showing the 150 most recent of 412 games in range," a **"Show older
  games"** button appears under the list, and clicking it loads the next 150 without losing your
  place. A match's detail page couldn't even be reached past game #150 before; its own "n / 150"
  stepper now reads "n / 150 loaded" so it's honest about what's actually loaded there too.
- **Matches can be filtered right there, not just by the global controls.** A new filter row —
  result chips (**W / L / D**), map-type chips, and a search box matching map, hero or account —
  narrows the list instantly without touching the Role/Season filters above it, with a **"Clear
  filter"** link and an honest count ("50 of 150 loaded games match your filter"). It resets the
  moment you leave the screen, so it never lingers as an invisible reason a later visit looks
  short. Searching while there's more history to load still reaches it — **"Show older games"**
  carries your filter into the fetch, so paging in older games while searching returns a full page
  of actual matches instead of mostly rows you'd immediately filter back out.
- **Day headers count draws and show the day's own SR swing; rows show a clock, not a repeated
  age.** A day with a draw used to lose it from the count — "2–1" for a win, a loss **and** a
  draw — and never showed its own SR change even though every row carries one; headers now read
  "2–1–1" when there's a draw, and the day's net SR ("+38%") sits beside the tally, tinted red or
  green, in place of a flat "−1 net" that just restated the subtraction you could already see. Each
  row now shows the clock time it happened ("9:34 PM") instead of a relative age that read "1d, 1d,
  1d" three times in a row under a header already saying Yesterday — hover a row for that age if you
  still want it. Opening a single day states its own honest count ("6 games on Sat, Sep 12 · 4–2")
  instead of generic range copy repeating the date you just picked, drops the now-redundant second
  day header, and the chip gets **‹ ›** buttons to step to the day before or after without a trip
  back to Overview to re-click the heatmap. A flagged-games drill-down (Tilt, Leaver, etc.) gets the
  same honest count too — "46 tilt-flagged games in range."
- **A match's own page links out, states when it happened, and steps through your day.** The map
  name, the account and every hero pill on the detail page now open Maps, filter to that account, or
  that hero's drill-down — the row already linked all three, so the richest page about a match had
  fewer exits than its own row. The header states the actual date and time ("Friday, September 18 ·
  11:38 PM") instead of just a relative age. Between the Older/Newer buttons, a small strip of W/L/D
  letters now shows where this game sat in its own day — "Game 3 of 7 · Yesterday · 4–3" — each one
  clickable straight to that match, instead of five blind "Older" clicks to reach yesterday's fifth
  game. The scoreboard gets a **team totals row** (E/A/D/DMG/HEAL/MIT, brighter on the team ahead),
  and the "best in this column" highlight on Deaths now means **fewest**, not most — it used to
  paint whoever died the most in the same green as top damage.
- **Ctrl+K finds a target, a player, or any match in your history — and can flip a Settings
  toggle for you.** The palette used to stop at your targets and players entirely, and its Match
  results at the 30 most recent rows in range — "did I play with Pixel?" meant Ctrl+K → Players →
  click the search box → type. It now lists every target and a handful of recent players
  directly, offers a **"Find player on Players"** shortcut for anyone typed in, and — once a
  query comes up thin — reaches into your **full** history for a map, hero, account, player name
  or date, under its own "All history" group. A new **Settings** section covers the toggles you
  actually reach for often — the MCP endpoint, the live kill feed, the break reminder, demo data,
  log debug detail, and the winrate colour scheme — each showing "currently on/off" and applying
  instantly, no trip to Settings required. Every screen in the palette now shows its `Ctrl+<digit>`
  right there, and the **`?`** cheatsheet no longer leads with Log-match/Review shortcuts ahead of
  the ones that actually matter most of the time — it's ordered Global → Navigate → Review → Log
  match, with `Ctrl+0` (Players) sorted after `Ctrl+9` instead of wherever it happened to land.
- **Backfill a game from further back than "2h ago" — and fix the time later if you got it wrong.**
  The Played chips on Log match stopped at 2 hours, so a session logged the next morning, or a game
  from 3-4 hours back, couldn't be placed honestly. A fifth **Other…** chip now opens a plain date
  and time picker (never later than now), and the header badge names the date too once the chosen
  moment isn't today. "Save & log another" carries that instant into the next form (instead of
  measuring "30m ago" from an ever-later "now" on every single game), so backfilling a whole missed
  session means picking the time once and nudging it forward from there. Once saved, the match
  editor can now correct it too — a **Played** field sits under Role, for a hand-logged match only;
  fixing it re-sorts the match everywhere its timestamp matters, including which day it falls under
  on the Matches list. The editor also finally caught up with the log card in three other ways:
  **Enter** saves it (it never used to), **↑ / ↓ / H / P / M** grade your active targets from the
  keyboard the same way Review does, and its header now matches the log card's own — a close **✕**,
  and the same `⚡ auto` / `◎ manual` badge with the time right on it.
- **The Maps mode cards actually do something now, and the ranking below finally uses the data it
  already had.** The six mode cards used to just sit there — click one now and the "Winrate by map"
  ranking filters to it (a new mode chip row does the same thing, and the two stay in sync), and
  each card states its own best and worst map in one line. The old fixed "3+ games" floor is now a
  **1+ · 3+ · 5+** chip row like Heroes and Players already have, and the subtitle says how many
  maps that floor is currently hiding. Every ranking row can now show a trend arrow, your average
  self-rating on that map, a flag for one with an active target tracking it, and a dimmed
  "out of pool" tag — all things the dashboard was already computing, just never shown here. A map
  you jump to from anywhere else in the app — the Overview scatter, a Focus row, a hero's By-map
  list, the command palette — always lands now, even if it's below whatever floor or mode filter
  you last left this screen on.
- **A match's per-hero card now says whether that was a good game for you, on that hero.** Each
  stat box (eliminations, assists, deaths, damage, healing, mitigation) gets a small **vs usual**
  line comparing it to your own trailing 30 games on that hero, colour-coded win or loss (fewer
  deaths counts as the win, same as everywhere else). A one-line summary under the card calls out
  the two biggest swings in plain language — "vs your usual on Genji: more eliminations (18.0 vs
  10.0), fewer deaths (1.0 vs 4.0)" — picked by how large the change is relative to your usual,
  so a big swing in eliminations isn't drowned out by an unremarkable few hundred extra damage.
  Needs 5 prior games on that hero before it'll compare anything; below that, the card shows your
  numbers with no baseline rather than guess from too little history.
- **Three questions the data already had an answer for, and nothing showed you.** On **Trends**:
  a **Solo vs grouped** card (party size, when the game reported one), a **Close games** card
  (win rate on a one-round margin vs a two-or-more-round blowout, Control/Clash/Flashpoint only
  — the only modes whose score is an actual round tally), and a **Game length** card (Short /
  Typical / Long, boundaries computed per game mode so a Push-heavy stretch doesn't read every
  Escort game as "long" for no reason but the format). Each **Maps** mode card now states its
  own **close · decisive** round-margin split alongside best/worst map, for the same three
  round-tally modes. And **Matches → Customize view** gains a **Party** field (Solo / Duo /
  *N*-stack). All three cuts, plus the round-margin split, are now in the payload the **MCP**
  dashboard tool returns too (H9).
- **The Overview now tells you what to do next.** A **"Next up"** strip under the greeting
  names whatever needs you — matches waiting on a result, games to review, or a placement run
  ready to confirm — each a one-click jump, gone entirely once nothing's pending. The bottom row
  gains two cards: **Active targets** (name, hit-rate sparkline, a **stale** tag when one's
  overdue for rotation) and **Heroes** (your top 5 by games this range) — both previously
  invisible without a trip to Targets or Heroes, even though the data rides on every payload.
  Clicking a hero jumps to Heroes with that row highlighted. Five cards now share the bottom
  row, which wraps to two columns under 1300px so nothing gets squeezed (O3).
- **Every Overview tile now goes somewhere.** The four KPIs were dead ends — clicking
  **Winrate** now opens Trends, **Games** and **Streak** open Matches, and **Rank** opens
  either Manage-ranks or Settings → Accounts depending on what it's showing. **Games** also
  stops hiding draws (`70W · 68L · 10D`, when there are any). A **role strip** under the KPIs
  breaks the blended winrate down by role — "Tank 43% · 56g" — since the default "All roles"
  filter used to hide which one was actually bleeding; click a chip to filter to it. Each
  **Top priority** map row is a real clickable control now (not a dead div) and gets Focus's
  own **"Track as target"** quick-create, so you don't have to leave the landing screen to act
  on it (O4).
- **The Activity heatmap orients itself, and follows your filter.** A weekday column (Mon,
  Wed, Fri) and a month label above each new month replace the old bare grid of cells, and a
  legend note ("1 · 3 · 6+ games") finally explains what the fainter cells mean. The window
  itself now follows the active filter instead of always showing a fixed 35 days — a season
  or "All time" view can show up to 13 weeks, and the card says how many days it's covering.
  Fixed a real bug along the way: the old weekday alignment parsed dates through UTC midnight
  and landed a day off for anyone west of UTC. On **Trends**, the old 4-bucket "Time of day"
  card is now a **weekday × time-of-day grid** (7 rows, 4 columns) — colour = winrate, opacity
  = games, same reading as the heatmap above — so the best-window callout can name "Friday
  evening" instead of just "evening" (O5).
- **The Live screen's "Just finished" card now shows how the match went, not just that it
  ended.** An **E/A/D** line joins the result and map when hero stats were recorded, and a
  match GEP delivered with no win/loss now gets its own honest read — "The game didn't
  report a win or loss for this one" with a straight link to set it on Review — instead of
  silently falling through to the generic "it's in Matches now" fallback (S2).
- **A live match is now visible everywhere, not just on Live itself.** The Overview header
  shows a **"Live · `<map>` · `<hero>` →"** pill the moment a match starts; the nav dot gains
  a small eliminations chip ("62–32") once the feed says which side an attacker was on; and
  the Windows tray's tooltip and menu gain a **"Live: `<map>` · started `<N>`m ago"** line and
  a **"This sitting: `<W>`–`<L>`"** line. On the Live screen itself: a new **Briefing** card
  leads with your own record on the current map and the active targets that apply to the
  hero or role you're playing, the header states a real **mm:ss** elapsed clock instead of a
  coarse "started 12m ago", and the kill feed is relabelled **Kill feed** with its own
  **Hide** link and an honest off-state hint under the tally when it's switched off (S5).
- **Known players now say what they usually play, and which side they're on.** Live's
  "Players you've met" and the match-detail **Player history** card both gain a **"usually
  Widowmaker (4 of 6) · last Ashe"** line — the most useful pre-match fact your history could
  offer, and it was already being tracked for nothing. Live groups rows **your team first,
  then the enemy** instead of interleaving them by encounter count, appends the hero they're
  currently on to each row, and flags a player you generally lose against with a subtle
  border. The match-detail card gets the same team-first sort, a **They play** column, and
  the whole row (not just the name) now opens their history (S7).
- **Mental's Trends card is now a real chart, and it tells you the actual move.** The tilt-rate
  sparkline is now the same line chart Trends uses for winrate — rolling average included — and
  the improving/worsening read states both numbers instead of just a direction: "↓ Improving —
  22% → 15% (earlier vs recent half)." A new **"when do I tilt"** section under the existing
  game-in-sitting read breaks tilt rate down by **time of day**, by **right after a loss vs
  right after a win** ("You tilt 1.4× as often right after a loss — that's the break the
  reminder is for"), and by **map** (top 3, 3+ games) — the triggers behind the tilt tax, not
  just its size (S9).
- **Settings → Accounts now says which account is your main.** Readiness already picked one
  (most played, recently active) to weigh your other accounts' games against — it just never
  told you. The main account now sorts first and wears a **main** pill; the rest sort by games
  played, with the Unknown bucket always last. The non-destructive "forget this display name"
  action is now actually called **Forget name** instead of "Delete" — it used to read exactly
  like the real, data-destroying "Delete…" beside it, which now gets a red danger button so the
  two can't be confused. An account with no rank set gets a **Set rank…** link straight into the
  picker instead of a dead "No rank yet". The sidebar's account switcher now lists whichever
  account you played most recently first, with a "N games · last played Xd" line under each name
  (W2).
- **Connecting an AI coach no longer means hunting for a file path.** Turning on **MCP endpoint**
  in Settings → App behavior now shows the exact path to the bridge script for this install and a
  **Copy Claude Desktop config** button that puts the ready-to-paste JSON block straight on your
  clipboard — no more finding it by hand in the README. A new FAQ entry points here too (W4).
- **Notion sync remembers what actually happened.** "Last synced 2h ago" used to mean nothing
  once a sync had partly (or entirely) failed — the next visit showed the same happy timestamp
  with no way to tell. It now says what landed: "Last synced 2h ago — 12 synced · 1 failed
  (Notion rate limit)", persisted so it survives navigating away or restarting Vantage. A failed
  sync also lists exactly which matches didn't go through and why, with a **Retry failed** button
  that re-syncs just those — instead of a blind re-run of everything. The connected-database card
  also gains an **Open in Notion ↗** link, previously buried in the tray menu (W6).
- **A "Show in Explorer" button on Data storage**, and a real backup export. The folder path used
  to be text you had to copy and paste into a file manager yourself — one click now opens it
  directly. Data import is now **Backup & import**: **Export backup…** writes your whole local
  history to a JSON file (every game with its review/mental notes, every account, every rank
  anchor, every target) for moving to another machine, and a persistent "Last import" line replaces
  the one-time toast as the only record that an import happened (W3).
- **A Comfortable/Compact density setting.** Compact tightens card, table-row, KPI and progress-bar
  padding across the app so more fits on screen at once — a segmented control in Settings →
  Appearance, and a one-click `Ctrl+K` action, same as the winrate colour scheme (W7).
- **A text-size zoom control.** `Ctrl+=`/`Ctrl+-` step the whole app's size up or down, `Ctrl+Shift+0`
  resets to 100% — all three now on the `?` cheatsheet — and Settings → App behavior gets a matching
  90/100/110/125% select. Persists and reapplies on every launch before the first paint (W7).
- **The window can fit half a 1080p screen.** The minimum window width drops from 1040px to
  960px — exactly half of 1920px — so Win+Left/Right snapping it beside a windowed Overwatch or
  Discord actually works. The sidebar now auto-collapses to an icon rail once the window gets
  narrower than ~1180px, and expands again above it, so a snapped window's nav never turns into a
  keyhole; pin it open or closed any time with the collapse toggle or `Ctrl+B` (W7).
- **The window no longer opens off-screen after a display change.** If you unplug a monitor,
  switch Windows display scaling, or the window was last parked on a second screen that's now
  gone, Vantage now re-fits its remembered size and position onto whatever screen it's actually
  opening on — shrunk to fit if needed, nudged back on-screen if it would otherwise land partly
  off it or under the taskbar, or maximized if even the smallest usable size doesn't fit (W7).

### Fixed

- **Overview and Focus stopped congratulating a brand-new season.** With no map at 3 games yet,
  both used to say the same thing a genuinely clean season gets — "No net-losing maps — clean
  season 🎯" / "Nothing is net-losing right now — nice 🎯" — with nothing telling the two apart.
  They now show how close your most-played map actually is to unlocking instead, and only
  celebrate once at least one map has enough games to mean something. Overview's practice hint
  ("These are dragging your season…") no longer shows next to an empty priority list, either.
  With literally no games tracked yet, Overview's map chart is replaced by a plain "No games
  tracked yet" card with **Log match** and **Turn on demo data**, and Focus says "No games in
  this range yet" with a way back to All time (F4).
- **Maps no longer makes your other maps vanish the moment one hits the games floor.** Below-floor
  maps now stay in the ranking, dimmed, instead of dropping out entirely — and the subtitle says
  plainly when no map has reached the floor yet, instead of silently showing everything with no
  explanation (F4).

### Changed

- **A shorter first-run flow.** The demo-data choice is now the intro tour's own second step
  ("Your workspace") instead of a separate prompt shown right before a tour that then talked
  about the same choice again — asked once, in one place. The tour itself is four steps instead
  of seven (F5).
- **The FAQ can search itself, and "What's new" doesn't dump the whole history on you.** A filter
  box narrows every question to what you typed; **What's new** starts collapsed to the two most
  recent releases with **Show all** to expand it. Three new topics — **Accounts & ranks** (rank
  anchors, placement runs, the `Unknown` bucket), **Demo data**, and **Coaching nudges** — cover
  the questions the app's own screens tend to raise (F5).
- **Small samples stopped talking like big ones.** Trends' By role/mode/account breakdowns no
  longer let a 2-game 100% row outrank a 40-game 55% one — thin rows (under 10 games) sort after
  the well-sampled ones and render dimmed rather than vanishing, and every bar now carries a
  reference tick at your own overall winrate so you can read it against "better or worse than
  average" at a glance. The self-rating card's "are you grading the outcome instead of your
  play?" read needs 8 rated games on each side before it says that — below it, a plain "N-point
  gap over M rated games, needs 8 per side" instead. Mental's tilt trend needs 3 actual flagged
  games (not just enough sample days) before "Worsening" carries its "shorter sessions, earlier
  breaks" advice — below that, "Early read: tilt rate up on N flags." The Session card's own
  per-position bars dim under 5 games instead of drawing a full-strength red bar off one game
  (F6).

### Added

- **A relation filter on Players.** Narrow the list to just the people you've actually played
  **with** or **against** — "who have I only ever faced?" used to mean scanning every row's With
  you/Against you columns by eye. The **Last seen** column now also carries a dim "with"/"vs"
  note for whether that person was on your team the last time you played together (M6).
- **A player's page now says who they are at a glance.** Their top 3 heroes and a last-10 W/L
  strip sit right under the name — no more scanning the whole match table to answer "who do they
  play?" or "how are they running lately?". Filter chips (All / With you / Against you / Side
  unknown) narrow the record itself, updating the W/L line to match; the shared-match table is
  now sortable on Map, Mode, Side, Account and When (M6).
- **Players and a player's page stopped showing columns with nothing to say.** A player's own
  page drops the Account column when every shared game was on one account (stated in the
  subtitle instead) and drops Your rank entirely when none of them have one — with a plain
  sentence saying why, and a link to set a rank anchor when that's the actual fix. The With
  you/Against you columns on Players now show the exact winrate they sort by, and a
  name-collision (`⚠`) is explained by name on both screens instead of hover-only (M6).
- **The sidebar has real icons now.** 15 nav items that used to be Unicode text glyphs —
  several of them circles that only differed by which part was filled in — are now distinct
  inline-SVG icons: a crosshair for Focus, a battery for Readiness, a map pin for Maps, and so
  on. Every nav button's tooltip also names its `Ctrl+<digit>` shortcut, and the command
  palette's Screen rows show the same icon, so a screen reads at a glance there too (K6).

## 0.34.0 — 31 July 2026

### Added

- **Delete a match.** When the game feed invents a game that never happened — a phantom match,
  an `Unknown` map, a custom read as tracked play — you can now remove it instead of living
  with it skewing your winrate, streaks and priority maps. It's on the **⋯ menu** of any row
  in Matches, and on the grading card in Review so a bogus game can be deleted rather than
  graded. Both take two clicks and tell you which match you're about to lose, and the
  confirmation that follows offers **Undo** — which puts the real match back, grades and all,
  not a retyped copy. The undo lasts as long as the message is on screen; once it's gone, or
  once you restart Vantage, the delete is permanent.

- **An FAQ**, reachable from **Help** in the status bar — what live tracking needs, why a match
  you joined late looks incomplete, where your data lives, how Notion sync works, and how to
  report a bug. It also keeps this changelog, so you can read back through it any time.
- **Report a bug from inside the app** (About). It opens a prefilled report with your build
  details filled in, and can save your debug log to a file you choose. The saved log has
  BattleTags and other identifying details stripped — that's best-effort, not a guarantee, so
  give it a look before attaching it to a public issue.
- **What's new after an update** — a short summary of what changed, shown once.

### Fixed

- **Being offline no longer looks like something is broken.** Starting Vantage without a
  connection (with Notion set up) used to pop a Windows notification reading "Maps load failed —
  TypeError: fetch failed", and the Notion screen claimed your database had the wrong shape.
  Neither was true. Vantage now stays quiet about a lost connection and, where it matters, says
  plainly that it can't reach the service.
- **Notion sync explains itself when it fails.** A failed sync reported "0 synced, 12 failed"
  with no reason. It now tells you why.

### Changed

- **The installer asks you to accept the Terms of Use and Privacy Policy**, which are now
  published at a public link you can read before installing.

## 0.32.0 — 15 July 2026

### Added

- **Focus Trend** — a per-target learning curve that shows the dip-then-rebound you get while a
  new habit beds in, with a hit-rate overlay and an in-app guide to reading it honestly.
- **Click a player** anywhere they appear to see every match you've shared with them.
- **Target grades in match views**, calculated from the match's own stats, with a configurable
  margin for what counts as a partial hit.
- **A banner when Overwatch's event feed is down**, and a notification when it recovers, so a
  quiet app is never mistaken for a broken one.

### Changed

- **Review lets you enter the real SR change yourself** — and Vantage no longer invents one when
  it doesn't know.
- **Matches the feed reported incompletely wait in Review** instead of being dropped silently.
- **Focus concentrates on maps**, where the actionable losses actually are.
- **Match detail** reads better: a damage icon, a roomier scoreboard, a per-hero "All" tab, and a
  ±25 SR preset.

### Fixed

- **Aatlis** is recognised instead of showing up as an unknown map.
