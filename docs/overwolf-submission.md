# Overwolf submission — Vantage

Everything needed to submit **Vantage** to Overwolf, prepared as far as it can be
without account access. It maps our repo to Overwolf's
[Phase 1 roadmap (App idea → submission)](https://dev.overwolf.com/ow-native/getting-started/project-roadmap),
gives copy‑paste store copy, lists the generated assets, and ends with the short
list of steps only you (the account owner) can do.

> **Manifest, the ow-electron way — no `manifest.json`.** Verified three ways: the
> [FAQ](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/ow-electron-faq/)
> (*"Electron app's configurations are handled in the `package.json` file"*), Overwolf's own
> [ow-electron sample repo](https://github.com/overwolf/ow-electron-packages-sample) (no
> `manifest.json`), and the actual **OPK** we packed with `ow-cli` (77 entries, no
> `manifest.json`). Identity + Overwolf config live in `package.json` (`name`+`author` → UID,
> `overwolf.packages`, `build`). The store artifact is the **OPK** — a ZIP of the built app
> (with `package.json` inside `app.asar`), built by `npm run pack:opk`, **not** the NSIS `.exe`.
> The `manifest.json` reference/validation pages you may find are the **ow-native** framework's.

---

## 1. App identity — must match your whitelisted registration

Overwolf derives the app's unique id from **`name` + `author`** in `package.json`.
This must be identical to the app you were whitelisted as, or GEP/console won't bind.

| Field | Value | Source |
|---|---|---|
| `name` | `ow.vantage` | package.json |
| `author` | `Timo Seikel` | package.json |
| `productName` | `Vantage` | package.json `build.productName` |
| `appId` (installer) | `com.timoseikel.vantage` | package.json `build.appId` |
| AppUserModelId | `com.timoseikel.vantage` | src/main/index.ts |
| Overwolf packages | `["gep"]` | package.json `overwolf.packages` |
| Target game | **Overwatch 2 — game id `10844`** | appsettings.json |

**➡ Action:** open the Developer Console and confirm the registered app name/author
match the two values above. If the console shows anything different, change
`package.json` `name`/`author` to match it exactly and rebuild — the UID must line up.

---

## 2. Roadmap phase mapping (Phase 1)

| Step | Requirement | Status | Where |
|---|---|---|---|
| 1. App ideation | Public app + at least one desktop window | ✅ Public; frameless 1300×840 dashboard | src/main/dashboard.ts |
| 2. Choose a framework | Native or Electron | ✅ **ow-electron** | package.json |
| 3. Game compliance | No unfair advantage / ToS-safe | ✅ GEP-only, ban-safe (see §7) | src/main/gep.ts |
| 4. Monetization | Ads or subscription | ⚠ **Ad-free by choice** — confirm with DevRel (§3) | — |
| 5. Submit app idea | Proposal form | ⏳ Copy ready in §3 — you submit |

---

## 3. App proposal — copy‑paste answers

Use these when filling the "Submit your app idea" form.

- **App name:** Vantage
- **Public or private:** Public
- **Framework:** Overwolf Electron (ow-electron)
- **Target game:** Overwatch 2 (10844)
- **Category:** Stats / Statistics
- **One-liner:** A personal Overwatch 2 stats coach — turns your match history into
  priority maps, exact per-hero stats, mental tracking and improvement targets.
- **Desktop window:** Yes — a frameless desktop dashboard (no in-game overlay). The
  app runs from a Windows tray icon and opens the dashboard window; relaunching it
  brings the window to the front (Overwolf front-app behavior).
- **Data source / how it works:** Overwolf **Game Events Provider (GEP)** only. It
  reads sanctioned events (your own account, map, role, match outcome, your own
  scoreboard). It never reads game memory, never injects, and exposes nothing the
  player can't already see — so there is no competitive advantage and no ban risk.
- **Monetization:** **None — the app is free and ad-free by choice.** There is no ad
  container in the UI. Overwolf usually expects ads or a subscription, so flag this in
  the proposal and confirm an ad-free app is acceptable for this scope; a subscription
  tier could be added later if required. *(Do not claim ads — the ad slot was removed.)*
- **Why it's a good fit:** Fills the "what should I actually practice?" gap that raw
  trackers miss — it ranks maps by *net losses × volume*, tracks per-hero efficiency,
  and correlates a mental/tilt log with winrate.

---

## 4. Store listing — copy‑paste content

Paste into the console's **Store listing** page.

**App name:** `Vantage`
**Creator display name:** `Timo Seikel`

**Short description** (plain text, shown on the tile):
```
Your Overwatch 2 stats coach — priority maps, exact hero stats, mental tracking and improvement targets, all in one dashboard.
```

**Full description** (CommonMark, keep under ~2000 chars):
```markdown
## Vantage — see where the points are hiding

Vantage turns your Overwatch 2 match history into a coaching dashboard that tells you
**what to actually work on** — not just another wall of numbers.

### What you get
- **Priority maps** — every map ranked by *net losses × how often you play it*, so you
  fix the maps that are quietly costing you the most SR first.
- **Exact hero stats** — a per-hero table (K/D/A, damage, healing, mitigation per 10
  min, winrate) with a click-through drill-down per hero.
- **Winrate × volume** — the flagship scatter that separates "bad and rare" from
  "bad and frequent" at a glance.
- **Mental tracking** — log tilt, comms and toxicity, and see the real tax they put
  on your winrate.
- **Trends** — winrate over time, split by role, mode and account, with an activity
  heatmap.
- **Improvement targets** — set a goal and track whether hitting it actually moves
  your winrate.

### Account-safe by design
Vantage uses Overwolf's official Game Events Provider — the same sanctioned feed other
Overwatch apps use. It never reads game memory or injects anything, and only ever shows
information you can already see in your own game. **No ban risk.**

### Bonus
One-click export of your tracked games to a Notion database.
```

**Category:** Stats
**Tags / keywords:** `overwatch 2`, `stats`, `tracker`, `win rate`, `hero stats`,
`coaching`, `improvement`, `competitive`
**About the creator:** Solo dev building account-safe tools for Overwatch players. *(edit to taste)*
**Support link:** `mailto:timo.seikel@gmail.com` *(swap for a GitHub Issues URL once the repo is public)*
**Privacy policy URL / Terms URL:** the published `docs/legal/privacy.html` and
`docs/legal/terms.html` (see §6) — **required** by Overwolf.
**Social links:** *(optional)*

---

## 5. Graphic assets — generated & ready

All brand assets are generated from the Vantage — Aurora palette by
`scripts/make-store-assets.mjs`; screenshots are captured from the live UI by
`scripts/capture-screenshots.cjs`. Regenerate any time:

```bash
npm run assets:store     # icon, tile, hero, creator
npm run assets:screens   # 10 real UI screenshots (1200x675, <=100KB)
```

| Asset | Console spec | File | Notes |
|---|---|---|---|
| App icon | PNG/WebP 55×55 | `assets/store/icon-55.png` | ✅ dark+light safe |
| Appstore tile | JPG/WebP 258×198 | `assets/store/tile-258x198.png` | generated as PNG — see note ▼ |
| Hero image | PNG/WebP 1920×560 | `assets/store/hero-1920x560.png` | ✅ optional background |
| Creator tile | PNG/WebP 400×320 | `assets/store/creator-400x320.png` | ✅ optional |
| Screenshots (1–5) | JPG/WebP 1200×675, ≤100 KB | `assets/store/screenshots/01…10-*.jpg` | ✅ 10 to choose from |

**Tile format note:** the spec lists the tile as JPG/WebP. The generator emits PNG
(no image codecs in pure Node). Either upload the PNG (the console commonly
transcodes) or convert once: any image tool, or if you have ImageMagick:
`magick assets/store/tile-258x198.png assets/store/tile-258x198.jpg`.

**Recommended 5 screenshots:** `01-overview`, `05-heroes`, `04-maps`, `08-trends`,
`10-notion` — the strongest tour (including the Notion sync feature). All ten are
provided so you can swap (full set: 01-overview, 02-review, 03-matches, 04-maps,
05-heroes, 06-focus, 07-mental, 08-trends, 09-targets, 10-notion).

---

## 6. Release runbook (Phase 3)

Overwolf's [Release Your App](https://dev.overwolf.com/ow-native/getting-started/release-your-app)
flow, mapped to this ow-electron app. **No hand-written `manifest.json`** (that's ow-native)
— but the store artifact is an **OPK** that carries Overwolf metadata generated from
`package.json`, produced by Overwolf's packaging tooling (not a plain NSIS installer).

1. **Self-test.** `npm test` (55 unit tests), `npm run typecheck`, then `npm start` and
   click through every screen. For live GEP, run elevated with Overwatch open (whitelisted).
2. **App icons** — generated and brand-correct (`npm run make-icon`):
   - `assets/appicon.png` (512×512) → the Windows **launcher_icon.ico** (Phase 3's one
     required icon) + taskbar/installer icon.
   - `assets/tray.png` (32×32) → the tray icon.
3. **Bump the version** in `package.json` (`version`) — required for every new upload.
4. **Build the app files:**
   ```bash
   npm run release   # ow-electron-builder → release/win-unpacked/ + Vantage-Setup-<ver>.exe
   ```
   `build.files` ships `dist/`, `renderer/` (minus the dev preview + sourcemaps),
   `assets/` (minus `assets/store/`), `appsettings.json` and `package.json`. The NSIS
   `.exe` is the **"traditional installer"** distribution option.
5. **Pack the OPK** (the store artifact — **not** the NSIS `.exe`):
   ```bash
   npm run pack:opk   # @overwolf/ow-cli opk pack release/win-unpacked → release/Vantage-<ver>.opk
   ```
   This is verified working: it produces `release/Vantage-0.1.0.opk` (~134 MB) — a ZIP of the
   runnable app (`Vantage.exe` + Electron runtime + `resources/app.asar`). There is **no
   `manifest.json`** (ow-electron keeps config in `package.json`, bundled in the asar); confirmed
   by inspecting the OPK. The **[Overwolf CLI](https://www.npmjs.com/package/@overwolf/ow-cli)**
   also handles upload/rollout:
   ```bash
   npx @overwolf/ow-cli opk sign   <file.opk>   # if code-signing is required
   npx @overwolf/ow-cli opk upload <file.opk>   # → prints a version id
   npx @overwolf/ow-cli opk release <versionId> # roll out to a % of users
   ```
   **➡ One DevRel confirm:** Overwolf's docs defer ow-electron packaging specifics to DevRel
   ([their words](https://dev.overwolf.com/ow-electron/guides/dev-tools/overwolf-installer/):
   *"contact your DevRel for specific details"*). Confirm they accept this OPK structure /
   upload path — but the command + artifact are ready.
6. **Upload + submit** — either `ow-cli opk upload` (needs `ow-cli config` with your console
   token) or upload `release/Vantage-0.1.0.opk` in the [Developer Console](https://console.overwolf.com);
   complete the store listing (§4–§5); submit to **DevRel QA**.
7. **QA cycle** — address feedback and re-upload (bump version each time) until it passes.
8. **Go live** — after approval, pick the release channel (Production vs. Testing) and roll out.

**Code signing (required BEFORE Overwolf will review — the submission form gates on it).** The exe
must carry a **trusted-CA** signature (self-signed is rejected). Chosen route: **Certum OV cert +
SimplySign**, signed locally with `npm run sign:local` before each upload (no CI automation — see
[docs/signing.md](signing.md) for why). For a local `.pfx` from any CA, ow-electron-builder
is electron-builder under the hood, so **no `package.json` change is needed** — set the standard env
vars at release time:

```bash
# .pfx path (or base64) + its password — electron-builder signs automatically
export CSC_LINK="/path/to/cert.pfx"
export CSC_KEY_PASSWORD="…"
npm run release
```

Without a trusted-CA signature the app **cannot be submitted for review**. (A self-signed build only
suppresses local warnings via *More info → Run anyway* and does not satisfy Overwolf.)

**Overwolf Installer.** Switching from the plain NSIS installer to the **Overwolf Installer** gives
the built-in CMP + Terms-of-Use acceptance flow and is the only way to use the Developer Console
**testing channels**. Its exact ow-electron-builder keys are **DevRel-gated** (Overwolf's docs say
*"contact your DevRel for specific details"*), so they are intentionally **not guessed into
`package.json`** here — request them from DevRel, then configure:
- **Terms of Use URL** and **Privacy Policy URL** → the published `docs/legal/*.html` pages (§4, §8).
- Installer assets: app `.ico`, splash `144×144` `.png`, promotion `521×145` `.png`, install location.

---

## 7. Pre-submission checklist (technical / UX)

- ✅ **Public app with a desktop window** — frameless dashboard, own title bar
  (src/main/dashboard.ts). No in-game overlay (intentional; a desktop window
  satisfies the "app is running" requirement).
- ✅ **Front-app behavior** — single-instance lock + `second-instance` re-focuses the
  window (src/main/index.ts:27, :84), per the
  [front-app guideline](https://dev.overwolf.com/ow-native/guides/product-guidelines/app-screen-behavior/front-app-tutorial).
- ✅ **Run at login** toggle (src/main/autolaunch.ts); auto-launch uses `--hidden`
  so it never steals focus from a running game.
- ✅ **Security posture** — renderer runs with `contextIsolation: true`,
  `nodeIntegration: false`, a preload bridge, and a strict CSP in
  `renderer/index.html` (`default-src 'none'`; `script-src 'self'`). The CSP warning
  seen while capturing screenshots is from the **dev-only preview harness**, which is
  excluded from the packaged app.
- ⚠ **Monetization** — the app is **ad-free by choice** (no ad container). Overwolf's
  [monetization docs](https://dev.overwolf.com/ow-electron/monetization/overview/) confirm ad-free
  is allowed — Overwolf only forbids **third-party** monetization. Still flag it with DevRel; a
  subscription tier can be added later. (Notion export is the user's own integration, not monetization.)
- ✅ **Legal** — Privacy Policy + Terms of Use authored at `docs/legal/{privacy,terms}.html`,
  accurate to real data flows (local storage, GEP scope, optional Notion, default Overwolf
  analytics). **Publish on GitHub Pages and paste the public URLs into the console + installer.**
- ✅ **Account safety** — GEP-only; no memory reads / injection (see §3).
- ✅ **First-time experience** — a full guided tour (`renderer/src/app/onboarding.ts`) runs on first
  launch and is replayable from **Help** in the status bar; the demo dataset stays clearly badged.
- ✅ **Manual (◎) features persist** — Log Match writes a real game to local history (feeds every
  stat incl. the mental composite); authored targets are saved and shown in the library.
- ⏳ **Code signing / installer** — see §6: obtain a cert and switch to the Overwolf Installer for
  the CMP/ToS flow and Developer Console testing channels.

---

## 8. What only you can do

1. **Confirm identity** (§1) in the Developer Console; align `package.json` if needed.
2. **Confirm the OPK flow with DevRel** (§6 step 5) — the exact `ow-cli opk pack` command
   and whether the console takes the OPK or the installer. **This is the packaging detail
   we couldn't finalize without your account.**
3. **Fill the blanks** in the store copy (§4): About the creator, Support link, socials.
4. **(Optional) convert the tile** to JPG/WebP (§5) if the console rejects PNG.
5. **Build + pack**: `npm run release` (app files), then `ow-cli opk pack/upload` per DevRel,
   bumping `version`.
6. **Submit the app idea** (§3) if not already done as part of whitelisting.
7. **Complete the store listing** (§4, §5) and **submit for review** to DevRel QA; address feedback.
8. **Publish the legal docs** — push the repo to GitHub, enable Pages for `docs/`, and paste the
   public `docs/legal/privacy.html` + `docs/legal/terms.html` URLs into the console **and** the
   installer config. (Both must load without login — a hard Overwolf requirement.)
9. **Obtain a code-signing certificate** from a trusted CA and add it to `build.win` (or sign the
   OPK via `ow-cli opk sign`) before a public release.
10. **Confirm ad-free with DevRel** — the app carries no ads by design; get explicit sign-off.

Assets already generated in `assets/store/` (git-ignored — reproducible via the two
`npm run assets:*` commands above).
