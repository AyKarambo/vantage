---
status: done
updated: 2026-07-06
---

# Spec: winrate-color-scheme

## Intent (WHAT & WHY)

Vantage's visual identity is aurora-purple on near-black — restrained and cohesive. The
winrate colour language (green = winning, amber = middling, red = losing) is a
"traffic-light" trio that reads as a *foreign* colour system next to that identity: it is
the one thing on screen that looks out of place. Because winrate is the app's central
metric, that trio appears almost everywhere (map bars, mode cards, match W/L indicators,
stat colours, the overview scatter, the trends heatmap, readiness), so the clash is
pervasive.

We want winrate colours that still communicate good/bad at a glance **but belong to the
aurora palette** — and we want the user to choose the register that suits them, including
keeping an accessible colourblind option.

## In-Scope

- Replace the current **Colorblind-safe palette on/off** toggle in *Settings → Appearance*
  with a single, mutually-exclusive **"Winrate colours"** picker offering three schemes:
  - **Aurora** *(default — the new baseline)* — teal-green win / muted-bronze mid /
    dusty-rose loss. Anchors: win `#65bda6`, mid `#bca976`, loss `#ca777f`.
  - **Teal & coral** — teal win / neutral-sand mid / coral loss. Anchors: win `#63b6ad`,
    mid `#b4a27e`, loss `#d1887b`.
  - **Colorblind (blue–orange)** — the existing accessibility palette (win `#4f8fd6`,
    loss `#d68a3a`), now selected as one of the three options rather than a separate toggle.
- The selected scheme retunes the **entire winrate colour system app-wide**: the CSS token
  family (`--win`/`--win-text`/`--win-soft`/`--win-border`, `--loss`/`--loss-text`/
  `--loss-soft`, `--mid`/`--mid-text`), the JS `PALETTE` mirror in `theme.ts`, and the
  **continuous winrate ramp** (`wrHue`/`wrHsl`, used by the scatter dots and calendar heatmap).
- Persist the choice as a renderer-local preference (new `prefs.winrateScheme`), applied at
  bundle load before first paint — mirroring how `setColorblind` works today so there is no
  colour flash.
- **Migrate** the legacy `prefs.colorblind` boolean: `true` → `colorblind` scheme;
  `false`/unset → `aurora`.
- **Keep** the already-applied harmonised "aurora dusk" categorical palette (Maps donut /
  Overview scatter). It stays as merged; this spec only ensures it is retained.

## Out-of-Scope

- Any further change to the categorical chart palette (already done; only preserved here).
- Re-theming non-winrate colours (aurora accent, surfaces, borders, background) — untouched.
- A free-form custom colour picker or per-chart colour overrides.
- Light mode / theme switching beyond winrate colours.
- Changing colourblind *semantics* — it remains blue/orange; it only moves into the picker.

## Constraints

- **Renderer-only.** Expected touch points: `renderer/src/theme.ts`, `renderer/src/prefs.ts`,
  `renderer/src/views/settings.ts`, `renderer/styles/tokens.css`. `src/core/` stays pure and
  unchanged (Guardrail 3).
- **CSP-friendly** (Guardrail 4): colours remain static CSS tokens + JS constants; no
  runtime/remote styling.
- Scheme must apply **before first paint** to avoid a flash of the wrong colours (as
  `setColorblind` does at load).
- The **Colorblind** scheme must preserve today's blue/orange win-loss distinction — no
  accessibility regression.
- Exactly **one** control governs winrate colours; the old standalone colourblind chip is
  removed.
- **Definition of Done:** `npm test` + `npm run typecheck` clean. If any scheme-resolution or
  migration logic is extracted as a pure helper, it ships with unit tests; colour token
  values are visually verified in the preview harness (Maps, Overview, Trends, a match row).

## Acceptance Criteria

1. **Default is Aurora**
   *Given* a fresh install (no `winrateScheme` pref, no legacy `colorblind` pref), *When* the
   app loads, *Then* every winrate surface uses the Aurora scheme and the original vivid
   green/red trio appears nowhere.

2. **Switching applies everywhere, immediately, persistently**
   *Given* the *Settings → Appearance* "Winrate colours" picker, *When* the user selects
   **Teal & coral**, *Then* map bars, mode cards, match W/L indicators, stat colours, the
   overview scatter, the trends heatmap, and readiness all re-render in the Teal↔coral
   colours, *and* the choice survives an app restart.

3. **Colorblind is one of the schemes**
   *Given* the picker, *When* the user selects **Colorblind (blue–orange)**, *Then* win-loss
   render blue/orange across every chart and stat exactly as the legacy colourblind mode did,
   *and* no separate colourblind on/off toggle exists anymore.

4. **Legacy migration**
   *Given* an existing user with legacy `prefs.colorblind = true`, *When* they upgrade and
   launch, *Then* the **Colorblind** scheme is pre-selected; *Given* it was `false`/unset,
   *Then* **Aurora** is pre-selected.

5. **Single, mutually-exclusive control**
   *Given* the Appearance card, *Then* exactly one "Winrate colours" control is shown with
   three mutually-exclusive options and the active one clearly indicated; choosing one
   deselects the others.

6. **App-wide consistency**
   *Given* any selected scheme, *Then* the discrete buckets (`wrColor`), the continuous ramp
   (`wrHue`/`wrHsl`), the CSS token family, and the JS `PALETTE` mirror all reflect that
   scheme — no surface shows a colour from a different scheme.

7. **Categorical palette retained**
   *Given* the Maps donut and Overview scatter, *Then* the categorical series use the
   harmonised "aurora dusk" palette (not the original rainbow), regardless of which winrate
   scheme is active.

8. **Storage resilience**
   *Given* `localStorage` is unavailable, *When* a scheme is chosen, *Then* the app falls
   back to the default without throwing (matching existing `prefs` hardening).

## Resolved questions

- **Direction & default:** Aurora diverging (teal ↔ rose) is the default and replaces the
  stoplight trio.
- **Second option:** Teal ↔ coral is offered as a selectable scheme.
- **Categorical change:** Keep the already-applied harmonised donut/scatter palette.
- **Colourblind interaction:** Fold colourblind into a single mutually-exclusive picker
  (Aurora / Teal & coral / Colorblind), replacing the standalone toggle.
- **Classic trio:** Fully replaced — the old vivid green/red is not reachable.
- **Scope:** App-wide — token family + JS `PALETTE` mirror + continuous ramp.
- **Persistence:** Renderer-local pref applied at bundle load, mirroring `setColorblind`;
  legacy `colorblind` boolean migrated.

## Open Questions

1. **Control shape & wording** — segmented control vs three `chip`s vs a `select` dropdown
   for the picker, and final label text ("Winrate colours"; options "Aurora", "Teal & coral",
   "Colorblind (blue–orange)"). *(techplan / UI detail)*
2. **Exact derived values** — the `-text`/`-soft`/`-border` variants and the continuous
   ramp's loss→win hue endpoints per scheme (base win/mid/loss anchored to the values above).
   *(techplan)*
3. **Colorblind scheme's mid bucket** — today the CVD palette leaves `--mid` amber; keep
   amber or neutralise it to sit better with blue/orange? *(techplan)*
