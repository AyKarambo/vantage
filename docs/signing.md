# Code signing — Vantage

**Signing is required *before* Overwolf will review the app.** The submission form asks "Is your app
signed?" and Overwolf states: *"Code-signing your exe with your own certificate is required … Without
both [your exe signature + Overwolf's package integrity], we won't be able to review your app."* The
cert must be from a **trusted public CA** (per the ow-electron FAQ: *"a trusted Certificate Authority
(e.g., DigiCert, Sectigo)"*) — a **self-signed certificate is not acceptable**. So signing is a
**prerequisite for submission**, not a parallel/production-only task.

## Chosen path: Certum Open Source Code Signing (on SimplySign), signed locally

**Certum "Open Source Code Signing" certificate, SimplySign variant** (~€49/yr,
[shop.certum.eu/open-source-code-signing-on-simplysign.html](https://shop.certum.eu/open-source-code-signing-on-simplysign.html))
with **SimplySign** cloud-HSM key storage. Reasoning, compared to the alternatives:

- **Azure Trusted Signing** is unavailable — it's gated to organizations based in the US/Canada.
- **SignPath Foundation** is free for OSS, but requires a track record of external
  contributors/stars that a new solo repo likely doesn't have yet, and the signed binary shows
  publisher **"SignPath Foundation"**, not your name.
- **Certum's regular OV/Standard cert** works too but costs much more (~€169–209/yr) and needs
  full OV business/individual identity validation.
- **Certum's Open Source tier** only requires a public URL showing you maintain the project
  (Vantage: public, MIT-licensed, on GitHub — trivially qualifies) — much lower bar than SignPath
  Foundation's reputation requirement. The private key never leaves Certum's HSM (satisfies the
  post-2023 CA/Browser Forum requirement that code-signing keys live on FIPS-validated hardware),
  and the certificate shows **"Open Source Developer, Timo Seikel"** as publisher — your name, not
  a foundation's.
- There's also a physical-smartcard "Open Source Code Signing - set" SKU (~€69 + shipping, ~€29/yr
  renewal) — skip it; the SimplySign variant avoids the USB reader, shipping wait, and Windows
  driver issues (`certutil -repairstore` etc.) that the physical-token route is known for.

**Important:** SimplySign has **no supported unattended/CI signing path.** It's built around an
interactive OTP approval from the SimplySign mobile app, and the resulting signing session is
capped at ~2 hours. Certum's own docs don't offer a REST API or headless mode for this — the only
"automation" floating around online is a fragile TOTP+UI-automation hack against SimplySign
Desktop, which needs a persistent, pre-paired machine and isn't a good fit for GitHub-hosted
runners. Rather than build something brittle, **CI keeps building an unsigned installer, and
signing happens as a manual local step before each release goes out.**

### Setup steps
1. Buy the **Open Source Code Signing on SimplySign** certificate from Certum's shop (the
   `-on-simplysign` SKU, not the `-code` or `-set` SKUs — those are for people who already own, or
   want to buy, physical cryptoCertum hardware). You'll need to submit a public URL proving you
   maintain the project (the GitHub repo works) plus identity verification (automatic photo-ID +
   selfie video is the fastest option).
2. After issuance, Certum enrolls you in **SimplySign**:
   - Install the **SimplySign mobile app** (Android/iOS) — this is your OTP source.
   - Install **SimplySign Desktop** on the Windows machine you'll sign releases from. It exposes
     the cloud-held key to Windows as a virtual smart card once connected.
3. Find your certificate's thumbprint once SimplySign Desktop is connected:
   ```
   certutil -store My
   ```
   (or read it from the SimplySign Desktop UI's certificate details).

### Signing a release
```powershell
npm run release                     # builds release/Vantage-Setup-<ver>.exe (unsigned)
# Open SimplySign Desktop, enter the OTP from the SimplySign mobile app to connect
npm run sign:local -- -Thumbprint <your cert thumbprint>
```
[scripts/sign-local.ps1](../scripts/sign-local.ps1) wraps `signtool sign` + `signtool verify`
against whatever `.exe` it finds in `release/`. Set `$env:CERTUM_THUMBPRINT` once (e.g. in your
PowerShell profile) to skip passing `-Thumbprint` every time.

CI ([.github/workflows/release.yml](../.github/workflows/release.yml)) only ever produces the
unsigned artifact — download it, or build locally, then run the command above before uploading to
the Overwolf App Store or attaching to a GitHub release.

**Note:** Certum states it will revoke Open Source-tier certificates if it detects commercial
software distribution. Vantage is free and ad-free by design, so this should be fine, but it's
worth re-reading Certum's exact clause given distribution goes through the Overwolf App Store.

## Fallbacks
- **Stay unsigned for QA** — only if Overwolf DevRel confirms this is currently accepted; the
  submission form's own copy says otherwise, so confirm before relying on it.
- **SignPath Foundation** — revisit if Certum turns out to be a poor fit; free, has a real CI
  GitHub Action, but publisher shows as "SignPath Foundation" and new-project approval is uncertain.
- **Do not** use Sigstore for this — it is not trusted by Windows SmartScreen for `.exe`/`.dll`.

## Local signing without SimplySign
`ow-electron-builder` is electron-builder underneath, so any `.pfx`-based cert can be used locally
via the standard env vars instead (no `package.json` change):

```bash
export CSC_LINK="/path/to/cert.pfx"
export CSC_KEY_PASSWORD="…"
npm run release
```
