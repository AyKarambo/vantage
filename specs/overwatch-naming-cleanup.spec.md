# Spec: `overwatch-naming-cleanup`

## Intent (WHAT & WHY)

The product's game — Blizzard's *Overwatch* — is once again branded simply **"Overwatch"**,
not "Overwatch 2". Vantage's docs, wiki-style onboarding, marketing/store copy, user-visible
UI, code comments, and spec archive still call it **"Overwatch 2"** (and the abbreviation
**"OW2"**) in ~40 places. This is now factually stale branding: it dates the product, confuses
new users and Overwolf store reviewers, and makes the copy read as if it's tracking a game that
no longer exists under that name.

**Why it matters:** correct, current product naming across every reader-facing and
developer-facing surface — the app, the store listing, the README, the onboarding docs, and the
code. One term, used consistently.

## In-Scope / Out-of-Scope

**In-Scope** (full, consistent rename everywhere):
- **Root & packaging:** `README.md`, `package.json` (`description`), `CLAUDE.md` (project
  constitution one-liner).
- **Docs / "wiki":** `docs/overwolf-submission.md`, `docs/onboarding/*` (`README.md`,
  `01-getting-started.md`, `02-architecture.md`), and any `docs/legal/*` occurrences.
- **User-visible UI strings:** `renderer/src/app/onboarding.ts`, `renderer/src/views/about.ts`
  (and any other renderer copy).
- **Source-code comments & log strings:** `src/core/{heroes,maps,progression,season}.ts`,
  `src/core/rank/{engine,types}.ts`, `src/core/matchAggregator/keys.ts`,
  `src/main/config/appConfig.ts`, `src/main/gep.ts`.
- **Overwolf/GEP integration & store identity:** normalize the human-readable label to
  "Overwatch"; **keep the numeric game id `10844` unchanged**.
- **Spec archive:** all `specs/*.md` / `*.research.md` references.
- Both the full phrase **"Overwatch 2"** and the abbreviation **"OW2"** → **"Overwatch"** (or
  "OW" where the abbreviation form fits the surrounding shorthand). **Blanket** — including
  version-flavoured mentions like "current Overwatch 2 rank model", "maps that exist only in
  Overwatch 2's Stadium mode", "OW2-style rank protection".

**Out-of-Scope:**
- The numeric Overwolf game id `10844` and any GEP feature/key **string literals** (protocol
  identifiers — comments around them change, the strings do not).
- Code **identifiers** (variable/function/field names) — none currently encode "OW2"; this is a
  text-only rename.
- False-positive tokens that merely contain the substring: `pow2`/`Pow2` in
  `package-lock.json` integrity hashes; `row1`/`row2`/`groupBRow2` in
  `test/notionRuntime.test.ts`.
- **External URLs** that contain the old slug (e.g. the Blizzard forum link
  `…/overwatch-2-api/19214`) — the URL target must stay valid; only surrounding prose changes.
- A separate GitHub project **wiki** (none exists in-repo; if one exists off-repo it can't be
  edited from here).
- The SDD planning artifacts for *this* task (this spec, `.claude/sdd/phase`) — they
  legitimately quote "Overwatch 2" and are not sweep targets.

## Constraints
- **Text-only, behaviour-preserving.** No logic, identifiers, ids, protocol strings, or URLs
  change. `npm test` and `npm run typecheck` (main + renderer) must remain green with no
  code-logic edits required.
- **ASCII diagrams stay aligned.** `docs/onboarding/02-architecture.md` and `README.md` contain
  ASCII flow diagrams with an "Overwatch 2" box/node; shortening to "Overwatch" must preserve
  box/arrow alignment.
- **Lockfile integrity untouched.** `package-lock.json` must not be modified by the rename (its
  `pow2` hits are hash noise).
- **CLAUDE.md guardrails intact.** Guardrail language and the "account-safe … stats coach"
  positioning are preserved verbatim except for the game name.
- Follow repo conventions (2-space indent, single quotes, semicolons); match each file's
  surrounding style.

## Acceptance Criteria (Given / When / Then)

1. **Given** the repository after the change, **When** I search all tracked, non-excluded files
   case-insensitively for `Overwatch 2`, `Overwatch2`, `OW2`, or `Overwatch II`, **Then** zero
   matches remain — except the documented exclusions (`package-lock.json` hash noise,
   `row2`-style test variables, external URLs, and this task's own SDD artifacts).

2. **Given** the running app's onboarding and About screens, **When** a user reads the product
   tagline, **Then** it says "Overwatch" (e.g. "Account-safe Overwatch stats coach") with no "2".

3. **Given** `docs/overwolf-submission.md`, **When** a reviewer reads the target-game, one-liner,
   description, and keyword fields, **Then** the game is named "Overwatch", the numeric id
   `10844` is still present and unchanged, and no "Overwatch 2" label remains.

4. **Given** the source files under `src/`, **When** the comments and any log/console strings are
   read, **Then** they reference "Overwatch"/"OW" with no "Overwatch 2"/"OW2", while every GEP
   key string literal and the game id `10844` are byte-for-byte unchanged.

5. **Given** the ASCII diagrams in `README.md` and `docs/onboarding/02-architecture.md`, **When**
   rendered as monospace, **Then** the "Overwatch" node/box and its connectors remain visually
   aligned.

6. **Given** `package-lock.json` and `test/notionRuntime.test.ts`, **When** the change is diffed,
   **Then** neither file is modified (no `pow2`/`row2` collateral edits).

7. **Given** the external Blizzard forum link in `specs/editable-master-data.spec.md`, **When**
   the change is diffed, **Then** the URL target (`…/overwatch-2-api/…`) is unchanged even though
   surrounding prose is normalized.

8. **Given** the full change set, **When** `npm test` and `npm run typecheck` run, **Then** both
   pass with no new failures.

## Resolved questions
- **Scope of surfaces?** → **Everything, including `specs/*`.** The historical spec archive is
  normalized too, not just living docs/code.
- **`OW2` abbreviation & version-meaningful mentions?** → **Blanket rename.** Every
  "Overwatch 2"/"OW2" becomes "Overwatch"/"OW" regardless of whether "2" once distinguished
  sequel-era mechanics.
- **Overwolf/GEP integration & store identity?** → **Normalize everywhere**, keeping the numeric
  game id `10844` unchanged (only the human-readable label changes).
- **"Wiki" meaning?** → No in-repo `wiki/` folder exists; "wiki" is interpreted as `docs/`
  (onboarding + legal). A separate off-repo GitHub wiki, if any, is out of scope.
- **Store keyword `overwatch 2`** (was open) → **Normalize to `overwatch`.** Default taken:
  consistent naming wins over retaining the old term purely for store discoverability.
- **"OW" vs spelled-out "Overwatch" for the abbreviation** (was open) → Prefer **"OW"** where the
  terse form reads naturally in code comments (e.g. "OW-style rank protection"); spell out
  **"Overwatch"** in prose.

## Open Questions
- None. (Defaults applied to the two prior open items; use `/revise` if either should change.)
