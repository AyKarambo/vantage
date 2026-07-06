# Techplan: winrate-color-scheme

Derived from `specs/winrate-color-scheme.spec.md`. Grounded in a parallel codebase survey
(wr-color consumers, CSS tokens, colorblind/prefs plumbing, settings UI primitives, the
continuous ramp, and the test surface).

## Architecture & Approach

A **winrate scheme** is a named set of winrate colours applied through the two channels the
app already uses, in lockstep:

1. **CSS custom properties** on `<html>` — today a boolean `data-cvd` attribute flips the
   `--win*/--loss*/--mid*` token family. We generalise this to a single **`data-wr` enum
   attribute** with values `aurora` | `teal-coral` | `colorblind`, and fold the old
   colourblind palette in as one of those values (removing `data-cvd`).
2. **The JS `PALETTE` mirror** in `theme.ts` — SVG charts need literal colours, so
   `PALETTE.{win,winText,loss,lossText,mid}` is swapped to match the active scheme (exactly
   as `setColorblind` does today).

The **default scheme is `aurora`**, and its values are baked directly into `:root` in
`tokens.css`. That means a missing/*unset* `data-wr` attribute is already correct — no flash
of the old colours even before JS runs, and the old vivid green/red trio is simply deleted
from source (AC1, AC7-adjacent).

### Single source of truth (DOM-free, testable)

New module **`renderer/src/winrateScheme.ts`** — pure, imports nothing from `dom.ts`/
`document`/`prefs` — owns:
- the `WinrateScheme` type and the `WINRATE_SCHEMES` data (JS colour values + continuous-ramp
  hue function per scheme),
- `resolveWinrateScheme(stored, legacyColorblind)` — the resolution + legacy-migration logic.

`theme.ts` consumes it to *apply* a scheme (touch `document`, swap `PALETTE`, persist);
`prefs.ts` imports only its type; the vitest suite exercises it directly (the repo already
unit-tests DOM-free renderer modules — see `test/filterMigration.test.ts`). This keeps the
migration/resolution logic verifiable without a DOM, satisfying the Definition of Done's
"new pure logic ships with tests" spirit even though it lives under `renderer/`.

### Continuous ramp

`wrHue()`/`wrHsl()` are consumed in only two places (overview focus-map dots). Keep `wrHue`'s
winrate→`t` normalisation, but delegate `t → hue` to the active scheme's ramp function so each
scheme's dots match its discrete buckets. Colourblind keeps its **non-linear split**
(orange→blue, skipping green) — represented as a per-scheme function, not linear endpoints,
so linearising can't reintroduce a green midpoint (accessibility guard).

## Affected Files / Modules

| File | Change |
| --- | --- |
| `renderer/src/winrateScheme.ts` *(new)* | `WinrateScheme` type; `WINRATE_SCHEMES` (per-scheme `win/winText/loss/lossText/mid` + `hue(t)` ramp); `resolveWinrateScheme(stored, legacyColorblind)`. No DOM/prefs imports. |
| `renderer/src/theme.ts` | Remove `DEFAULT_WIN_LOSS`/`CVD_WIN_LOSS`, `cvd` flag, `isColorblind`/`setColorblind`. Add `activeScheme`, `getWinrateScheme()`, `setWinrateScheme(name)` (swaps `PALETTE`, toggles `data-wr`, persists). Bundle-load resolves + migrates via `resolveWinrateScheme` and applies before first paint. `wrHue`/`wrHsl` read `activeScheme`. **Keep** `CATEGORICAL`/`MODE_COLORS`/`OTHER_COLOR` (already harmonised — AC7). |
| `renderer/src/prefs.ts` | Import `WinrateScheme` type. Add `winrateScheme: WinrateScheme` to `PrefsShape`. Keep the legacy `colorblind?: boolean` field (read-only, for migration; annotate deprecated). |
| `renderer/styles/tokens.css` | Set `:root` `--win*/--loss*/--mid*` to the **Aurora** values. Replace the `html[data-cvd]{…}` block with `html[data-wr="teal-coral"]{…}` and `html[data-wr="colorblind"]{…}` override blocks (full families; colourblind mirrors today's blue/orange, keeps `--mid` amber). |
| `renderer/src/views/settings.ts` | Replace the colourblind `chip` with a `segmented` "Winrate colours" picker (Aurora / Teal & coral / Colorblind) bound to `get/setWinrateScheme` + `store.rerender()`; update the hint text. Drop the `isColorblind/setColorblind` import. |
| `test/winrateScheme.test.ts` *(new)* | Unit tests for `resolveWinrateScheme` (incl. legacy migration) and `WINRATE_SCHEMES` integrity. |

No other consumers change: every other surface (map bars, mode cards, hero WR text, match
W/L pills, stat/severity signals, readiness bands, targets chips, calendar heatmap, status
dots, log lines) reads the `--win*/--loss*/--mid*` tokens or `PALETTE`, so they recolour
automatically when the scheme swaps — that is the mechanism behind AC6.

## Data Model / Interfaces

```ts
// renderer/src/winrateScheme.ts
export type WinrateScheme = 'aurora' | 'teal-coral' | 'colorblind';

