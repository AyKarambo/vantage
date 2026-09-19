# Importing match history from a file

Vantage can import match history from a **Vantage import file** — a small JSON document — so you
can keep tracking matches in another tool and periodically pull them into Vantage. Imported matches
are **tagged as file-imports**, so you can clear and re-import them cleanly without touching your
live-tracked, hand-logged, or Notion-imported games.

There are two pieces:

1. **`scripts/import-obsidian.ps1`** — converts an [Obsidian](https://obsidian.md) match vault into a
   Vantage import file.
2. **Settings → Backup & import** — the in-app action that reads a Vantage import file into history,
   and **Export backup…** — a full local backup written in the same format (games, accounts, rank
   anchors, targets), for restoring your own history on another machine.

If your data lives somewhere other than Obsidian, you can produce the same JSON with any tool — the
[format](#the-vantage-import-file-format) is documented below and mirrored in the in-app help panel.

---

## Obsidian → Vantage (the script)

The vault is expected to hold one markdown file per match under a `match/` subfolder, each with YAML
frontmatter like:

```yaml
---
date: 2026-07-05
time: 18:42
map: Busan
result: Loss          # Win | Loss | Draw
mode: Ranked
heroes: [Winston, Sigma]
performance: 4        # 1–5 stars
sr_change: -27        # signed, no unit
---
```

Run the script (Windows PowerShell 5.1 — no install needed; it only writes a JSON file):

```powershell
# From a repo checkout:
npm run import:obsidian -- -VaultPath "C:\path\to\vault" -OutFile "vantage-import.json" -CurrentRank "Diamond 3"

# Or the script directly (no checkout needed — just copy the .ps1):
powershell -ExecutionPolicy Bypass -File import-obsidian.ps1 -VaultPath "C:\path\to\vault" -OutFile "vantage-import.json"
```

**Parameters**

| Parameter | Default | Notes |
|-----------|---------|-------|
| `-VaultPath` | *(required)* | The vault root; must contain a `match/` subfolder of `*.md` files. |
| `-OutFile` | `vantage-import.json` | Where to write the import file. |
| `-Account` | `Lampenlicht` | The account label stamped on every imported match. |
| `-CurrentRank` | *(none)* | Your **current** rank, e.g. `"Diamond 3"` or `"Diamond 3 45%"`. Sets the rank anchor. |

**What it does**

- Maps each match's `date`+`time` to a timestamp (your machine's **local** time zone).
- Maps `performance` stars `1/2/3/4/5` → `0/25/50/75/100`.
- Canonicalizes map names to Vantage's spelling (e.g. `Watchpoint Gibraltar` → `Watchpoint: Gibraltar`,
  `Neon Junktion` → `Neon Junction`); unknown maps are kept verbatim and listed in the summary.
- Gives each match a **deterministic id** derived from its filename, so re-running the script and
  re-importing only adds matches that are new — nothing duplicates.
- Skips files with no frontmatter or no `result`, and reports how many were skipped.
- Drops fields Vantage doesn't model (solo/duo, duo partner, note bodies).

## Importing in the app

1. Open **Settings → Backup & import**.
2. Click **Import from file…** and choose your `vantage-import.json`.
3. The result line reports how many matches were imported, skipped (already present), or invalid, and
   whether a rank anchor was set. A persistent "Last import" line under the buttons keeps saying how
   many matches are currently imported and when, so you don't have to re-run an import to check.

To re-sync after editing matches in your other tool, use **Remove imported matches** and import the
freshly-generated file again. Only file-imports are removed — live, hand-logged, and Notion-imported
matches are left intact.

## Backing up your own history

**Export backup…** on the same card writes a **v2** Vantage import file — a superset of the format
below that also carries every game's review/mental self-report, every configured account, every
(account, role) rank anchor (not just one), and every authored target. It's meant for moving your
*own* history to a new machine, not for a companion tool to hand-write — use **Import from file…**
with the resulting file the same way as any other import file. Re-importing a v2 backup currently
restores its games (with review/mental) and its single legacy `anchor`, same as a v1 file; full
restoration of the `accounts`/`rankAnchors`/`targets` sections on import is not yet wired up.

## Ranks (SR)

Your tracker records the SR **change** per match but not an absolute rank. Vantage reconstructs an
absolute rank from a single **anchor**:

- Pass `-CurrentRank` with the rank you're at **right now** (after your most recent match).
- The anchor is set at your **latest imported competitive match**, and earlier matches' ranks are
  reconstructed *backward* from it using each match's SR change.
- Because it walks backward, rank-protection detail on older matches is **approximate** — the SR
  trend is faithful; a specific old division may be off by the protection buffer.
- Omit `-CurrentRank` to import SR changes only (no absolute rank shown). Importing without an anchor
  never clears an anchor you already set.

Tiers: `Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster, Champion`. Division `1` is the
highest band of a tier, `5` the lowest. `progressPct` is `0–100` within the division.

## The Vantage import file format

```jsonc
{
  "vantageImport": 1,                          // schema version
  "account": "Lampenlicht",                    // default account for every game below
  "anchor": {                                  // optional — omit to skip rank anchoring
    "role": "tank",
    "tier": "Diamond",                         // one of the 8 tiers (exact case)
    "division": 3,                             // 1 (highest) … 5 (lowest)
    "progressPct": 45                          // 0 … 100 within the division
  },
  "games": [
    {
      "matchId": "manual-import-2026-07-05-18-42-busan",  // stable per match → idempotent re-import
      "timestamp": 1751733720000,              // epoch milliseconds
      "map": "Busan",                          // free-form; use Vantage's spelling for correct grouping
      "result": "Loss",                        // Win | Loss | Draw (required)
      "heroes": ["Winston", "Sigma"],
      "account": "Lampenlicht",                // optional — defaults to the envelope "account"
      "role": "tank",                          // optional — defaults to "tank"
      "gameType": "Competitive",               // optional — defaults to "Competitive"
      "srDelta": -27,                          // optional signed SR change
      "performance": 75                        // optional self-rating, 0–100
    }
  ]
}
```

**Rules**

- Each game **must** have `matchId`, `timestamp`, `map`, and a recognizable `result`. Rows missing
  those are skipped and counted as *invalid* (the rest still import).
- `account`, `role`, and `gameType` fall back to the envelope `account`, `"tank"`, and
  `"Competitive"` when omitted.
- Re-import is idempotent: a `matchId` already in history is skipped, never duplicated. Editing a
  match in your source tool won't update the already-imported copy — use **Remove imported matches**
  and re-import for a clean re-sync.
- A malformed file (not a valid envelope) is rejected with a message and nothing is written.

## The v2 (full backup) format

`vantageImport: 2` is a superset written only by **Export backup…** — a v1 file never has these
extra sections, and a v2 file's `games` entries can carry `mental`/`review` blocks (the same shapes
the app itself uses) that a v1 file never did.

```jsonc
{
  "vantageImport": 2,
  "exportedAt": 1751733720000,
  "accounts": [
    { "battleTag": "You#1234", "label": "Main" }
  ],
  "rankAnchors": [
    { "account": "Main", "role": "damage", "tier": "Gold", "division": 3, "progressPct": 40, "setAt": 1751000000000 }
  ],
  "targets": [ /* AuthoredTarget objects, as stored */ ],
  "games": [
    {
      "matchId": "…", "timestamp": 1751733720000, "map": "Busan", "result": "Loss", "heroes": ["Winston"],
      "mental": { "tilt": true, "comms": "positive" },
      "review": { "at": 1751733999000, "grades": { "targetId": "hit" }, "flags": { "toxicMates": true } }
    }
  ]
}
```
