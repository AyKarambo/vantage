# Code signing — Vantage

**Signing is required *before* Overwolf will review the app.** The submission form asks "Is your app
signed?" and Overwolf states: *"Code-signing your exe with your own certificate is required … Without
both [your exe signature + Overwolf's package integrity], we won't be able to review your app."* The
cert must be from a **trusted public CA** (per the ow-electron FAQ: *"a trusted Certificate Authority
(e.g., DigiCert, Sectigo)"*) — a **self-signed certificate is not acceptable**. So signing is a
**prerequisite for submission**, not a parallel/production-only task.

## Chosen path: SignPath Foundation (free, for open source)

[SignPath Foundation](https://signpath.org/) issues a **free** OV code-signing certificate to
qualifying open-source projects. The private key lives on their HSM and signing happens in the cloud
via CI — you never handle the key. Certificates are issued by **Sectigo** (a trusted CA) and build
Windows SmartScreen reputation.

**Trade-off:** the Windows publisher shown on the signed binary is **"SignPath Foundation"**, not
your name. (This is independent of Overwolf's app identity, which is derived from `package.json`
`name` + `author`.) Confirm with Overwolf DevRel that a SignPath-signed build is acceptable.

### Eligibility (per SignPath OSS terms)
- OSI-approved license, no commercial dual-licensing — **Vantage is MIT ✓**
- You own the source repository (public) — `AyKarambo/vantage`
- Defined roles: **Authors / Reviewers / Approvers**, and **MFA** on both GitHub and SignPath
- Builds run in CI so the signed artifact is attributable

### Setup steps
1. Apply at <https://signpath.org/apply> with the public repo.
2. After approval, create a SignPath **project** (slug e.g. `vantage`) and a **signing policy**
   (e.g. `release-signing`), and a CI user with an API token.
3. In the repo → **Settings → Secrets and variables → Actions**, add:
   - Secret `SIGNPATH_API_TOKEN`
   - Variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG`
   - Variable `SIGNING_ENABLED = true`
4. Push a `v*` tag (or run the **release** workflow). The `sign` job in
   [.github/workflows/release.yml](../.github/workflows/release.yml) submits the built installer to
   SignPath and downloads the signed artifact.

### Application answers (paste into signpath.org/apply)
- **Project name:** Vantage
- **Repository:** https://github.com/AyKarambo/vantage
- **License:** MIT (`LICENSE` in repo root)
- **Description:** An account-safe Overwatch 2 stats coach (desktop app on Overwolf's ow-electron).
  Turns your own match history into priority maps, per-hero stats, mental tracking and improvement
  targets. Reads only Overwolf's sanctioned Game Events Provider — no game-memory reads, no injection.
- **What needs signing / why:** the Windows installer + app `exe` (built by ow-electron-builder).
  Overwolf requires a trusted-CA signature before they will review/publish the app.
- **Build system:** GitHub Actions — `.github/workflows/release.yml` (build is reproducible from the
  public repo; the workflow already includes the SignPath submit-signing-request step).
- **Maintainer / roles:** Timo Seikel (AyKarambo) — sole maintainer acting as Author, Reviewer and
  Approver. MFA enabled on GitHub and SignPath.
- **Distribution:** Overwolf App Store (free, ad-free app).

## Fallbacks (if SignPath defers a brand-new project)
- **Stay unsigned for QA** — allowed; revisit before production.
- **Azure Trusted Signing** — ~$9.99/mo, Microsoft CA, cloud API signing, builds reputation.
  US/Canada org gated. Integrates with electron-builder via the Trusted Signing tool.
- **Certum Open Source** — low-cost, trusted, but needs a hardware token / cloud key.
- **Do not** use Sigstore for this — it is not trusted by Windows SmartScreen for `.exe`/`.dll`.

## Local (non-SignPath) signing
`ow-electron-builder` is electron-builder underneath, so a `.pfx` from any CA can be used locally
with the standard env vars (no `package.json` change):

```bash
export CSC_LINK="/path/to/cert.pfx"
export CSC_KEY_PASSWORD="…"
npm run release
```
