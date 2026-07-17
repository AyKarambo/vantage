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
> `overwolf.packages`, `build`). The `manifest.json` reference/validation pages you may find
> are the **ow-native** framework's.
>
> **Store artifact — corrected:** the **OPK is for ow-native apps only.** For **ow-electron**
> apps (what Vantage is), the submission artifact is the **signed `.exe`** (the NSIS installer
> built by `npm run release` / `npm run publish:release`), uploaded to the Developer Console
> directly — not an OPK. `npm run pack:opk` / `ow-cli opk *` below is dead weight for this app;
> left in place until confirmed with DevRel, but do not block submission on it.

---

## 1. App identity — must match your whitelisted registration

The app's unique id (UID) comes from Overwolf's backend, not from hand-deriving
`name` + `author` yourself. The same signer that stamps the package-integrity
signature (see [docs/signing.md](signing.md)) **returns the UID**: `signApp()`
resolves `signResult.uid`, the builder assigns it to `appInfo.overwolfUid`, and embeds
it into the exe as a PE resource — logged as `embedding Overwolf app uid in PE
resource`. (Overwolf's own docs describe the derivation elsewhere as `productName`
(falling back to `name`) + `author.name`, which for this app would differ from the
plain `name`+`author` this section used to assume — one more reason not to guess it by
hand.) Whatever the signer returns must match the app you were whitelisted as, or
GEP/console won't bind.

| Field | Value | Source |
|---|---|---|
| `name` | `ow.vantage` | package.json |
| `author` | `Timo Seikel` | package.json |
| `productName` | `Vantage` | package.json `build.productName` |
| `appId` (installer) | `com.timoseikel.vantage` | package.json `build.appId` |
| AppUserModelId | `com.timoseikel.vantage` | src/main/index.ts |
| Overwolf packages | `["gep"]` | package.json `overwolf.packages` |
| Target game | **Overwatch — game id `10844`** | appsettings.json |

**➡ Action:** don't compare these values against the console by hand — **read the UID
the signer returns in the build log** (a `npm run publish:release` run, or any build
with the Overwolf signer credentials present) and confirm that's the app you were
whitelisted as. If it doesn't match, that's your signal `name`/`author` diverged from
the registered app — fix `package.json` and rebuild.

