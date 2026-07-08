# Techplan: data-import-script

**Spec:** [specs/data-import-script.spec.md](./data-import-script.spec.md) · **Status:** for review

Grounded in a codebase survey (8 parallel readers). Key line refs are inline so the
implementer can jump straight to the pattern being mirrored.

---

## Architecture & Approach

Two decoupled halves connected by one documented file format:

```
Obsidian vault (match/*.md)                    Vantage (ow-electron)
        │                                              │
  scripts/import-obsidian.ps1                   Settings → Data
   (zero-dependency PowerShell)                   "Import from file"
        │  writes                                       │ reads (main dialog)
        ▼                                               ▼
   vantage-import.json  ───────────────────►  parseVantageImport()  (pure core)
   { vantageImport, account,                         │ { games, anchor?, errors }
     anchor?, games[] }                              ▼
                                          HistoryStore.addMany (idempotent, stamps
                                          importSource:'file')  +  RankAnchorStore.set
```

**Design principles**

1. **The script owns Obsidian; the app owns only the neutral envelope.** The PowerShell
   script is the sole place that knows the friend's markdown schema. The app ingests a
   documented `{ vantageImport, account, anchor?, games[] }` file — reusable for any
   future source and self-described by an in-app help panel.
2. **Pure core, edge plumbing.** Envelope validation/normalization is a pure,
   Electron/Node-free module (`src/core/importEnvelope.ts`), mirroring the
   `core/dataMigration.ts` (pure planner) ↔ `store/dataMigration.ts` (fs executor) split.
   The file dialog + `fs.readFile` + `JSON.parse` live in the composition root
   (`src/main/index.ts`); the store writes live in the provider.
3. **Reuse the existing "mark imported → wipe → re-import" substrate**, extended with a
   provenance discriminator so file-imports clear **independently** of Notion imports
   (see Data Model). Idempotency is free: deterministic per-file `matchId` +
   `INSERT … ON CONFLICT(matchId) DO NOTHING`.
4. **Anchor at the newest match.** The rank engine reconstructs history *backward* from a
   single anchor (`core/rank/reconstruct.ts:71-73`), so we set the anchor at the latest
   imported competitive match's timestamp using the friend's supplied *current* rank.

### Flow: running the script (the friend)

`powershell -ExecutionPolicy Bypass -File import-obsidian.ps1 -VaultPath '…\Vault' -OutFile 'vantage-import.json' -CurrentRank 'Diamond 3 45%'`

1. Enumerate `<VaultPath>/match/*.md`. For each, hand-parse the YAML frontmatter
   (line scan `key: value` — PS 5.1 has no YAML parser; keep zero-dependency).
2. Skip files with no parseable frontmatter or no `result` (the empty `Numbani` file) and
   tally them for the summary.
3. Map each match to an envelope game row (see Field Mapping). Deterministic
   `matchId = "manual-import-" + <source filename without extension, lowercased>`.
4. If `-CurrentRank` given, parse + validate it into
   `anchor = { role: 'tank', tier, division, progressPct }`.
5. Serialize `{ vantageImport: 1, account, anchor?, games[] }` with
   `ConvertTo-Json -Depth 12` (avoids the PS 5.1 default `-Depth 2` truncation trap),
   UTF-8, to `-OutFile`. Print `Converted N, skipped M` + any unmatched map names.

### Flow: importing in-app (the friend, app open)

1. Renderer: Settings → Data → **Import matches from file** → `await bridge.importFromFile()`.
2. Main handler (`importFromFile`) calls the injected `importFile.pick()` edge:
   `dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Vantage import', extensions: ['json'] }] })`
   → `fs.readFileSync` → `JSON.parse` → returns the raw value (or `undefined` if cancelled).
