# Code signing — Vantage

**Chosen path: SSL.com IV (Individual Validation) certificate + eSigner cloud signing,
signed headlessly in CI.** This replaced the earlier Certum/SimplySign plan (see
[History & alternatives](#history--alternatives) for why).

## Why signing is mandatory (not cosmetic)

Two independent reasons:

1. **ow-electron requires it for the gaming packages to load.** Overwolf's
   [App Signing guide](https://dev.overwolf.com/ow-electron/guides/dev-tools/app-signing/):
   *"Code-signing your exe with your own certificate is now required (previously
   optional)"* and *"Overwolf signs the gaming package integrity and you sign the exe.
   Without both, the gaming packages (GEP, Overlay, Recorder) will not load at
   runtime."* This landed around ow-electron ~39.8.x; we're pinned to 39.6.1, so it
   bites on the next ow-electron upgrade — and Vantage without GEP is not Vantage.
   (Local dev has a Dev Mode carve-out; the requirement is for *distributed* builds.)
   The "Overwolf half" (gaming-package integrity, `OW_CLI_EMAIL`/`OW_CLI_API_KEY`/
   `OW_BUILD_KEY`) needs a newer `@overwolf/ow-electron-builder` than our pinned
   26.8.5 — wire those secrets when upgrading.
2. **Overwolf gates store review on it.** The submission form asks "Is your app
   signed?" and requires a trusted-CA signature (self-signed is rejected).

And the user-facing reason: unsigned installers show SmartScreen's harshest
"unknown publisher" dialog, and unsigned files can never accrue reputation.

## Why SSL.com IV

- **Attainable as a solo individual in Germany** — no company, no D-U-N-S. Validation
  is a government-ID check, not a community-adoption bar (unlike SignPath Foundation,
  which rejected Vantage for insufficient stars/forks/press).
- **Genuinely headless CI signing** via eSigner (cloud HSM + CodeSignTool with a TOTP
  secret) — fits the auto-release-on-push pipeline. Certum's SimplySign cannot do
  this (interactive OTP, ~2 h sessions).
- **Your real name as publisher** (cert CN = verified legal name), not Certum's
  generic "Open Source Developer".
- **No usage restriction** — unlike Certum's open-source cert (revoked if the software
  is ever distributed commercially), an IV cert doesn't care if Vantage monetizes later.
- Keys live in SSL.com's cloud HSM (satisfies the post-2023 CA/B Forum hardware rule)
  — nothing to ship, lose, or plug in.

## Costs (verified 2026-07 — re-check at purchase)

| Item | Price |
|---|---|
| IV certificate | **$129/yr** (multi-year discounts: 2 yr $116.10/yr … 5 yr $96.75/yr) |
| eSigner subscription | first **30 days free, unlimited signings**, then Tier 1 **$20/mo** (20 signings/mo, $1 overage) or **$180/yr** (240 signings pooled, 25% off) |
| Signings per release | **3** (app exe + uninstaller + installer; `elevate.exe` skipped, sha256-only pinned) |

Unused signings roll over **while the subscription is active** and are forfeited if it
lapses. **Budget check:** auto-release publishes on *every push to main* — at 3
signings/release, monthly Tier 1 covers ~6 releases/month; the annual plan's pooled
240 ≈ 80 releases/yr. Prefer the **annual** plan, and batch merges when practical.
(Prices move — SSL.com has changed eSigner pricing before; confirm at checkout and
watch the first invoice after the 30-day trial.)

## Purchase & enrollment runbook

1. **Order** at <https://www.ssl.com/products/software-integrity/code-signing/iv/>.
   At checkout choose **eSigner cloud signing** as the delivery/attestation option
   (an "eSigner Tier" dropdown) — **not** YubiKey (+$379, key would live on the token,
   useless for CI) and not "Own HSM". Standard 3–5-day validation is included; ignore
   the +$599 expedite.
2. **Identity validation** (German applicant): upload via the Orders tab —
   - scan of ID **front** and **back** (Personalausweis address is on the back, so
     both sides are genuinely required; passport works too),
   - a **selfie holding the ID** next to your face, **≥ 5 megapixels**,
   - then a **phone callback** to a verified number. No notary, no video call.
3. **eSigner enrollment** (Orders → order details → *eSigner Cloud Signing
   Enrollment*): choose **OTP APP** (not OTP SMS — SMS can't be automated), set the
   4-digit PIN, click *create OTP and issue certificate*. When the QR code appears,
   **copy the "secret code" text next to it** — that is `ES_TOTP_SECRET`. (Retrievable
   later: order page → enter PIN → *Show QR Code*. Regenerating the QR **invalidates**
   the old secret — rotate the GitHub secret at the same time.)
4. **Credential ID**: shown on the order page under *SIGNING CREDENTIALS*, or via
   `CodeSignTool get_credential_ids -username=… -password=…`.
5. **Disable the malware blocker** for unattended CI (order page → *SIGNING
   CREDENTIALS* → "malware blocker disabled"), or accept that a false positive can
   hard-fail a release ("hash that needs to sign is a malware object hash"). Note
   eSigner false-positives on NSIS helpers are real — our hook already skips
   `elevate.exe` for exactly this reason.
6. **Add the GitHub Actions secrets** (repo → Settings → Secrets and variables →
   Actions): `ES_USERNAME`, `ES_PASSWORD`, `ES_CREDENTIAL_ID`, `ES_TOTP_SECRET`.
   The next push to main produces a signed release; until then CI publishes unsigned
   builds exactly as before.

## How the repo is wired

- [scripts/esigner-sign.cjs](../scripts/esigner-sign.cjs) — electron-builder custom
  Windows sign hook (`build.win.signtoolOptions.sign` in `package.json`). Runs once
  per signable file (`Vantage.exe` → uninstaller → installer), shells out to
  CodeSignTool as `java -jar` with an args array (no cmd.exe quoting pitfalls), signs
  in place with `-override=true`, checks stdout for `Code signed successfully`
  (CodeSignTool can exit 0 on failure), retries once, and **no-ops with a warning when
  the ES_* env is absent** so dev builds and secretless CI keep working.
- `signingHashAlgorithms: ["sha256"]` is pinned — the electron-builder default
  (`sha1`+`sha256`) would invoke the hook twice per file and burn double credits for
  an identical SHA-256 signature.
- `publisherName: "Timo Seikel"` must match the certificate CN (electron-updater's
  signature verification uses it, should we ever adopt it).
- Both workflows ([auto-release.yml](../.github/workflows/auto-release.yml),
  [release.yml](../.github/workflows/release.yml)) download CodeSignTool (~220 MB zip,
  bundles its own JDK, **no top-level folder** in the archive), export
  `CODE_SIGN_TOOL_PATH`, pass the ES_* secrets to the build, and then **verify** the
  installer with `Get-AuthenticodeSignature` — a "signed" release that isn't fails CI.

### Signing locally

```powershell
$env:ES_USERNAME = '…'; $env:ES_PASSWORD = '…'
$env:ES_CREDENTIAL_ID = '…'; $env:ES_TOTP_SECRET = '…'
$env:CODE_SIGN_TOOL_PATH = 'C:\tools\CodeSignTool'   # unzipped once from ssl.com
npm run release    # hook signs exe + uninstaller + installer during the build
```

`npm run sign:local` ([scripts/sign-local.ps1](../scripts/sign-local.ps1)) post-hoc
signs a *single* file — fine for a stray artifact, **not** a release path (the inner
`Vantage.exe` and uninstaller would stay unsigned, failing the GEP requirement).

### Sandbox dry-run (optional, no credits)

Before the cert arrives you can exercise the whole pipeline against eSigner's
sandbox: overwrite `conf/code_sign_tool.properties` in the CodeSignTool dir with

```properties
CLIENT_ID=qOUeZCCzSqgA93acB3LYq6lBNjgZdiOxQc-KayC3UMw
OAUTH2_ENDPOINT=https://oauth-sandbox.ssl.com/oauth2/token
CSC_API_ENDPOINT=https://cs-try.ssl.com
TSA_URL=http://ts.ssl.com
```

and use demo credentials (`esigner_demo` / `esignerDemo#1`). Sandbox signatures are
**not trusted** — pipeline testing only. Restore the shipped properties afterwards.

## SmartScreen expectations (be honest with yourself)

No certificate removes SmartScreen warnings on day one anymore — Microsoft killed
EV's instant-reputation bypass in 2024 (*"Paying a premium for EV solely to avoid
SmartScreen warnings is no longer justified"* — their words). A fresh IV cert starts
with zero reputation: early downloads still show "Windows protected your PC", now
with your verified name instead of "unknown publisher". Reputation accrues to the
**publisher identity** over weeks / hundreds of clean installs and persists across
releases — keep signing every release with the same cert and it compounds. The only
true no-cold-start paths (Microsoft Store re-signing; native-Overwolf .opk) are
architecturally wrong for Vantage.

## History & alternatives

- **SignPath Foundation** — rejected Vantage (2026-07) for insufficient
  community-adoption signals. Free OV signing with real CI support; worth
  **re-applying** once stars/forks/press grow. Their bar is *"a certain verifiable
  reputation"*, not paperwork.
- **Certum Open Source (~€69 first yr / ~€29 renewal)** — the previous plan. Cheapest
  cert an EU individual can get, but: no unattended CI path (SimplySign Desktop +
  interactive OTP, ~2 h sessions; automation = fragile TOTP+SendKeys GUI hacks),
  publisher shows generic "Open Source Developer", and the cert is **revoked if the
  software is ever distributed commercially**. Solid fallback if SSL.com falls
  through.
- **Azure Artifact Signing** (ex-Trusted Signing, ~$10/mo, best CI story) —
  **unavailable**: individual onboarding is USA/Canada-only; EU access requires a
  registered organization. Re-check if Microsoft opens EU individuals.
- **EV certificates** — pointless since 2024 (no SmartScreen bypass), pricier, and
  effectively require a business entity. Skip.
- **Microsoft Store (MSIX)** — the only free zero-cold-start path, but incompatible
  with the Overwolf runtime/overlay model and Store-only auto-update.
- **Native Overwolf rewrite (.opk)** — needs no developer cert at all, but costs a
  full CEF rewrite and Overwolf mandates its ads/subscriptions for store approval —
  rejected on both counts.
- **Do not** use Sigstore/cosign or GitHub attestations for this — Windows
  SmartScreen/Authenticode never consult them (supply-chain provenance is a different
  problem; they're still nice-to-have alongside a real signature).