**Verifying this pre-approval:** you don't need to wait for full store approval to check
GEP actually binds — [ow-electron Dev Mode](https://dev.overwolf.com/ow-electron/guides/dev-tools/dev-mode)
authenticates a local Developer Console identity (`ow config`, one-time; see
[docs/onboarding/01-getting-started.md](onboarding/01-getting-started.md)) and loads GEP
against the unsigned local build. It still needs the Console-side app registration above
— just not public approval or a signed installer.

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
- **Target game:** Overwatch (10844)
- **Category:** Stats / Statistics
- **One-liner:** A personal Overwatch stats coach — turns your match history into
  priority maps, exact per-hero stats, mental tracking and improvement targets.
- **Desktop window:** Yes — a frameless desktop dashboard (no in-game overlay). The
  app runs from a Windows tray icon and opens the dashboard window; relaunching it
  brings the window to the front (Overwolf front-app behavior).
- **Data source / how it works:** Overwolf **Game Events Provider (GEP)** only. It
  reads sanctioned events (your own account, map, role, match outcome, your own
  scoreboard). It never reads game memory, never injects, and exposes nothing the
  player can't already see — so there is no competitive advantage from using it.
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
Your Overwatch stats coach — priority maps, exact hero stats, mental tracking and improvement targets, all in one dashboard.
```

**Full description** (CommonMark, keep under ~2000 chars):
```markdown
## Vantage — see where the points are hiding

Vantage turns your Overwatch match history into a coaching dashboard that tells you
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
information you can already see in your own game. **Free to use.**

### Bonus
One-click export of your tracked games to a Notion database.
```

**Category:** Stats
**Tags / keywords:** `overwatch`, `stats`, `tracker`, `win rate`, `hero stats`,
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
flow, mapped to this ow-electron app. **No hand-written `manifest.json`** (that's ow-native) —
and for ow-electron apps the submission artifact is the **signed `.exe`** itself (the NSIS
installer), uploaded directly to the Developer Console. (The OPK path in this section is
ow-native's; keeping it documented below only in case DevRel says otherwise for this app.)

1. **Self-test.** `npm test` (55 unit tests), `npm run typecheck`, then `npm start` and
   click through every screen. For live GEP, run elevated with Overwatch open (whitelisted).
2. **App icons** — generated and brand-correct (`npm run make-icon`):
   - `assets/appicon.png` (512×512) → the Windows **launcher_icon.ico** (Phase 3's one
     required icon) + taskbar/installer icon.
   - `assets/tray.png` (32×32) → the tray icon.
3. **Bump the version** in `package.json` (`version`) — required for every new upload.
4. **Build + sign the app files:**
   ```bash
   npm run publish:release   # build, sign (Certum/SimplySign), verify, tag, gh release create
   ```
   `build.files` ships `dist/`, `renderer/` (minus the dev preview + sourcemaps),
   `assets/` (minus `assets/store/`), `appsettings.json` and `package.json`. The signed
   NSIS `.exe` (`release/Vantage-Setup-<ver>.exe`) is the **submission artifact for
   ow-electron apps** — upload it directly, no packing step needed.
   - [ ] **Confirm the UID** — this is the confirmation moment for §1's identity check: the
     signer resolves `signResult.uid` during this build and embeds it into the exe as a PE
     resource (logged as `embedding Overwolf app uid in PE resource`). Read it out of this
     build's log rather than re-deriving it by hand; see §1 for what it must match.
   - [ ] **Overwolf build key present** — a release now also needs `OW_BUILD_KEY` plus the
     `ow-cli` credentials (`OW_CLI_EMAIL`/`OW_CLI_API_KEY`); `publish-release.ps1` aborts
     *before building* if they can't be resolved. Without them the build ships **unsigned**
     for Overwolf's own package-integrity signature and GEP won't load for users. `OW_BUILD_KEY`
     doesn't exist yet — it's issued only after the app is registered in the Developer
     Console, so this is still a step ahead of us, not something configured today. Full
     detail: [docs/signing.md](signing.md).
5. ~~Pack the OPK~~ — **OPK packaging (`npm run pack:opk` / `ow-cli opk *`) is for
   ow-native apps, not ow-electron.** Left in the repo only in case DevRel says
   otherwise for this app; do not treat it as a required step.
6. **Upload + submit** — upload the signed `release/Vantage-Setup-<ver>.exe` in the
   [Developer Console](https://console.overwolf.com); complete the store listing (§4–§5);
   submit to **DevRel QA**. None of this has happened yet — no build has been uploaded.
   - [ ] **VirusTotal scan** — before uploading, check the exe at
     [virustotal.com](https://virustotal.com). Per Overwolf's testing guide: *"Before
     sending any [build] for approval, check that it is virus free... apps with
     VirusTotal warnings will not be tested."* Hard gate; full test matrix in §7.
   - The **first successful `.exe` upload triggers a mandatory version review** — pressing
     Submit sends it to the Overwolf team. **Test channels are exempt** from mandatory
     review, but testing builds **can't be downloaded from the store** — distribute them
     via the custom installer or a public tester link instead. Store downloads
     auto-subscribe users to the **Production** channel.
     ([Release management](https://dev.overwolf.com/ow-electron/developers-console/releases-management/release-management))
7. **QA cycle** — address feedback and re-upload (bump version each time) until it passes.
   Overwolf still recommends submitting major versions for review even once mandatory
   review no longer applies to later ones.
8. **Go live** — after approval, pick the release channel (Production vs. Testing) and roll out.
   - [ ] **Phased rollout** — only the latest version's rollout percentage is adjustable;
     halt it at any percentage and resume later. Users already on a halted version are
     **not** rolled back when you resume or change it.
   - [ ] **Release notes** — rename `CHANGELOG.md`'s **Unreleased** heading to the released
     version (per that file's own "Maintaining this file" preamble — the version itself
     comes from `scripts/next-version.mjs` via `publish-release.ps1`, which restores
     `package.json`'s floor version afterwards), then paste those same notes into the
     console's **public release notes** (CommonMark; takes about 5 minutes to propagate
     after saving). The same notes feed the app's in-app "What's new" screen. Internal
     notes (team + Overwolf only) are separate, for review context.

**Code signing (required BEFORE Overwolf will review — the submission form gates on it).** The exe
must carry a **trusted-CA** signature (self-signed is rejected) — and per Overwolf's
[App Signing guide](https://dev.overwolf.com/ow-electron/guides/dev-tools/app-signing/) the exe
signature is now **required for the gaming packages (GEP) to load at runtime** in distributed
builds. Chosen route: **Certum "Open Source Developer" certificate, signed locally via SimplySign** —
the sign hook ([scripts/certum-sign.cjs](../scripts/certum-sign.cjs)) signs the app exe, uninstaller
and installer **during** the build, run via `npm run publish:release` on a machine where SimplySign
Desktop is unlocked (publisher: "Open Source Developer Timo Seikel"). No GitHub secrets — the key
stays in Certum's cloud, which can't sign on cloud CI runners. Full runbook: [docs/signing.md](signing.md).

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
- ⏳ **Code signing / installer** — cert obtained (Certum, signed locally — see §6); still to switch
  to the Overwolf Installer for the CMP/ToS flow and Developer Console testing channels.
- ⚠ **Installer silent-install (winget) — untested against the new license page.** The NSIS
  installer now shows a license/consent page (`build.nsis.license`, added alongside the
  Terms of Use + Privacy Policy acceptance flow — see `CHANGELOG.md`'s Unreleased entry)
  before install completes. `docs/winget.md`'s submission gate requires
  `Vantage-Setup-<ver>.exe /S` to finish with **zero dialogs**; a license page is exactly
  the kind of prompt that can break that. **Not yet re-verified** since the license page
  was added — retest the silent install before opening or updating any `winget-pkgs` PR.

**Pre-submission test matrix.** Overwolf's
[How to test your app](https://dev.overwolf.com/ow-electron/guides/test-your-app/how-to-test-your-app)
checklist, adapted for Vantage. None of this has run yet — no build has been submitted:

- [ ] **Resolution/DPI matrix** — app stays within the screen borders at each of:
  - [ ] 1366×720 @ 100 DPI
  - [ ] 1366×768 @ 100 DPI
  - [ ] 1920×1080 @ 125 DPI
  - [ ] 2560×1440 @ 100 DPI
  - [ ] 3840×2160 @ 150 DPI
- [ ] **Launch time** — the desktop window appears within 10 seconds (a loader is fine).
- [ ] **Clean exit + relaunch** — all windows/processes close on exit, and the app still
  works correctly after relaunch.
- [ ] **Offline launch** — the app launches normally with no network connection, and shows
  a "check your internet connection"-class message anywhere it needs the network. This is
  exactly what AC-5 of this feature fixed (see `CHANGELOG.md`'s Unreleased entry) — the
  offline launch used to fire a false "Maps load failed" OS toast; retest to confirm the fix
  holds in the packaged build, not just `npm start`.
- [ ] **Memory/CPU** — watch memory rise and fall rather than stay elevated (no leaks), and
  watch for CPU/memory/network spikes.
- [ ] **Game-scoped launch** — the app launches only for the game(s) it supports
  (Overwatch), not for others.
- [ ] **VirusTotal** — scan the signed exe at [virustotal.com](https://virustotal.com)
  before uploading; see §6 step 6 — a flagged build **will not be tested** by Overwolf.

**Not applicable to Vantage:** Overwolf's overlay and hotkey test items — this app has no
in-game overlay and no hotkeys, so they're left off rather than padded in as N/A rows.

---

## 8. What only you can do

1. **Confirm identity** (§1) in the Developer Console; align `package.json` if needed.
2. **(Optional) confirm with DevRel** that the signed `.exe` is still the right upload
   format — ow-electron apps submit the `.exe`, not an OPK (OPK is ow-native-only); this
   repo already builds that artifact via `npm run publish:release`.
3. **Fill the blanks** in the store copy (§4): About the creator, Support link, socials.
4. **(Optional) convert the tile** to JPG/WebP (§5) if the console rejects PNG.
5. **Build + sign**: `npm run publish:release`, bumping `version` per upload.
6. **Submit the app idea** (§3) if not already done as part of whitelisting.
7. **Complete the store listing** (§4, §5) and **submit for review** to DevRel QA; address feedback.
8. **Publish the legal docs** — push the repo to GitHub, enable Pages for `docs/`, and paste the
   public `docs/legal/privacy.html` + `docs/legal/terms.html` URLs into the console **and** the
   installer config. (Both must load without login — a hard Overwolf requirement.)
9. **Sign each release locally** — with SimplySign Desktop unlocked (mobile OTP), run
   `npm run publish:release` (see [docs/signing.md](signing.md)). No GitHub secrets; the Certum
   cloud key can't sign on CI runners. Required before a public release *and* for GEP to load.
10. **Confirm ad-free with DevRel** — the app carries no ads by design; get explicit sign-off.
11. **Fill in the QA review form's per-window instructions** (§9) — paste the ready-made text
    and attach the screenshots from `docs/overwolf-review/screenshots/`.

Assets already generated in `assets/store/` (git-ignored — reproducible via the two
`npm run assets:*` commands above).

---

## 9. QA review form — per-window/tab instructions

Overwolf's submission form asks, separately from the store listing (§4): *"specific
instructions for each window/tab your app contains"* (one text field, 2000 characters,
required) plus matching screenshots attached alongside it. Unlike `assets/store/screenshots/`
(§5, git-ignored, captured from the **browser-preview harness** for the store *listing* tiles),
the screenshots below are captured from the **real packaged app** — a real frameless
`BrowserWindow` running the compiled `dist/` output with its real preload/CSP/IPC, not a
browser tab — because that's what a reviewer actually runs. They're committed to the repo at
`docs/overwolf-review/screenshots/` (not git-ignored) since they're QA documentation, not a
regenerate-on-release build artifact.

**Regenerate anytime:**
```bash
npm run assets:app-screens   # builds dist/, then walks every screen for real, 19 screenshots
```
`scripts/capture-app-screenshots.cjs` boots the same `createDataProvider`/IPC wiring
`src/main/index.ts` uses, against an isolated, disposable `userData` folder seeded with the
app's own "Show demo data" feature (`generateSampleGames` — the exact fallback dataset a
fresh install shows) so every screen has realistic content with no game or Overwolf runtime
needed. Tray, the live GEP sensor, and Notion's network calls are swapped for no-op stand-ins
(none affect what's on screen); everything else — window chrome, CSP, contextIsolation,
sandbox — is the shipped configuration.

**Paste this into the form's instructions field** (1582/2000 chars):

```text
Vantage is a single frameless desktop window (no in-game overlay, no browser tabs) — a left sidebar switches between screens; the active one is always highlighted. No ad container anywhere in the UI: the app is ad-free by design.

Launch: `npm start` opens the window with a demo season pre-loaded ("Demo data" badge, bottom bar) so every screen has real content with no game running.

Sidebar screens, top to bottom (one screenshot each, docs/overwolf-review/screenshots/):
- Overview (01) — KPI cards, priority-map scatter, session recap.
- Review (02) — queue of recent games to grade.
- Matches (03) — match log; click a row for match detail (04): scoreboard + per-hero stats.
- Maps (05) — winrate by map/mode.
- Heroes (06) — per-hero stats table.
- Focus (07) — weakest maps/heroes/roles, ranked by cost.
- Mental (08) — tilt/comms tracking vs winrate.
- Trends (09) — winrate over time.
- Readiness (10) — opt-in training-load coach, off by default.
- Targets (11) — user-authored improvement targets.
- Notion sync (12) — optional export; shown disconnected until the user pastes their own integration token.
- Logs (13) — live debug log viewer.
- Settings — General tab (14): accounts/app behavior. Master Data tab (15): editable heroes/maps/seasons.
- About (16) — version/build info, privacy summary, support link.

Also reachable from anywhere: Ctrl+K command palette (17, search/navigate/actions) and the "Log match" modal (18, manual match entry). First launch shows a one-time intro tour (00), replayable from "Help" in the status bar.
```

**Attach:** all 19 files in `docs/overwolf-review/screenshots/` (`00-onboarding-tour.jpg` …
`18-log-match.jpg`), in that numeric order, matching the parenthesized numbers above. If the
form caps the attachment count, the sidebar screens (01–16) are the required minimum — 00/17/18
are the supplementary "how do I reach X" screens for the palette/log-match/first-run entry points.

**Ad container:** none — confirmed empty in every screenshot; see the ad-free note in §3/§7.