3. Provider `importFromFile`: `parseVantageImport(raw)` → `{ games, anchor, errors }`.
   - `addMany(games.map(g => ({ …g, importedAt, importSource: 'file' })))` → `{ imported, skipped }`.
   - `seedImportedAccounts(deps, games)` registers `"Lampenlicht"` in config so it shows in
     the account manager / filters / rank UI (mirrors Notion, `dataProvider.ts:394-406`).
   - If `anchor`: `latest = max timestamp among just-imported (account, role='tank')
     competitive games`; `rankAnchors.set({ account, role, tier, division, progressPct,
     setAt: min(latest, now) })`. Called **directly on the store** — not via
     `setRankAnchor`, which hardcodes `setAt: Date.now()` (`dataProvider.ts:256`).
   - Return `{ imported, skipped, invalid: errors.length, accountsAdded, anchorSet }`.
4. Renderer shows the result line and `void store.refresh()` (rebuilds dashboards + the
   sidebar rank chip).

### Flow: clearing imported matches (clean re-sync)

Settings → Data → **Remove imported matches** → confirm modal (mirror
`confirmDeleteImported`, `syncCard.ts:154`) → `await bridge.deleteFileImports()` →
`removeImported('file')` deletes exactly the file-imported rows, leaving live-tracked,
hand-logged, and Notion-imported games intact → `store.refresh()`. The friend re-runs the
script and re-imports to reflect edits/deletions in his vault.

---

## Affected Files / Modules

### New — PowerShell script + docs
| Path | What |
|------|------|
| `scripts/import-obsidian.ps1` | Zero-dependency transform. Follows `scripts/sign-local.ps1` template: `#` header (purpose / Prerequisites / Usage), `param(...)` PascalCase with defaults (`$VaultPath`, `$OutFile`, `$Account='Lampenlicht'`, `$CurrentRank`), `Write-Error` + `exit 1` on bad input, 4-space indent, double quotes, no shebang. |
| `docs/import.md` | Friend-facing topic doc (mirrors the `sign-local.ps1`↔`docs/signing.md` pairing): how to run the script, the rank prompt, and the envelope format. |

### New — core (pure, unit-tested)
| Path | What |
|------|------|
| `src/core/importEnvelope.ts` | `parseVantageImport(raw: unknown, opts?): { games: GameRecord[]; anchor?: ImportAnchor; errors: ImportError[] }`. Electron/Node-builtin-free (hand-avoid `path`, like `dataMigration.ts`). Per-row validate/normalize with reject-not-throw; validate the anchor against the tier/division/pct vocabulary. |
| `test/importEnvelope.test.ts` | Pure-function tests (style of `test/notionMerge.test.ts`). |
| `test/importFileStore.test.ts` | Store-integration tests for source-scoped clear + migration (style of `test/stores.test.ts`; temp dir, `opened[]`, close-before-`rmSync`). |
| `test/importFileProvider.test.ts` | Provider tests with an in-memory history fake (style of `test/importNotionProvider.test.ts`). |

### Changed — types, store, provider, contract, main, renderer
| Path | Change |
|------|--------|
| `src/core/analytics/types.ts` | Add `GameRecord.importSource?: 'notion' \| 'file'` (JSDoc). Update the now-inaccurate `importedAt` JSDoc ("set only on games pulled from Notion" → "…from an import"). |
| `src/store/history.ts` | Add `importSource TEXT` to `SCHEMA_SQL`; denormalize it in `rowValues`/`INSERT_SQL`/`UPDATE_SQL`. Add an **idempotent migration** in `open()` after `exec(SCHEMA_SQL)`: `PRAGMA table_info(games)` → `ALTER TABLE games ADD COLUMN importSource TEXT` if absent. Make `removeImported(source)` and `importedCount(source)` source-scoped via `WHERE importedAt IS NOT NULL AND COALESCE(importSource,'notion') = ?`. |
| `src/main/dataProvider.ts` | New `importFromFile()` (mirrors `importNotion`, `260-291`) + `deleteFileImports()` + `fileImportedCount()`. Notion path: stamp `importSource:'notion'` at `:279`; route its clear/count through the `'notion'` scope. Add an `importFile: { pick(): Promise<unknown \| undefined> }` dep slice to `DataProviderDeps`. Reuse `seedImportedAccounts` (`:394-406`). |
| `src/shared/contract/api.ts` + `contract/index.ts` | Declare `importFromFile`, `deleteFileImports`, `fileImportedCount` on `OwStatsApi`; add their channel strings to `IPC_CHANNELS` (the `satisfies` guard forces both). Add result DTOs (`ImportFileResult`). |
| `src/main/dashboard/ipcHandlers.ts` | Register the three channels via `handle()` (auto-guards untrusted senders). |
| `src/main/index.ts` | Implement `pickImportFile()` (copy `pickDataFolder` `:212-219`, `properties:['openFile']` + json filter) + `fs.readFileSync`/`JSON.parse`; supply the `importFile` dep slice in `createDataProvider({…})` (`:270-360`). |
| `renderer/src/views/settings/importCard.ts` (new) | The Data-section card: **Import matches from file** button, result line, **Remove imported matches** button + confirm modal, and a collapsible **Import format** help panel (local-boolean re-render, `builder.ts:149-176` pattern; `.hint`/`mono` blocks; no `<details>`). Composed into the Settings → Data screen next to `dataLocation.ts`. |
| `renderer/src/bridge.ts` | (Auto/among the bridge methods) the three new calls become `await bridge.importFromFile()` etc. |
| `package.json` | Optional dev alias `"import:obsidian": "powershell -ExecutionPolicy Bypass -File scripts/import-obsidian.ps1"` (mirrors `sign:local`). |
| `README.md` | Link the script + `docs/import.md` from the Development section (DoD item 4). |

