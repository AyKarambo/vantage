---
slug: log-match-improvements
status: done
created: 2026-07-06
updated: 2026-07-06
---

# Spec: Log Match screen improvements

**Surface:** `renderer/src/app/log-match.ts`, `renderer/src/views/settings.ts` (Set-rank),
`src/core/{mental,rank}`, the IPC contract, and the Notion comms edge.

## Intent (WHAT & WHY)

The quick-log card is the app's highest-frequency manual entry point (~5 taps after a game).
Five rough edges make it slower and less faithful to how people play:

1. **One hero per match is wrong.** People swap heroes; capturing one under-reports play and
   skews per-hero stats. The card should reflect **several heroes**.
2. **The hero list ignores the role you picked.** You scroll past 40+ heroes to reach the ~12
   for your role. Role should **narrow the choices** — except Open Queue.
3. **SR delta entry is fiddly.** Every comp game moves rank ~±25, yet the field starts blank
   wanting a signed number typed. It should **preset from the result** and be **wheel-adjustable**.
4. **No low-friction way to fix a drifted rank.** If you didn't log past deltas, the tracked rank
   drifts. You should be able to **enter your current rank instead of a delta**, and — because rank
   protection is real — express being **in protection** by entering a **negative %**. This must work
   both when logging and in **account settings**.
5. **Comms flagging is thin.** One "Positive comms" chip can't express banter or abuse. Players want
   a **three-way comms read** — positive / banter / abusive — as a colored switch.

Benefit: faster, truer logging → better hero stats, near-zero-effort SR tracking, a self-healing rank
track that models protection honestly, and a richer mental signal — without slowing the card or
weakening account safety (still 100% manual entry).

## In-Scope

- **Multi-hero capture:** select zero or more heroes (removable chips), persisted to `heroes[]`.
- **Role-driven hero filtering:** Tank/Damage/Support restrict the hero picker to that role's heroes;
  **Open Queue becomes a 4th selectable role** showing all heroes.
- **SR "Change" mode (default):** delta field auto-fills **+25 Win / −25 Loss / 0 Draw**,
  wheel-adjustable **±1/notch**, editable and **clearable** (blank = no SR). Preset re-applies on
  result change **only while unedited**.
- **SR "Set current rank" mode (toggle):** replaces the delta field with a tier/division/% picker for
  the current position and, on save, **(re)anchors the rank** to that value — the same operation as
  Settings' "Set rank". This is the friction-free correction path (no manual delta math).
- **Rank protection via negative %:** in *both* the log card's Set-current picker and the
  account-settings Set-rank modal, entering a **negative %** marks the rank as **in protection** (that
  negative carry is preserved, shown with 🛡). Backed by a `src/core/rank` change so anchors carry
  protection instead of clamping to 0. Covered by tests.
- **Comms switch:** colored single-select segmented control — **Positive (green `--win`),
  Banter (yellow `--mid`), Abusive (red `--loss`)** — replacing the "Positive comms" chip.
  Optional/clearable.
- **Core model:** add a `comms` tone to the mental self-report **replacing `positiveComms`**,
  backward-compatible. **Tilt and Toxic-mates stay separate, independently tracked — unchanged.**
- **Notion round-trip:** map the tone to the existing `Comms` select — `positive`→`'positive'`,
  `banter`→`'banter'`, `abusive`→`'abusive'`; none → cleared. Import maps back and **tolerates a
  legacy `'banther'`** option → `banter`.
- Unit tests for changed pure logic: mental composite with the comms tone + legacy compat; anchor
  protection (`stateFromAnchor` with negative %).

## Out-of-Scope (non-goals)

- Redesigning the **Review screen** flag row or **Matches drill-down** editor. They must keep working
  and read comms/heroes correctly, but the 3-state comms UI, multi-hero editing, and set-current there
  are separate work. (Review keeps its binary "good comms" chip → `comms: 'positive'`.)
- **Per-hero attribution** (SR/stats split across heroes). Heroes are a flat set, as GEP multi-hero
  matches are today.
- **Reworking Tilt / Toxic-mates** semantics or scoring — untouched this pass.
- Deriving a per-match delta from before/after positions (superseded by the re-anchor approach).
- Keyboard shortcuts, save/dedupe flow, played-time backfill, live GEP capture.

## Constraints

- **Guardrails hold:** `src/core/` pure/Electron-free; renderer CSP-friendly; IPC typed end-to-end
  (no `any`); manual-only, local-first.
- **Composition over markup:** comms switch reuses the segmented/`choice` pattern + semantic tokens;
  multi-hero reuses `typeahead` + `chip`; Set-current reuses the rank picker widget already in Settings.
  No new dependencies.
- **Backward compatibility:** stored games with `positiveComms:true` still read as positive comms
  everywhere (composite, readiness, row flags, Notion) after the model change.
- **Protection semantics preserved:** a negative anchor % must round-trip as protection through
  `RankAnchorInput` (already a `number`), the anchor store, and `stateFromAnchor` (no clamp-to-0).
  Positive % stays unprotected as today; live-computed protection from logged losses is unchanged.
- **Spelling:** internal tone `banter`; UI label "Banter"; Notion canonical option `'banter'`
  (import tolerant of legacy `'banther'`).
- **DoD:** `npm test` green; `npm run typecheck` clean (main + renderer); new core logic tested;
  README/docs updated for user-visible changes.
- Mouse-wheel adjustment must not scroll the modal while the pointer is over the SR field.

