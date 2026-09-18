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