---

## Data Model / Interfaces

### Import-file envelope (the documented contract)
```jsonc
{
  "vantageImport": 1,                         // schema version (number)
  "account": "Lampenlicht",                   // default account label for every game
  "anchor": {                                 // OPTIONAL — omit to skip rank anchoring
    "role": "tank",
    "tier": "Diamond",                        // one of the 8 tiers, exact case
    "division": 3,                            // 1 (highest) … 5 (lowest)
    "progressPct": 45                         // 0 … 100 within the division
  },
  "games": [
    {
      "matchId": "manual-import-2026-07-05-18-42-busan",  // deterministic per source file
      "timestamp": 1751733720000,             // epoch ms, local wall-clock of date+time
      "account": "Lampenlicht",
      "role": "tank",
      "map": "Busan",                          // canonicalized to Vantage's spelling
      "result": "Loss",                        // Win | Loss | Draw
      "gameType": "Competitive",
      "source": "manual",
      "heroes": ["Winston", "Sigma"],
      "srDelta": -27,                          // optional; 0 kept as recorded
      "performance": 75                        // optional; 0/25/50/75/100 from 1..5 stars
    }
  ]
}
```

### Core types (`src/core/importEnvelope.ts`)
```ts
export interface ImportAnchor { role: Role; tier: string; division: number; progressPct: number; }
export interface ImportError { index: number | null; reason: string; }   // index=null for envelope-level
export interface ParsedImport { games: GameRecord[]; anchor?: ImportAnchor; errors: ImportError[]; }
export function parseVantageImport(raw: unknown, opts?: { now?: () => number }): ParsedImport;
```
Validation rules (runtime — tests are **not** typechecked, and the input is untrusted):
- Envelope: object with numeric `vantageImport`; `games` array (else one envelope-level error, empty result).
- Per game (reject → `ImportError`, never throw; per-row isolation like `notionImporter.ts:113-123`):
  - `result` through `resolveResult` (reject if undefined); `timestamp` finite number, clamped `min(ts, now)`; `map` non-empty string; `heroes` string[] (default `[]`); `role` defaults `'tank'`; `account` from envelope; `gameType` default `'Competitive'`; `source='manual'`; `srDelta`/`performance` optional finite numbers passed through.
  - **No** `importedAt`/`importSource` set here — those are persistence provenance stamped at the edge.
- Anchor (if present): `tier ∈ TIERS` (import `TIERS` from `src/core/rank` — do **not** hardcode a copy; unknown tier is silently coerced to Bronze by the engine, so reject it here), `division ∈ {1..5}`, `progressPct ∈ [0,100]`. Invalid → drop the anchor + push an error.

