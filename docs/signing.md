# Code signing — Vantage

**Chosen path: Certum "Open Source Developer" code-signing certificate, signed LOCALLY
via SimplySign.** Releasing is a deliberate local command (`npm run publish:release`) run
on a machine where SimplySign Desktop is unlocked — **no signing secrets exist in CI or
git**. This replaced the earlier SSL.com IV + eSigner plan (see
[History & alternatives](#history--alternatives)) once the Certum cert was actually
obtained.

## Why signing is mandatory (not cosmetic)

Two independent reasons:

1. **ow-electron requires it for the gaming packages to load — and that means *two*
   signatures, not one.** Overwolf's
   [App Signing guide](https://dev.overwolf.com/ow-electron/guides/dev-tools/app-signing/):
   *"Code-signing your exe with your own certificate is now required (previously
   optional)"* and *"Overwolf signs the gaming package integrity and you sign the exe.
   Without both, the gaming packages (GEP, Overlay, Recorder) will not load at
   runtime."* Take that literally: **ours** (Certum, this whole doc) and **Overwolf's
   own package-integrity signature** (below) are both required at runtime — either one
   missing still leaves GEP refusing to load. We're now on `ow-electron@39.8.10` /
   `ow-electron-builder@26.9.0` (bumped up from the earlier 39.6.1 pin), which is also
   what makes Overwolf's half of this actually work — see below. Vantage without GEP is
   not Vantage. (Local dev has a Dev Mode carve-out; the requirement is for
   *distributed* builds.)
2. **Overwolf gates store review on it.** The submission form asks "Is your app
   signed?" and requires a trusted-CA signature (self-signed is rejected).

And the user-facing reason: unsigned installers show SmartScreen's harshest
"unknown publisher" dialog, and unsigned files can never accrue reputation.

**All three files must be signed** — the app exe (`Vantage.exe`), the uninstaller, and
the installer — for GEP to load. Signing therefore happens *during* the build (the sign
hook runs once per file), not as a post-hoc pass over the outer installer.

**Overwolf's half: the package-integrity signature.** Ours (Certum) only covers the
exe/uninstaller/installer above — it says nothing about the gaming-package integrity
signature the App Signing guide also requires. That second signature is stamped by
`ow-electron-builder`'s own signer (`@overwolf/app-builder-lib@26.9.0`'s
`out/codeSign/owBuildCertificateSigner.js`), which reads exactly three env vars —
`OW_CLI_EMAIL`, `OW_CLI_API_KEY`, `OW_BUILD_KEY` — and POSTs to Overwolf's backend
(`https://console-be.overwolf.com`, overridable via `OW_CLI_API_URL`) with an
`Authorization: Key <email>:<apiKey>` header. **The trap is the failure mode:** if
those vars are missing, the signer does not fail the build — it logs a warning and
ships the build **unsigned**. Nothing looks wrong locally; the breakage only shows up
later, for end users, as GEP silently refusing to attach. Set `OW_REQUIRE_SIGNING=1`
(or `build.overwolf.requireSigning` in `package.json`) to turn that warning into a
throw — the same fail-closed shape `VANTAGE_REQUIRE_SIGNING` uses for the Certum side
(see [How the repo is wired](#how-the-repo-is-wired)). It's also toolchain-dependent:
the betas previously pinned here resolved `@overwolf/app-builder-lib@26.8.5`, which
doesn't ship the signer module at all — `OW_BUILD_KEY` was inert until the 26.9.0 bump
above.

## Why signing runs locally (the hard constraint)

The Certum cert's private key lives in **Certum's cloud HSM** and is only usable through
the **SimplySign Desktop** app, which mounts it as a Windows *virtual smart card* after
you log in with the **SimplySign mobile app's TOTP** (the QR you scanned at enrollment).
That session lasts only **~2 hours**, and there is no machine credential to hand to a
headless runner. So GitHub's cloud runners **cannot** sign — a fully-signed release can
only be produced on your machine. CI is therefore limited to quality gates; releasing is
local. (This is the one thing the abandoned eSigner path did better — it signed headlessly
in CI. Everything else favoured Certum; see history.)

## Why the Certum "Open Source Developer" cert

- **Cheapest cert an EU individual can get** — no company, no D-U-N-S; validation is an
  individual ID check.
- Keys live in Certum's cloud HSM (satisfies the post-2023 CA/B Forum hardware rule) —
  nothing to ship, lose, or plug in.
- **Tradeoffs to accept:** the publisher shows the generic **"Open Source Developer
  Timo Seikel"** (not a bare legal name), and the cert is **licensed for open-source /
  non-commercial software** — see the [commercial-use caveat](#commercial-use-caveat).

## One-time prerequisites (on your machine)

1. **Install SimplySign Desktop** (Certum) — this exposes the cloud key as a Windows
   virtual smart card.
2. **Enroll the SimplySign mobile app** — done at cert issuance (you scanned the QR). The
   `otpauth://` seed is *only* for seeding the phone; it is **never** placed in env,
   config, or the repo. Keep it in a password manager (see [Secret hygiene](#secret-hygiene)).
3. **Log into SimplySign Desktop** (Certum account + mobile OTP). Windows then surfaces
   the private-key-backed cert into `Cert:\CurrentUser\My`. (A bare imported `.cer`/`.pem`
   is *not* signable — you must be logged in.)
4. **Enable PIN caching:** SimplySign options → *"Enable PIN cache for CSP/KSP-based
   applications"*. This stops a multi-file build from stalling on a modal PIN dialog
   (electron-builder [#8854](https://github.com/electron-userland/electron-builder/issues/8854)).
5. **Verify readiness:**
   ```powershell
   Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | fl Subject, Issuer, Thumbprint, NotAfter
   ```
   Expect `Thumbprint = 69310A558F482846DB5BF3A35531159E483BAEBF`, subject
   `CN=Open Source Developer Timo Seikel`, issuer *Certum Code Signing 2021 CA*.
6. **signtool.exe** — no install needed: the hook uses electron-builder's bundled
   `…\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\windows-10\x64\signtool.exe`.
   (Only if that build of signtool can't drive the SimplySign card: install the Windows
   SDK *"Signing Tools for Desktop Apps"* component and set `SIGNTOOL_PATH` to its
   `signtool.exe` — the hook honours that first.)
7. **Get an Overwolf build key (`OW_BUILD_KEY`)** — a separate credential from
   everything above, for Overwolf's own package-integrity signature (see
   [Why signing is mandatory](#why-signing-is-mandatory-not-cosmetic)). It lives in the
   Developer Console under **Release management → App Keys**, and it's
   **Console-gated**: it doesn't exist until the app is registered/approved, so this
   step is a prerequisite still ahead of us, not something already configured. Once
   issued, see [How the repo is wired](#how-the-repo-is-wired) for where it's read from.

## Releasing

```powershell
# 1. Unlock SimplySign Desktop (log in with the mobile OTP).
# 2. From the repo root, with HEAD pushed to origin/main:
npm run publish:release              # build, sign, verify, tag vX.Y.Z, publish the Release
npm run publish:release -- -DryRun   # build + sign + verify only, no tag/Release
```

`publish-release.ps1` computes the next version from tags + Conventional Commits, builds
with signing **required**, verifies the signature, then creates the tag at `HEAD` and
publishes the GitHub Release with the signed installer + blockmap. It is fail-closed and
idempotent — nothing is tagged or published unless the build verifies as signed, and it
refuses to re-cut an existing tag/Release.

`npm run release` alone still produces a local installer; it's **unsigned** unless
SimplySign is unlocked (fine for personal use — Windows SmartScreen → *More info → Run
anyway*).

## How the repo is wired

- [scripts/certum-sign.cjs](../scripts/certum-sign.cjs) — electron-builder custom Windows
  sign hook (`build.win.signtoolOptions.sign`). Runs once per signable file
  (`Vantage.exe`, `elevate.exe`, uninstaller, installer). With `certificateSha1` +
  `rfc3161TimeStampServer` set, electron-builder resolves the cert from the store and
  hands the hook a fully-formed signtool command (`configuration.computeSignToolArgs`);
  the hook runs it against the bundled `signtool.exe`. **No-op when the cert is absent**
  (SimplySign not logged in) so dev builds and CI still produce an installer — unless
  `VANTAGE_REQUIRE_SIGNING=1` (set by `publish-release.ps1`), in which case it **throws**,
  so a release can never publish silently unsigned.
- `signtoolOptions` in `package.json`: `certificateSha1` = the cert thumbprint;
  `rfc3161TimeStampServer` = `http://time.certum.pl`; `signingHashAlgorithms: ["sha256"]`
  (avoids a wasteful sha1+sha256 dual pass); `publisherName: "Open Source Developer Timo
  Seikel"` — **must match the cert CN** (electron-builder writes it into the NSIS
  publisher metadata and electron-updater compares it during update verification).
- [scripts/ow-build-env.mjs](../scripts/ow-build-env.mjs) — resolves the three env vars
  Overwolf's package-integrity signer needs: email/apiKey via
  [scripts/lib/owCredentials.mjs](../scripts/lib/owCredentials.mjs) (env, else the `ow
  config` credentials file), and `OW_BUILD_KEY` from the env var or a standalone
  `~/.ow-cli/build-key` token file. `--json` emits the resolved values for
  `publish-release.ps1` to consume; every other invocation names only the *missing*
  variables, never a value.
- [scripts/next-version.mjs](../scripts/next-version.mjs) — pure-Node version computation
  (Conventional Commits) shared by the local release and the CI check.
- [scripts/publish-release.ps1](../scripts/publish-release.ps1) — the local release
  orchestrator described above. Its readiness check calls `ow-build-env.mjs` and
  **aborts before building** if `OW_CLI_EMAIL`, `OW_CLI_API_KEY` or `OW_BUILD_KEY` can't
  be resolved; `-DryRun` only warns instead (the build key is Console-gated, so a strict
  dry run would be unusable before the app is approved). When it does build, it sets
  all three plus `OW_REQUIRE_SIGNING=1` for the `npm run release` child process, and
  removes them again in a `finally` block.
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) — quality gates only (typecheck
  + tests) on push to `main` and PRs. `permissions: contents: read`, no secrets, no
  signing, no publish path — it is structurally impossible for CI to publish a release.

### Verifying a signed build

```powershell
$sig = Get-AuthenticodeSignature release\Vantage-Setup-*.exe
$sig.Status                      # Valid
$sig.SignerCertificate.Subject   # CN=Open Source Developer Timo Seikel, O=..., C=DE
$sig.TimeStamperCertificate      # non-null → RFC-3161 timestamp applied
signtool verify /pa /all /v release\Vantage-Setup-*.exe   # issuer = Certum, TSA present
```
Also confirm the embedded `release\win-unpacked\Vantage.exe` is signed (the GEP
requirement — the uninstaller's signing is reported in the build log by the hook).

## Annual renewal

The cert is valid one year (2026-07-09 → 2027-07-09). On renewal the **thumbprint
changes** — update `certificateSha1` in `package.json` to the new value (from step 5),
and remove the expired cert from the store so lookups stay unambiguous. Re-enrollment of
the mobile token happens at the same time.

## Commercial-use caveat

The Certum **Open Source Developer** cert is licensed for open-source / non-commercial
software. Vantage is MIT-licensed and free today, so this is fine. **If Vantage is ever
distributed commercially** (paid tiers, paid app), you must switch to a commercial cert
(e.g. SSL.com IV — see history) *before* signing a commercial release; signing commercial
software with this cert risks revocation.

## Secret hygiene

- The SimplySign **TOTP enrollment seed** (`otpauth://…`) belongs in a password manager,
  never on disk in the repo or a synced folder. After enrollment its only use is
  re-enrolling a new phone; the desktop signing session never needs the raw seed.
- No signing credentials go in GitHub Actions secrets or git — the key stays in Certum's
  cloud, the OTP stays on your phone.
- The **`OW_BUILD_KEY`** (Overwolf's package-integrity credential, distinct from the
  Certum cert) follows the same rule — it never enters git either. Every tool that
  resolves it (`ow-build-env.mjs`, `publish-release.ps1`) prints only the *names* of
  missing variables, never a value.
- Optional mechanical backstop: [scripts/check-secrets.mjs](../scripts/check-secrets.mjs)
  + [.githooks/pre-commit](../.githooks/pre-commit) scan staged additions for secret-shaped
  content (`otpauth://`, private-key blocks, `.pfx`/`.p12` files, Notion tokens, a
  hardcoded `OW_BUILD_KEY=`/`OW_CLI_API_KEY=` literal). Enable once per clone:
  `git config core.hooksPath .githooks`.

## SmartScreen expectations (be honest with yourself)

No certificate removes SmartScreen warnings on day one anymore — Microsoft killed EV's
instant-reputation bypass in 2024. This is an **OV** cert, so it starts with zero
reputation: early downloads still show "Windows protected your PC", now with your verified
"Open Source Developer" identity instead of "unknown publisher". Reputation accrues to the
**publisher identity** over weeks / hundreds of clean installs and persists across
releases — keep signing every release with the same cert and it compounds.

## History & alternatives

- **SSL.com IV + eSigner** — the previous plan (the repo was fully wired for it before the
  Certum cert arrived). Its one advantage: genuinely **headless CI signing** (cloud HSM +
  CodeSignTool with a TOTP secret as four `ES_*` GitHub secrets). Rejected in favour of the
  cheaper Certum cert we could obtain — but it remains the **fallback** if Vantage ever
  needs hands-off cloud CI or goes commercial (an IV cert has no open-source usage
  restriction and shows your bare legal name).
- **SignPath Foundation** — rejected Vantage (2026-07) for insufficient community-adoption
  signals. Free OV signing with real CI support; worth **re-applying** as stars/forks/press
  grow.
- **Azure Trusted Signing** (~$10/mo, best CI story) — **unavailable**: individual
  onboarding is USA/Canada-only; EU access requires a registered organization. Re-check if
  Microsoft opens EU individuals.
- **EV certificates** — pointless since 2024 (no SmartScreen bypass), pricier, and
  effectively require a business entity. Skip.
- **Microsoft Store (MSIX)** — the only free zero-cold-start path, but incompatible with
  the Overwolf runtime/overlay model and Store-only auto-update.
- **Native Overwolf rewrite (.opk)** — needs no developer cert at all, but costs a full CEF
  rewrite and Overwolf mandates its ads/subscriptions for store approval — rejected on both
  counts.
- **Do not** use Sigstore/cosign or GitHub attestations for this — Windows
  SmartScreen/Authenticode never consult them (supply-chain provenance is a different
  problem; still nice-to-have alongside a real signature).
