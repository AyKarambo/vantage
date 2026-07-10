# winget distribution — Vantage

**Chosen path: publish to the community [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
repo so `winget install AyKarambo.Vantage` works, alongside the direct `.exe` download.**
Submitting is free and requires no extra signing beyond what we already do — the installer is
already Certum-signed and hosted on GitHub Releases (see [docs/signing.md](signing.md)). This
is **distribution only**: no change to how Vantage is built, signed, or run, and no impact on
the GEP-only account-safety promise ([README → Account safety](../README.md#account-safety)).

> **Gate before you submit:** a `winget-pkgs` PR is a public, hard-to-reverse action, and the
> `PackageIdentifier` is **immutable once merged**. Do **not** open the PR until the two
> human gates below (Overwolf ToS + clean-VM silent install) pass.

## Why winget

- One command to install (`winget install AyKarambo.Vantage`) and to update
  (`winget upgrade`), and it works in scripted / unattended machine setups.
- Discoverable to terminal-first users without hunting the Releases page or clicking through
  SmartScreen.
- Free, reversible, and low-effort — a manifest is three small YAML files, generated for us by
  [scripts/make-winget-manifest.mjs](../scripts/make-winget-manifest.mjs).

winget does **not** remove SmartScreen warnings — that's a reputation matter tied to the
signature, covered in [signing.md → SmartScreen expectations](signing.md#smartscreen-expectations-be-honest-with-yourself).
A winget install runs the same signed installer a manual download would.

## The package identity

| winget field        | value                                             | why |
|---------------------|---------------------------------------------------|-----|
| `PackageIdentifier` | `AyKarambo.Vantage`                               | matches the GitHub owner/repo; **immutable** after the first merge |
| `Publisher`         | `Timo Seikel`                                     | human publisher name (`package.json` `author`) |
| signed publisher    | `Open Source Developer Timo Seikel`               | the cert CN — a Certum "Open Source Developer" artifact, not the `Publisher` field |
| `InstallerType`     | `nullsoft`                                        | electron-builder NSIS; winget applies `/S` automatically (no explicit switches) |
| `Scope`             | `user`                                            | `nsis.perMachine: false` → per-user install |
| `Architecture`      | `x64`                                             | the only build target |
| `ManifestVersion`   | `1.12.0`                                          | current winget schema |
| on-disk path        | `manifests/a/AyKarambo/Vantage/<version>/`        | letter `a` = first char of the identifier |

`ProductCode` is intentionally **omitted** from the initial manifest — the NSIS ARP GUID can't
be derived without a test install, and winget correlates by `PackageName`/`Publisher`. Once you
have a sandbox/VM install, add the real `ProductCode` (or let `wingetcreate`/`komac`
auto-detect it) to tighten `winget upgrade`/`winget list` matching.

## Generating the manifest

```bash
npm run make:winget                        # defaults to the latest v* release tag
npm run make:winget -- --version 0.30.0    # or a specific version
```

This reads `package.json` for metadata, resolves the installer URL + SHA-256 from the published
`v<version>` GitHub Release (via `gh release view`; it falls back to downloading and hashing if
the asset digest is missing), and writes the three files under
`packaging/winget/manifests/a/AyKarambo/Vantage/<version>/`:

- `AyKarambo.Vantage.yaml` — version
- `AyKarambo.Vantage.locale.en-US.yaml` — defaultLocale (publisher, license, description, tags)
- `AyKarambo.Vantage.installer.yaml` — installer (URL, SHA-256, nullsoft, x64/user)

Offline / explicit override (no `gh` call):

```bash
npm run make:winget -- --version 0.30.0 \
  --url https://github.com/AyKarambo/vantage/releases/download/v0.30.0/Vantage-Setup-0.30.0.exe \
  --sha256 <HEX>
```

Then validate locally (needs the winget client, Windows):

```powershell
winget validate --manifest "packaging\winget\manifests\a\AyKarambo\Vantage\0.30.0"
# → "Manifest validation succeeded."
```

## Submission runbook

Numbered, fail-closed — each step gates the next.

> **The true gate is GEP approval, not winget.** Overwolf requires the app idea to be
> whitelisted via the App-proposal process before public GEP use; ow-electron Dev Mode is for
> local pre-approval testing only. This obligation already applies to the GitHub Releases build
> — winget just widens reach. Confirm the app is approved for **public** GEP distribution before
> broadening it.

1. **Overwolf ToS — third-party distribution: confirmed permitted** ✅ (researched 2026-07-10,
   high confidence — see [Overwolf ToS findings](#overwolf-tos-findings)). Overwolf's Developer
   Terms Exhibit B allows distribution "through the Overwolf Platform **and through a third-party
   distributor**"; ow-electron is a standalone/self-hosted model; and Overwolf itself ships
   `Overwolf.CurseForge` on winget. A one-line DevRel nod is *advisable insurance* for the lone
   ambiguous clause (Sec 3.5(b)) — **not blocking**.
2. **Verify the silent install** *(gate)*. `winget-pkgs` CI installs the package unattended in
   Windows Sandbox and fails the PR (`Validation-Unattended-Failed`) if it prompts.
   ```powershell
   .\Vantage-Setup-0.30.0.exe /S      # must complete with ZERO dialogs, then the app launches
   ```
   electron-builder NSIS honours `/S` (winget applies it automatically for `nullsoft`). The
   v0.30.0 asset's SHA-256 was verified against the manifest (bytes match); the definitive
   no-dialogs check runs in `winget-pkgs` CI's own Windows Sandbox on submission, or via a
   manual VM/Sandbox run.
3. **Generate + validate** the manifest for the released version (commands above). Commit the
   staged copy under `packaging/winget/`.
4. **Submit the PR** with a first-party tool and a **classic** GitHub PAT (`public_repo` scope
   — fine-grained PATs currently fail at PR creation upstream). One package + one version per
   PR.
   ```powershell
   winget install Microsoft.WingetCreate      # once
   wingetcreate submit --token <classic-PAT> "packaging\winget\manifests\a\AyKarambo\Vantage\0.30.0"
   ```
   Equivalent from-scratch form: `wingetcreate new <installer-url> --submit --token <PAT>`.
   > Keep the PAT out of shell history: set `$env:WINGET_CREATE_GITHUB_TOKEN` (wingetcreate) or
   > `$env:GITHUB_TOKEN` (komac) instead of passing `--token` on the command line.
5. **Wait for `winget-pkgs` CI + moderator review**, then merge. Community review latency
   varies (hours to days) and is outside our control.
6. **Verify live** on a clean machine after merge:
   ```powershell
   winget install AyKarambo.Vantage
   winget list Vantage                # shows the installed package
   ```

## Keeping it updated

For each new release, regenerate and submit a version bump. The low-friction path is
[komac](https://github.com/russellbanks/Komac) (needs the same classic `public_repo` PAT):

```bash
komac update AyKarambo.Vantage --version 0.31.0 \
  --urls https://github.com/AyKarambo/vantage/releases/download/v0.31.0/Vantage-Setup-0.31.0.exe \
  --submit
```

komac downloads the asset, computes the SHA-256, carries prior-version metadata forward, and
opens the PR. This is currently a **manual post-release step**. Wiring it to run automatically
after `npm run publish:release` (on the GitHub Release being published — komac only needs the
already-signed asset URL + a token, so it's decoupled from the local-only signing) is tracked
as a follow-up (`winget-auto-update`).

## What only you can do (manual)

The repo can generate and validate the manifest; these require infra or are outward-facing:

- ✅ **Overwolf ToS** — third-party distribution confirmed permitted (research; see below). An
  optional one-line DevRel nod closes the lone interpretive gap.
- ⚠ **GEP App-proposal / whitelisting** — confirm the app is approved for **public** GEP use
  before broadening distribution (applies to GitHub Releases too, not just winget).
- ◑ **Silent install** — installer SHA-256 verified against the manifest; the no-dialogs `/S`
  check is confirmed definitively by `winget-pkgs` CI (or a manual VM/Sandbox run).
- ⏳ **Open the `winget-pkgs` PR** (step 4) — public action; needs a classic PAT you hold.
  Never auto-submitted from CI.
- ⏳ **Verify the live install** after the community merge (step 6).

## Notes & decisions

- The installer is **already signed** and GitHub-Release-hosted, so issue #14's
  "unsigned installer / SmartScreen block" framing is superseded — the manifest points at a
  signed asset. Reputation still accrues over time; see [signing.md](signing.md#smartscreen-expectations-be-honest-with-yourself).
- **Microsoft Store (MSIX)** and **Chocolatey** are separate paths, out of scope here (the
  Store's runtime/auto-update model conflicts with the Overwolf runtime — see
  [signing.md → History](signing.md#history--alternatives)).
- Source research: [#14](https://github.com/AyKarambo/vantage/issues/14); spec + plan:
  [#123](https://github.com/AyKarambo/vantage/issues/123).

### Overwolf ToS findings

Researched 2026-07-10 (multi-source sweep + adversarial review). **Verdict: permitted, high
confidence** — distributing the publisher's own signed ow-electron installer via winget is
within Overwolf's terms:

- **Developer Terms, Exhibit B** (ow-electron additional terms — the controlling *lex
  specialis*): the Application "may be available for End-Users to download and access through the
  Overwolf Platform **and through a third-party distributor**"; "OW-Electron allows you to
  distribute your Application using several different hosting/distribution services."
  <https://legal.overwolf.com/docs/overwolf/developers/developer-terms/>
- **ow-electron FAQ**: "you are able to share your app with anyone you like as well as host the
  app in any location you prefer."
  <https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/ow-electron-faq/>
- **winget policy 1.1.4** requires the InstallerUrl be "the ISV's release location" (rehosts are
  banned) — so a winget manifest is *first-party* distribution, not third-party rehosting.
  <https://learn.microsoft.com/windows/package-manager/package/windows-package-manager-policies>
- **Precedent:** Overwolf itself publishes `Overwolf.CurseForge` on winget (nullsoft; installer
  on `curseforge.overwolf.com`).
- The ow-electron runtime + GEP type defs are MIT-licensed (no channel restriction).

**Residual (why "advisable", not "certain"):** Developer Terms Sec 3.5(b) ("distribute … the
Application … except through the functionality expressly provided by the Platform") reads, in
isolation, as a channel-lock; it's overridden by the more-specific Exhibit B and would otherwise
forbid the GitHub-Releases distribution the FAQ blesses. A brief written DevRel confirmation
closes it. **Separately — and more important — the real gate for public GEP distribution is
App-proposal / whitelisting approval** (Dev Mode is pre-approval only); that's an app-level
obligation independent of winget.