### Marking / provenance (the AC8 decision)
- Add `importSource?: 'notion' | 'file'` to `GameRecord`; persisted automatically in the
  `data` JSON blob **and** as a scalar `importSource` column (needed for the SQL DELETE
  predicate).
- Both importers stamp `importedAt` (generic "imported" timestamp) **and** `importSource`.
- Clear/count are source-scoped: `… WHERE importedAt IS NOT NULL AND COALESCE(importSource,'notion') = ?`.
  `COALESCE(…, 'notion')` maps legacy Notion rows (which predate the column, `importSource
  = NULL`) to `'notion'`, so the existing Notion clear keeps finding them — **back-compat
  safe**. File-imports (`'file'`) are a disjoint bucket.

### Field mapping (script) & rank vocabulary
| Obsidian frontmatter | Envelope game | Rule |
|---|---|---|
| `date` + `time` | `timestamp` | Local wall-clock → epoch ms (`[DateTimeOffset]…ToUnixTimeMilliseconds()`), clamp ≤ now |
| `result` | `result` | `Win`/`Loss` verbatim (no `Draw` in data) |
| `map` | `map` | Normalized match against embedded Vantage catalog → exact catalog spelling; alias `Neon Junction → Neon Junktion` (normalize can't fix c/k); `Watchpoint Gibraltar → Watchpoint: Gibraltar` (via normalize); unmatched kept verbatim + reported |
| `heroes` | `heroes` | Verbatim (already canonical, incl. `D.Va`, `Junker Queen`) |
| `sr_change` | `srDelta` | Integer; `0` kept |
| `performance` | `performance` | `1/2/3/4/5 → 0/25/50/75/100` |
| `mode` | `gameType` | Always `Competitive` |
| — | `role` | `tank` |
| — | `account` | `Lampenlicht` (param default) |
| `solo_duo`, `duo_partner`, body | — | Dropped |

Tiers (exact, ordered): `Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster,
Champion` (`core/rank/engine.ts:9`). Division 1 = highest … 5 = lowest. `progressPct`
0..100. The script validates `-CurrentRank` against these before emitting the anchor.

---

## Test Strategy

Tests are excluded from `tsc` (`tsconfig.json` `exclude: ['test']`), so correctness rides
on `npm test` (runtime) — validation is strict runtime code, not types.

**`test/importEnvelope.test.ts`** (pure; `notionMerge.test.ts` style) — maps ACs 3, 5, 12:
- AC3: `performance` 1..5 → 0/25/50/75/100.
- AC5: a row missing `result` → `errors` entry, not in `games`, no throw; `srDelta: 0` preserved.
- AC12: non-object / missing `games` → envelope-level error, empty games.
- Anchor: valid → returned; bad tier / division 6 / pct 120 → dropped + error.
- Timestamp clamp to `opts.now`; deterministic `matchId` passthrough.

**`test/importFileStore.test.ts`** (store integration; `stores.test.ts` style) — maps AC8:
- `addMany` stamped `importSource:'file'` + a `'notion'` row + a live row (no marks);
  `removeImported('file')` returns only the file rows; `'notion'` + live remain.
  `removeImported('notion')` removes only Notion (incl. a legacy row with `importSource`
  unset, via `COALESCE`). `importedCount('file')` / `('notion')` are scoped.
- **Migration:** open a store whose DB lacks the column (create via a hand-rolled
  pre-migration `CREATE TABLE`, or delete the column definition in a fixture), reopen with
  the real `HistoryStore`, assert `PRAGMA table_info` now lists `importSource` and both
  clears work. (Close every store before `rmSync` — Windows SQLite lock.)

**`test/importFileProvider.test.ts`** (provider + in-memory history fake;
`importNotionProvider.test.ts` style) — maps ACs 7, 9, 10, 11:
- AC7: `importFromFile` with `pick()` returning a 2-game envelope → `{ imported: 2, skipped: 0 }`
  and each stored row carries `importSource:'file'` + `importedAt`; a second identical
  import → `{ imported: 0, skipped: 2 }` (idempotent dedup).
- AC9: `deleteFileImports()` then re-import → set matches the new envelope; a live row survives.
- AC10: anchor present → `rankAnchors.set` called once with `setAt === max(imported comp
  timestamp)` (a spy asserts it is **not** `Date.now()`); `accountsAdded` seeds `Lampenlicht`.
- AC11: anchor absent → `rankAnchors.set` **not** called; a pre-existing anchor untouched.
- Cancelled `pick()` (`undefined`) → `{ imported: 0, … , cancelled: true }`, no store writes.

**Script (`scripts/import-obsidian.ps1`)** — no vitest coverage (PowerShell); verified
manually against the real vault (AC1, AC2, AC4, AC6): run it on the 98-file sample →
assert 97 games, the empty file skipped and reported, a re-run yields byte-identical
`matchId`s, a Europe/Berlin `timestamp` matches the wall clock, and `Watchpoint
Gibraltar`/`Neon Junction` canonicalize. Documented as a manual check in `docs/import.md`.

**DoD gate (AC14):** `npm test` + `npm run typecheck` (main + renderer) green; README /
`docs/import.md` updated.

---

## Risks & Alternatives

**R1 — Provenance marker (the central design call).** Chosen: a typed
`importSource: 'notion' | 'file'` field + scalar column + idempotent migration +
source-scoped clear. *Alternatives considered:*
- *Reuse `importedAt` alone* — one shared "imported" bucket; **fails AC8** (clears Notion
  and file together). Rejected.
- *matchId-prefix discriminator* (`DELETE WHERE matchId LIKE 'manual-import-%'`) — zero
  schema change, leans on the existing prefix-provenance precedent (`source.ts:9-12`), and
  keeps the Notion path untouched (file rows simply don't set `importedAt`). Lighter, but
  stringly-typed and couples clearing to the id format. **Viable fallback** if we want to
  avoid the first DB migration; noted for the implementer.

**R2 — First DB migration in `history.ts`.** No migration machinery exists today; `open()`
only runs `CREATE … IF NOT EXISTS`. Adding an idempotent `PRAGMA table_info` + `ALTER
TABLE` is small and safe, and fresh installs (the friend) get the column from `SCHEMA_SQL`
regardless. Risk is low but it is net-new infrastructure — covered by a migration test.

**R3 — PowerShell fragility.** (a) `ConvertTo-Json` default `-Depth 2` silently truncates
nested games → **must** pass `-Depth 12`. (b) No YAML parser in PS 5.1 → hand-parsed
frontmatter; tolerant to blank/extra fields, skips + reports anything unparseable so a
format drift degrades gracefully rather than corrupting output. (c) UTF-8 read/write for
accented map names.

**R4 — Timezone/DST.** date+time interpreted as the importing machine's local time (per
decision). A match logged during the one ambiguous DST fall-back hour could be off by an
hour; acceptable for a stats coach, documented in `docs/import.md`.

**R5 — Anchor semantics.** The supplied rank must be the rank **after** the most recent
match (current rank now), because forward replay uses strict `> setAt` and older matches
reconstruct backward from it. Rank-protection detail is flattened on backward-reconstructed
matches (best-effort, `reconstruct.ts:73`). Both documented in the help panel + `docs/import.md`.

**R6 — Unmatched maps → `Unknown` mode.** `makeMapMode` does exact-name lookup
(`masterData/resolver.ts:12-15`), so any map the script can't canonicalize groups under
`Unknown`. Mitigated by embedding the Vantage catalog + reporting unmatched names; the
sample vault has no such cases after the two aliases.

**R7 — Account visibility.** Dashboard filters derive accounts from stored games (so
imported games appear), but the Settings → Accounts manager reads only `config.accounts`.
`seedImportedAccounts` registers `"Lampenlicht"` (mirrors Notion) — bonus: later live GEP
play under the real battleTag resolves to the same label via `resolveAccount`'s name
fallback, unifying imported + live history.

**R8 — Scope of the Notion touch.** Stamping `importSource:'notion'` and adding
`COALESCE(…, 'notion')` to the Notion clear/count is a minimal, back-compat-safe change,
but it does touch a shipped path — covered by keeping the existing
`importNotionProvider.test.ts` green plus the new scoped-clear test.