## Acceptance Criteria

### Multi-hero selection
- **Given** the card, **when** I add heroes, **then** each appears as a removable chip and the picker
  stays available.
- **Given** several selected, **when** I remove one, **then** it leaves and the rest are unaffected.
- **Given** zero heroes, **when** I save, **then** the match saves with an empty hero list (hero stays
  optional).
- **Given** heroes H1, H2, **when** saved and later read, **then** `heroes = [H1, H2]`, counting
  toward each hero as a GEP multi-hero match does.

### Role → hero filtering + Open Queue
- **Given** role = Damage, **then** the hero picker offers only Damage heroes.
- **Given** role = Open Queue, **then** all heroes are offered.
- **Given** heroes picked for Damage, **when** I switch to Support, **then** already-picked heroes are
  **kept**; the picker now offers only Support heroes.
- **Given** the role control, **then** it offers **Tank, Damage, Support, Open Queue**; Open Queue
  persists role `openQ`.

### SR — Change mode (default)
- Win → **+25**, Loss → **−25**, Draw → **0** on a fresh card.
- **Given** SR unedited, **when** result changes, **then** the preset updates to match.
- **Given** SR edited (typed/wheeled), **when** result changes, **then** my value is preserved.
- **Given** the pointer over the field, **when** I wheel, **then** value **±1** and the modal doesn't
  scroll.
- **Given** SR blank, **when** I save, **then** no SR delta is recorded; **given** non-blank, it
  persists as signed `srDelta`.

### SR — Set current rank mode
- **Given** the SR block, **then** a toggle offers **Change (±%)** (default) and **Set current rank**.
- **Given** Set-current mode, **then** the ± field is hidden and a tier/division/% picker is shown.
- **Given** Set-current mode, **when** I enter my current rank and save, **then** the rank anchor for
  (account, role) is set to that value and the tracked rank equals it — no manual delta.
- **Given** Set-current mode, **when** I enter a **negative %**, **then** the tracked rank is marked
  **in protection** (🛡) carrying that negative %.
- **Given** either mode, **then** only the active mode's input is used on save.

### Rank protection in account settings
- **Given** Settings → Accounts → **Set rank**, **when** I enter a negative %, **then** the anchor is
  saved as **in protection** and the account/role rank shows 🛡 with the negative carry.
- **Given** a protected anchor, **when** the next competitive match is logged, **then** its delta pays
  down the negative carry exactly as the engine does for a live protected loss.
- **Given** a non-negative %, **then** the rank is unprotected — unchanged from today.

### Comms switch
- **Given** the card, **then** comms is a single-select switch — **Positive (green), Banter (yellow),
  Abusive (red)** — none selected by default.
- **Given** none selected, **when** I save, **then** no comms flag is recorded.
- **Given** Positive, **when** I save, **then** comms = positive, reading as "positive comms"
  everywhere the old `positiveComms` did.
- **Given** Abusive, **when** I save, **then** comms = abusive is recorded as a **negative** comms
  signal, **distinct** from Toxic-mates.
- **Given** an option selected, **when** I click it again, **then** the selection clears.
- **Given** Tilt and Toxic-mates, **then** both remain independent chips, unaffected by the switch.

### Notion round-trip
- **Given** comms = positive / banter / abusive, **when** exported, **then** `Comms` =
  `'positive'` / `'banter'` / `'abusive'`; none clears it.
- **Given** a Notion row with `Comms` = `'positive'` / `'banter'` / `'abusive'` (or legacy `'banther'`),
  **when** imported, **then** comms = positive / banter / abusive.
- **Given** a legacy record with `positiveComms:true`, **when** exported, **then** `Comms` = `'positive'`.

### Model compatibility & regression
- **Given** a stored game with `positiveComms:true`, **when** read after this change, **then** it's
  identical to comms = positive across composite, readiness, row flags, Notion.
- **Given** the full change, **when** I run `npm test` + `npm run typecheck`, **then** both pass, with
  new tests for the comms-tone composite, legacy compat, and negative-% anchor protection.

## Resolved questions

1. **Comms mapping** → replace only `positiveComms`; add `banter`/`abusive`; optional/clearable.
   **Tilt & Toxic-mates stay separate, untouched.**
2. **SR preset** → Win +25 / Loss −25 / Draw 0; wheel **±1**; clearable; preset re-applies only while
   unedited.
3. **Role → heroes** → hard filter + add Open Queue; switching role keeps picked heroes.
4. **Set current rank** → a Change↔Set-current toggle; Set-current **re-anchors** to the entered
   position (same operation as Settings' Set-rank), removing manual delta math.
5. **Rank protection** → a **negative %** on an anchor (in the log card *and* account settings) means
   the rank is in protection; `stateFromAnchor` preserves the negative carry instead of clamping to 0.
6. **Composite weighting of `abusive`** → default: `positive` supports "calm" as `positiveComms` does
   today; `banter` neutral; `abusive` counts as non-positive and is surfaced as its own negative comms
   count, **without** touching Tilt/Toxic-mates.
7. **Notion tones** → map directly; canonical `'banter'`, import tolerant of legacy `'banther'`.
8. **Spelling** → "banter" everywhere in-app and in Notion.

## Open Questions

*None outstanding — ready to plan.* Fine-grained UI details (how Set-current interacts with the
existing first-match "set once" anchor picker, the exact magnitude of the `abusive` composite penalty)
are left for the techplan to settle with tests.
