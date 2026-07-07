# Tasks: winrate-color-scheme

From `specs/winrate-color-scheme.plan.md`. Ordered so dependencies come first. Each task is
small and individually reviewable.

- [x] **T1 — DOM-free scheme module (`winrateScheme.ts`)**
  - **Goal:** One pure source of truth for scheme identity, JS colour values, the per-scheme
    continuous-ramp `hue(t)` function, and `resolveWinrateScheme(stored, legacyColorblind)`.
  - **Files:** `renderer/src/winrateScheme.ts` *(new)*
  - **Check:** Compiles; imports no DOM/prefs; `WINRATE_SCHEMES` holds `aurora`, `teal-coral`,
    `colorblind` with the plan's anchor values; `resolveWinrateScheme` returns the documented
    scheme + `migratedFromColorblind` flag.
  - **Size:** M

- [x] **T2 — Unit tests for the scheme module**
  - **Goal:** Lock resolution/migration and palette integrity before wiring anything.
  - **Files:** `test/winrateScheme.test.ts` *(new)*
  - **Check:** `npm test` green — valid names pass through; garbage/undefined → `aurora`;
    legacy `colorblind:true` → `colorblind` (+migrated flag), `false`/absent → `aurora`; all
    colours valid; ramp endpoints distinct & in-range; colourblind ramp never enters the green
    band.
  - **Size:** S–M

- [x] **T3 — Scheme-based `theme.ts`**
  - **Goal:** Replace the colourblind boolean machinery with scheme apply/get/set; make
    `wrHue`/`wrHsl` scheme-aware; resolve + migrate + apply at bundle load before first paint;
    keep the harmonised categorical palette (AC7).
  - **Files:** `renderer/src/theme.ts`
  - **Check:** `npm run typecheck` clean; `getWinrateScheme`/`setWinrateScheme` exported; no
    `isColorblind`/`setColorblind`/`data-cvd` references remain; `PALETTE` swaps per scheme;
    `CATEGORICAL`/`MODE_COLORS`/`OTHER_COLOR` unchanged.
  - **Size:** M

- [x] **T4 — `prefs.ts` schema + legacy field**
  - **Goal:** Persist the new choice; keep the legacy boolean readable for one-time migration.
  - **Files:** `renderer/src/prefs.ts`
  - **Check:** `typecheck` clean; `winrateScheme: WinrateScheme` in `PrefsShape`; legacy
    `colorblind?: boolean` retained and annotated deprecated; storage stays error-safe (AC8).
  - **Size:** S

- [x] **T5 — `tokens.css` scheme blocks**
  - **Goal:** Make Aurora the `:root` default (deleting the old green/red trio) and add
    override blocks for the other two schemes.
  - **Files:** `renderer/styles/tokens.css`
  - **Check:** In preview, default is Aurora; `html[data-wr="teal-coral"]` and
    `html[data-wr="colorblind"]` recolour the full `--win*/--loss*/--mid*` families;
    colourblind matches today's blue/orange (mid stays amber); `--track` unchanged.
  - **Size:** M

- [x] **T6 — Settings "Winrate colours" picker**
  - **Goal:** Replace the colourblind chip with one mutually-exclusive `segmented` picker.
  - **Files:** `renderer/src/views/settings.ts`
  - **Check:** Appearance card shows exactly one control with Aurora / Teal & coral /
    Colorblind; selecting one calls `setWinrateScheme` + `store.rerender()` and recolours the
    app; hint text updated; no `isColorblind` import left. (AC2, AC3, AC5)
  - **Size:** S–M

- [x] **T7 — Verify + docs**
  - **Goal:** Confirm acceptance criteria end-to-end and update any user-facing docs that
    mention the old colourblind toggle.
  - **Files:** `docs/**`, `README.md` *(only if they reference the toggle/appearance)*
  - **Check:** Preview run passes AC1–AC8 (default, switch, persist across reload, legacy
    migration by seeding `vantagePref.colorblind`, categorical retained); `npm test` +
    `npm run typecheck` green; docs mention the scheme picker, not a colourblind on/off toggle.
  - **Size:** S–M

## Consistency check (spec ↔ tasks)

| Acceptance criterion | Covered by |
| --- | --- |
| AC1 — Default is Aurora | T1 (values), T3 (load default), T5 (`:root` + delete old trio); verified T7 |
| AC2 — Switch applies everywhere, persists | T3 (apply+persist), T5 (tokens), T6 (picker); verified T7 |
| AC3 — Colorblind is one of the schemes | T1 (palette+ramp), T3, T5 (block), T6 (option); guard T2; verified T7 |
| AC4 — Legacy migration | T1 (`resolveWinrateScheme`), T3 (apply + remove legacy key), T2 (test); verified T7 |
| AC5 — Single mutually-exclusive control | T6; verified T7 |
| AC6 — App-wide consistency (buckets, ramp, tokens, PALETTE) | T1 + T3 + T5; integrity T2; verified T7 |
| AC7 — Categorical palette retained | T3 (keep CATEGORICAL); verified T7 |
| AC8 — Storage resilience | T4 (error-safe facade) + T3 (garbage→aurora); test T2 |

**Gaps:** none — every acceptance criterion maps to at least one task.
**Scope creep:** none — every task traces to at least one criterion (T7 is verification/docs
required by the Definition of Done).
