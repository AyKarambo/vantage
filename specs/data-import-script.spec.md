# Spec: data-import-script

**Status:** done · **Updated:** 2026-07-08 · **Slug:** `data-import-script` · **Owner:** Timo

## Intent (WHAT & WHY)

A friend ("Lampenlicht") wants to test Vantage using the match history he already
keeps, **without abandoning his own tracker**. He logs Overwatch matches as markdown
files in an **Obsidian vault** (one file per game, YAML frontmatter, a Dataview
dashboard). He wants to keep tracking there and **periodically pull his latest games
into Vantage**.

Vantage today ingests outside data only via live GEP capture and Notion export. So we
add a **one-way, repeatable import bridge**:

1. A **PowerShell transform script** that reads his Obsidian vault and emits a single
   **Vantage import file** (documented JSON) — he runs it whenever he wants to sync.
2. A small **in-app "Import from file" action** (Settings → Data) that ingests that
   file, **marks the imported matches** as import-sourced so they can be **cleared and
   re-imported cleanly**, and sets his competitive **rank anchor** from a current rank
   he supplies. Alongside it, an in-app **help panel documents the import-file format**
   so other trackers can be adapted later.

**Why split it this way:** the PowerShell script owns everything Obsidian-specific (his
format may drift); the app only ever knows the neutral, documented Vantage import
format. That keeps `core/` pure and the app decoupled from any one tracker's schema, and
makes the import format a reusable contract rather than a one-off.

**Why marking instead of merge-on-re-import:** the friend keeps editing/deleting matches
in his own tool. Rather than solve two-way diffing, imported matches carry a provenance
marker so the friend can **wipe the previously-imported set and re-import the current
vault** for a clean full re-sync — with no risk to matches he tracked live or logged by
hand inside Vantage.

## In-Scope