export interface SchemePalette {
  win: string; winText: string;      // JS mirror of --win / --win-text
  loss: string; lossText: string;    // --loss / --loss-text
  mid: string;                       // --mid
  /** Continuous winrate ramp: normalised t∈[0,1] (loss→win) → CSS hue degrees. */
  hue(t: number): number;
}

export const WINRATE_SCHEMES: Record<WinrateScheme, SchemePalette>;

/** Pick the active scheme from stored prefs, migrating the legacy boolean. */
export function resolveWinrateScheme(
  stored: unknown,          // prefs.get('winrateScheme')
  legacyColorblind: unknown // prefs.get('colorblind')
): { scheme: WinrateScheme; migratedFromColorblind: boolean };
```

Resolution rules: a valid stored scheme name wins; else legacy `colorblind === true` →
`colorblind` (with `migratedFromColorblind: true`); else `aurora`. On migration, `theme.ts`
persists the resolved scheme and `prefs.remove('colorblind')` so the legacy key doesn't linger.

### Colour values (derived; anchors from the approved spec)

| Token | Aurora *(default)* | Teal & coral | Colorblind *(unchanged)* |
| --- | --- | --- | --- |
| `--win` | `#65bda6` | `#63b6ad` | `#4f8fd6` |
| `--win-text` | `#98ddca` | `#98d7d1` | `#9cc3ec` |
| `--win-soft` | `rgba(101,189,166,.18)` | `rgba(99,182,173,.18)` | `rgba(79,143,214,.18)` |
| `--win-border` | `rgba(101,189,166,.5)` | `rgba(99,182,173,.5)` | `rgba(79,143,214,.5)` |
| `--mid` | `#bca976` | `#b4a27e` | `#d6a24f` (amber, kept) |
| `--mid-text` | `#dac99a` | `#d6c5a4` | `#e0b878` |
| `--loss` | `#ca777f` | `#d1887b` | `#d68a3a` |
| `--loss-text` | `#dca3a8` | `#e2b0a7` | `#e0ac72` |
| `--loss-soft` | `rgba(202,119,127,.16)` | `rgba(209,136,123,.16)` | `rgba(214,138,58,.14)` |
| ramp `hue(t)` | `8 → 162` (linear) | `11 → 176` (linear) | `t<.5: 28+t·24` else `200+(t-.5)·30` |

`--track` is scheme-independent (stays `rgba(255,255,255,.06)`). The JS `PALETTE` uses the
`win/winText/loss/lossText/mid` column values above.

## Test Strategy

- **Unit (`test/winrateScheme.test.ts`, node env, no DOM):**
  - `resolveWinrateScheme`: each valid name passes through; `undefined`/garbage → `aurora`;
    legacy `colorblind:true` → `colorblind` + `migratedFromColorblind:true`; `false`/absent →
    `aurora`, no migration. (AC1, AC4)
  - `WINRATE_SCHEMES` integrity: all three keys present; every colour a valid hex/`rgba`;
    `hue(0)`≠`hue(1)` and both ∈ [0,360); aurora & teal-coral have a warm `hue(0)` and a
    cool `hue(1)`; colourblind `hue` never lands in the green band (~90–150) across t∈[0,1]
    (accessibility guard). (AC3, AC6)
- **Typecheck + full suite:** `npm run typecheck` + `npm test` green (DoD 1–2).
- **Preview-harness acceptance checks** (browser preview, sample season):
  - Fresh state → Aurora everywhere; no old green/red anywhere (AC1).
  - Settings picker → select **Teal & coral** then **Colorblind**; confirm map bars, mode
    cards, match W/L, stats, overview scatter dots, trends heatmap, readiness all follow, and
    the choice persists across a reload (AC2, AC3, AC6).
  - Exactly one control; three mutually-exclusive options with the active one marked (AC5).
  - Seed `localStorage['vantagePref.colorblind']=true`, reload → Colorblind pre-selected;
    `false`/unset → Aurora (AC4).
  - Categorical donut/scatter stay the harmonised "aurora dusk" set under every scheme (AC7).

## Risks & Alternatives

- **Shared semantic tokens.** `--win/--loss/--mid` are reused by non-winrate UI (status
  dots, log warn/error, readiness bands, targets chips). Swapping schemes shifts those too —
  **intended**: it's the same good/bad/warn language and the point is app-wide harmony;
  `data-cvd` already behaved this way. Called out so it isn't mistaken for a regression.
- **JS/CSS drift.** Two mirrors of the same colours. Mitigation: `winrateScheme.ts` is the
  JS source of truth; `tokens.css` carries a "keep in sync with winrateScheme.ts" comment
  (as `theme.ts` does today); the unit test pins the documented anchor values.
- **First-paint flash.** Mitigated by baking Aurora into `:root` and applying the persisted
  scheme synchronously at bundle load (existing pattern).
- **Colourblind ramp regression.** Keeping a per-scheme `hue(t)` *function* preserves the
  orange→blue split; a test asserts no green midpoint.
- **Alternatives considered:** separate colourblind toggle (rejected — user chose one folded
  picker); three boolean attributes vs one `data-wr` enum (enum chosen for a clean single
  cascade); read computed CSS in JS instead of a mirror (rejected — SVG fills need literals;
  the mirror is the established pattern).
