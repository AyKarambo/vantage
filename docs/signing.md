# Code signing — Vantage

Overwolf requires the **public production** release to be signed by a trusted CA. Unsigned builds
are fine for **DevRel QA** (Windows SmartScreen just shows *More info → Run anyway*), so signing does
not block submission — it's pursued in parallel.

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