- **PowerShell script** (under the repo's tooling dir, + README): parse the vault's
  `match/*.md` frontmatter → Vantage import JSON. Handles the real dataset's quirks
  (1 empty file, 2 files with `sr_change: 0`, a `duo_partner: Timio` typo, accented map
  names). Prompts once for the friend's **current tank rank** (skippable) and embeds it
  as the anchor. Emits a **deterministic `matchId` per source file** so re-runs are
  idempotent. Prints a summary of converted vs skipped files.
- **Vantage import-file format**: a versioned JSON envelope
  `{ vantageImport, account, anchor?, games[] }` where `games` are `GameRecord`s
  (`source`-marked as import-provenance, competitive, tank). Documented as the contract
  between the two halves, and surfaced via the in-app help panel.
- **Pure core importer** (`src/core/…`, unit-tested): validate + normalize an import
  envelope into `{ games: GameRecord[], anchor?, errors[] }`; reject malformed input
  with a clear, human-readable reason.
- **In-app import action** (Settings → Data): button → main-process file dialog reads
  the file → core validation → append to history (idempotent, dedupe by `matchId`) +
  set/refresh the rank anchor (only when the file carries one) → summary result
  (`X imported, Y skipped, anchor set/updated`).
- **Marking + clearing**: every imported game carries a provenance marker identifying it
  as file-imported (distinct from live-tracked and hand-logged, and independently
  clearable from Notion imports). A **"Remove imported matches"** action deletes exactly
  that set, enabling a clean wipe-and-re-import re-sync.
- **In-app import-format help**: a help/reference panel in the same Settings section that
  documents the expected import JSON (fields, types, example) for adapting other data
  sources.
- **Field mapping & defaults**: date+time→`timestamp` (**importing machine's local
  time**); result→`result`; heroes→`heroes` (already canonical); `sr_change`→`srDelta`;
  performance stars **1/2/3/4/5 → 0/25/50/75/100**; account→`"Lampenlicht"`;
  gameType→`"Competitive"`; role→`tank` (derived from heroes); map names reconciled to
  Vantage's canonical set where a normalized match exists, with an explicit alias for
  **"Neon Junction" → Vantage's spelling** (`Neon Junktion`); unmatched map names kept
  verbatim and reported.
- **SR anchor**: friend supplies his current tank rank once; the anchor is set at the
  **latest imported competitive match's timestamp**, letting the rank engine reconstruct
  absolute ranks *backward* across all imported games.

## Out-of-Scope

- Writing directly to `history.db` from the script; any dependency on standalone
  Node/SQLite on the friend's machine (rejected in favour of the file + in-app importer).
- **Automatic per-match merge/update** on re-import (reflecting edits to already-imported
  matches). Re-sync is done by **clear-then-re-import**, not field-level diffing.
- Two-way sync; a live/continuous connection to Obsidian; a general importer UI for
  arbitrary third-party trackers (the format is documented, but only this script targets
  it for now).
- Importing solo/duo, duo-partner, or match-note bodies (Vantage models none of these;
  the bodies are all empty templates anyway).
- Backfilling per-hero stats, K/D/A, damage/healing/mitigation (his data has none).
- A `maps.ts` fix for the `Neon Junktion` spelling itself (handled by the script alias;
  a source fix is a possible follow-up, not part of this feature).

## Constraints

- **Guardrail 3** — the import parse/validate/normalize logic lives in `src/core/` and
  stays Electron-free and unit-tested; the file dialog + file read stay in `src/main/`.
- **Guardrail 4** — the in-app action ships in the esbuild bundle: a plain Settings
  button + help panel, no inline script, no remote code.
- **Guardrail 5** — local-first: the import reads a local file the user explicitly
  selects; nothing leaves the device.
- **Typed IPC end-to-end** — the import request/result cross the contract with concrete
  types, no `any`.
- **Idempotency** — re-import is safe by construction: `matchId` is deterministic per
  source file and the append path skips ids already stored.
- **Runs with the app open** — the importer uses the live stores; the friend does not
  have to close Vantage.
- **Clean, independent clear** — removing imported matches must not touch live-tracked,
  hand-logged, or Notion-imported games.
- **PowerShell** — targets Windows PowerShell 5.1+ with no external modules; UTF-8 aware
  (accented map names like *Esperança*, *Paraíso*).
- **DoD** — `npm test` green, `npm run typecheck` clean (main + renderer), new core logic
  ships with vitest coverage, README/docs updated for both the script and the in-app
  action.

## Acceptance Criteria

**AC1 — Vault → import file.**
Given the friend's vault (98 match files),
When he runs the PowerShell script pointed at the vault,
Then it writes one Vantage import JSON containing **97 games** (the 1 empty file
skipped), each with import provenance, `account:"Lampenlicht"`,
`gameType:"Competitive"`, `role:"tank"`, a deterministic `matchId`, and the mapped
`timestamp/result/map/heroes/srDelta/performance`, and it prints a summary of converted
vs skipped files.

**AC2 — Deterministic, idempotent ids.**
Given the script is run twice on the same vault,
When the two output files are compared,
Then every game's `matchId` is identical across runs (derived from the source filename).

**AC3 — Star→100 mapping.**
Given matches rated 1..5 stars,
When converted,
Then `performance` is 0/25/50/75/100 respectively.

**AC4 — Local timezone.**
Given a match dated `2026-07-05` at `18:42`,
When converted on a machine in Europe/Berlin,
Then its `timestamp` equals that wall-clock instant in the machine's local time zone.

**AC5 — Dirty-data handling.**
Given the empty file, the two `sr_change: 0` files, and the `duo_partner: Timio` typo,
When converted,
Then the empty file is skipped (and reported), the zero-SR games import with
`srDelta: 0`, and the duo-partner/solo-duo data is dropped — no crash, no partial/garbage
record.

**AC6 — Map reconciliation & alias.**
Given his maps including `Watchpoint Gibraltar` and `Neon Junction`,
When converted,
Then `Watchpoint Gibraltar` reconciles to Vantage's canonical `Watchpoint: Gibraltar`
(normalized match) and `Neon Junction` is aliased to Vantage's `Neon Junktion`, so both
group correctly in Vantage's by-mode analytics; any map with no match is kept verbatim
and listed in the script's report.

**AC7 — In-app import ingests idempotently.**
Given a valid import file and an empty Vantage history,
When the friend picks it via Settings → Data → Import,
Then all 97 games are added and the result reports `97 imported`; and when he imports the
**same** file again, `0 imported / 97 skipped` is reported with history unchanged.

**AC8 — Marked & independently clearable.**
Given imported matches plus at least one live-tracked/hand-logged match (and, if present,
a Notion-imported match),
When the friend uses "Remove imported matches",
Then exactly the file-imported games are deleted and every other game (live, hand-logged,
Notion-imported) remains.

**AC9 — Wipe-and-re-import re-sync.**
Given the friend edited/deleted some matches in Obsidian and regenerated the file,
When he removes imported matches and re-imports,
Then Vantage's imported set exactly reflects the current vault (edits and deletions
included), with no duplicates and no orphaned rows.

**AC10 — Rank anchor & reconstruction.**
Given he supplied a current tank rank (e.g. Diamond 3, 45%),
When the file is imported,
Then a rank anchor for (`Lampenlicht`, `tank`) is set at the latest imported competitive
match, and Vantage displays a non-flat absolute-rank history reconstructed backward from
it across the imported games.

**AC11 — Anchor is optional and non-destructive.**
Given an import file with **no** anchor (he skipped the rank prompt),
When imported,
Then games are added and any existing rank anchor is left untouched (not cleared).

**AC12 — Malformed file rejected cleanly.**
Given a file that isn't a valid Vantage import envelope,
When selected,
Then the importer rejects it with a human-readable reason and writes nothing to history.

**AC13 — Import-format help.**
Given the friend (or a future user) opens Settings → Data,
When they view the import section,
Then a help/reference panel documents the expected import JSON format (fields, types, and
a short example) sufficient to hand-author or adapt an import file for another source.

**AC14 — Definition of Done.**
`npm test` passes, `npm run typecheck` is clean for main and renderer, the core importer
has unit tests, and docs cover both running the script and using the in-app import.

## Resolved questions

- **Delivery mechanism** → *Emit JSON + in-app importer.* The script transforms the vault
  into a Vantage import file; a new Settings → Data import action ingests it. Chosen over
  direct `history.db` writes to avoid a Node/SQLite runtime dependency on the friend's
  machine and to let import run with the app open.
- **Re-import / sync strategy** → *Mark imported matches so they can be deleted.* Imported
  games carry an import-provenance marker; a "Remove imported matches" action clears
  exactly that set (independently of Notion imports), enabling clean wipe-and-re-import.
  This avoids field-level merge/diff entirely.
- **SR handling** → *Ask current rank → anchor latest.* Friend gives his rank now (once,
  skippable); the anchor is set at his most recent imported match; the engine
  reconstructs earlier ranks backward. Confirmed supported by `rankAfterMatch`.
- **Performance mapping** → *0/25/50/75/100* (linear full range; 1★=0, 5★=100).
- **Solo/Duo + partner** → *Drop.* Vantage models neither.
- **Timezone** → *Importing machine's local time.*
- **"Neon Junction"** → *Fix via a script-side alias* to Vantage's `Neon Junktion`; leave
  `maps.ts` for a possible follow-up.
- **Import UI location** → *Settings → Data.*
- **Import-format help** → *Add an in-app help panel* documenting the import JSON format
  for other/future import cases.
- **Applied defaults (no objection raised):** account `"Lampenlicht"`; role `tank`
  (derived from heroes); gameType `"Competitive"`; skip the empty file; deterministic
  `matchId` from source filename; `manual`/import source marking.

## Open Questions

_None blocking._ Mechanism-level choices deferred to the techplan:

1. **Provenance marker mechanism** — whether to reuse the existing `importedAt` stamp
   (shared "imported" bucket with Notion) or introduce a distinct marker so file-imports
   clear independently of Notion imports. The spec requires *independent* clearing (AC8);
   the techplan picks the concrete field/schema change.
2. **Account registration** — whether importing must also register `"Lampenlicht"` in
   the app's account config for it to appear in the account switcher, or whether the
   account list derives from stored games. Techplan to confirm and wire accordingly.
